import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { evidenceIdentity } from "../../public/shared/review-contract.js";
import { validateEvidencePolicyPacket } from "../../public/shared/trust-contract.js";
import { validateWorkspace } from "../../public/shared/workspace-contract.js";

export const runManifestSchemaVersion = 1;
export const runManifestByteLimit = 64 * 1024;

const zeroVerdicts = Object.freeze({ supported: 0, unsupported: 0, contradictory: 0, stale: 0, uncertain: 0 });

export async function loadRunManifest(file) {
  const manifestPath = path.resolve(file instanceof URL ? fileURLToPath(file) : file);
  let handle;
  try {
    handle = await open(manifestPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) throw manifestError("manifest is not a regular file");
    if (fileStat.size > runManifestByteLimit) throw manifestError("manifest exceeds the 64 KB limit");
    const manifestBytes = await handle.readFile();
    let manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      throw manifestError("manifest must contain valid JSON");
    }
    assertRunManifest(manifest);
    return {
      manifest,
      manifestPath,
      manifestBytes,
      manifestDigest: createHash("sha256").update(manifestBytes).digest("hex"),
      byteCount: manifestBytes.byteLength
    };
  } catch (error) {
    if (error?.code === "ELOOP") throw manifestError("manifest must not be a symbolic link");
    throw error;
  } finally {
    await handle?.close();
  }
}

export function workspaceFromRunManifest(manifest, { proof = null, events = null } = {}) {
  assertRunManifest(manifest);
  if (proof) assertProofMatchesRun(manifest, proof);
  const runEvents = events || manifest.run.events;
  const proofReady = Boolean(proof);
  const reviewFindings = proof?.findings.filter((finding) => finding.reviewRequired) || [];
  const thread = {
    id: manifest.run.id,
    channelId: manifest.channel.id,
    agentId: manifest.agent.id,
    title: manifest.run.title,
    goal: manifest.run.goal,
    summary: manifest.run.summary,
    status: proofReady && proof.reviewRequiredCount ? "needs_review" : manifest.run.status,
    proofState: proofReady ? "ready" : manifest.run.proofState,
    startedAt: manifest.run.startedAt,
    updatedAt: manifest.run.updatedAt,
    completedAt: manifest.run.completedAt,
    proofBundleId: proofReady ? proof.bundle.id : null,
    claimCount: proofReady ? proof.findings.length : 0,
    claimIds: proofReady ? proof.findings.map((finding) => finding.claimId) : [],
    reviewGateCount: reviewFindings.length,
    reviewClaimIds: reviewFindings.map((finding) => finding.claimId),
    reviewEvidence: Object.fromEntries(reviewFindings.map((finding) => [finding.claimId, evidenceIdentity(finding)])),
    verdictCounts: proofReady ? proof.counts : { ...zeroVerdicts },
    events: runEvents
  };
  return validateWorkspace({
    schemaVersion: 1,
    workspace: structuredClone(manifest.workspace),
    channels: [structuredClone(manifest.channel)],
    agents: [structuredClone(manifest.agent)],
    threads: [thread]
  }, proofReady ? { proofBundleId: proof.bundle.id } : {});
}

function assertProofMatchesRun(manifest, proof) {
  if (proof.bundle.title !== manifest.run.title) throw manifestError("proof title does not match the run title");
  if (proof.bundle.agent !== manifest.agent.name) throw manifestError("proof agent does not match the run agent");
  const generatedAt = Date.parse(proof.bundle.generatedAt);
  const startedAt = Date.parse(manifest.run.startedAt);
  const updatedAt = Date.parse(manifest.run.updatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt < startedAt || generatedAt > updatedAt) {
    throw manifestError("proof generation time is outside the run boundary");
  }
}

export function mergeWorkspaces(current, incoming, { evidencePolicy = null } = {}) {
  if (!current) {
    const created = structuredClone(incoming);
    if (evidencePolicy && created.trust) throw manifestError("workspace cannot carry two evidence policy packets");
    if (evidencePolicy) created.trust = structuredClone(evidencePolicy);
    return validateWorkspace(created);
  }
  if (current.workspace.id !== incoming.workspace.id) throw manifestError("cannot merge different workspaces");
  const merged = {
    schemaVersion: 1,
    workspace: structuredClone(incoming.workspace),
    channels: mergeById(current.channels, incoming.channels),
    agents: mergeById(current.agents, incoming.agents),
    threads: mergeById(current.threads, incoming.threads)
  };
  if (evidencePolicy && incoming.trust) throw manifestError("incremental workspace cannot carry two evidence policy packets");
  const trust = mergeTrust(current.trust, evidencePolicy || incoming.trust);
  if (trust) merged.trust = trust;
  return validateWorkspace(merged);
}

export function proofBundleRecord(bundle, adjudication = null) {
  return {
    id: bundle.definition.id,
    title: bundle.definition.title,
    generatedAt: bundle.definition.generatedAt,
    definition: bundle.definition,
    adjudication,
    sources: bundle.sources.map((source) => ({
      path: source.path,
      kind: source.kind,
      label: source.label,
      sha256: source.sha256,
      lineCount: source.lineCount,
      byteCount: source.bytes
    }))
  };
}

function assertRunManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw manifestError("manifest root must be an object");
  if (manifest.schemaVersion !== runManifestSchemaVersion) throw manifestError(`schemaVersion must be ${runManifestSchemaVersion}`);
  for (const field of ["workspace", "channel", "agent", "run"]) {
    if (!manifest[field] || typeof manifest[field] !== "object" || Array.isArray(manifest[field])) throw manifestError(`${field} is required`);
  }
  if (manifest.workspace.id !== manifest.run.workspaceId) throw manifestError("run references the wrong workspace");
  if (manifest.channel.id !== manifest.run.channelId) throw manifestError("run references the wrong channel");
  if (manifest.agent.id !== manifest.run.agentId) throw manifestError("run references the wrong agent");
  if (!Array.isArray(manifest.run.events) || !manifest.run.events.length) throw manifestError("run events are required");
  if (manifest.run.events.length > 128) throw manifestError("run has too many events");
  if (!Array.isArray(manifest.warnings || [])) throw manifestError("warnings must be an array");
  if ((manifest.warnings || []).some((warning) => typeof warning !== "string" || warning.length > 500)) throw manifestError("warnings must be bounded strings");
  if (manifest.sourceSessionId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(manifest.sourceSessionId)) {
    throw manifestError("sourceSessionId must be a UUID");
  }
  if (manifest.evidencePolicy !== undefined) {
    try {
      validateEvidencePolicyPacket(manifest.evidencePolicy, { threadId: manifest.run.id });
    } catch (error) {
      throw manifestError(`evidencePolicy packet is invalid: ${String(error?.message || error)}`);
    }
  }

  const provisional = {
    schemaVersion: 1,
    workspace: structuredClone(manifest.workspace),
    channels: [structuredClone(manifest.channel)],
    agents: [structuredClone(manifest.agent)],
    threads: [{
      id: manifest.run.id,
      channelId: manifest.run.channelId,
      agentId: manifest.run.agentId,
      title: manifest.run.title,
      goal: manifest.run.goal,
      summary: manifest.run.summary,
      status: manifest.run.status,
      proofState: manifest.run.proofState,
      startedAt: manifest.run.startedAt,
      updatedAt: manifest.run.updatedAt,
      completedAt: manifest.run.completedAt,
      proofBundleId: manifest.run.proofState === "ready" ? "manifest-proof-placeholder" : null,
      claimCount: 0,
      claimIds: [],
      reviewGateCount: 0,
      reviewClaimIds: [],
      reviewEvidence: {},
      verdictCounts: { ...zeroVerdicts },
      events: structuredClone(manifest.run.events)
    }]
  };
  validateWorkspace(provisional);
  if (manifest.run.proofState === "ready") throw manifestError("manifest proofState cannot be ready until a proof packet is adjudicated");
  return manifest;
}

function mergeById(current, incoming) {
  const values = new Map(current.map((item) => [item.id, structuredClone(item)]));
  for (const item of incoming) values.set(item.id, structuredClone(item));
  return [...values.values()];
}

function mergeTrust(current, incoming) {
  if (!current && !incoming) return null;
  if (!current) return structuredClone(incoming);
  if (!incoming) return structuredClone(current);
  if (incoming.policy.id !== current.policy.id || incoming.policy.version < current.policy.version) {
    throw manifestError("trust policy identity or version moved backwards");
  }
  const bindings = new Map(current.bindings.map((binding) => [binding.id, structuredClone(binding)]));
  for (const binding of incoming.bindings) {
    const existing = bindings.get(binding.id);
    if (existing && !isDeepStrictEqual(existing, binding)) {
      throw manifestError(`trust binding id ${binding.id} is immutable; append a new binding with explicit supersedes lineage`);
    }
    if (!existing) bindings.set(binding.id, structuredClone(binding));
  }
  return {
    schemaVersion: incoming.schemaVersion,
    policy: structuredClone(incoming.policy),
    bindings: [...bindings.values()]
  };
}

function manifestError(message) {
  const error = new Error(`invalid run manifest: ${message}`);
  error.code = "invalid_run_manifest";
  return error;
}
