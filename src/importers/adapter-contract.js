import { createHash } from "node:crypto";
import path from "node:path";

import { mergeWorkspaces } from "./run-manifest.js";

export const importPlanSchemaVersion = 1;
export const conformanceAdapterIds = Object.freeze(["codex-session-v1", "ci-manifest-v1", "release-manifest-v1"]);

const commonExcluded = Object.freeze([
  "absolute_source_paths",
  "environment_values",
  "message_bodies",
  "reasoning",
  "command_text",
  "tool_arguments",
  "tool_output",
  "undeclared_files"
]);

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function digestValue(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export function digestNamedInputs(inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw importPlanError("invalid_inputs", "named import inputs must be an object");
  }
  for (const [name, digest] of Object.entries(inputs)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw importPlanError("invalid_inputs", "input names must be safe slugs");
    requireDigest(digest, `input ${name} digest`);
  }
  return digestValue(Object.fromEntries(Object.entries(inputs).sort(([left], [right]) => left.localeCompare(right))));
}

export function normalizeWarnings(warnings = []) {
  if (!Array.isArray(warnings)) throw importPlanError("invalid_warnings", "adapter warnings must be an array");
  const normalized = [...new Set(warnings.map((warning) => String(warning)))].sort();
  if (normalized.length > 64 || normalized.some((warning) => !warning || warning.length > 500)) {
    throw importPlanError("invalid_warnings", "adapter warnings exceed the bounded contract");
  }
  return normalized;
}

export function buildAdapterImportPlan({
  store,
  adapterId,
  inputName,
  incoming,
  sourceRef,
  sourceDigest,
  observedAt,
  warnings = [],
  proofBundle = null,
  sourceRoot = null,
  evidencePolicy = null,
  inputs = {},
  revalidate = null
}) {
  if (!store || typeof store.getWorkspace !== "function") throw importPlanError("invalid_store", "a readable Halba store is required");
  if (!conformanceAdapterIds.includes(adapterId) && adapterId !== "run-manifest-v1") throw importPlanError("unknown_adapter", "adapter is outside the bounded registry");
  requireDigest(sourceDigest, "source digest");
  requireTimestamp(observedAt, "observedAt");
  if (typeof sourceRef !== "string" || !sourceRef || path.basename(sourceRef) !== sourceRef) throw importPlanError("unsafe_source_ref", "source reference must be a basename");
  const qualityWarnings = normalizeWarnings(warnings);
  const current = store.getWorkspace(incoming.workspace.id);
  const currentRun = current?.threads.find((thread) => thread.id === incoming.threads[0].id) || null;
  const incomingRun = incoming.threads[0];
  if (currentRun) {
    const currentTime = Date.parse(currentRun.updatedAt);
    const incomingTime = Date.parse(incomingRun.updatedAt);
    if (incomingTime < currentTime) throw importPlanError("stale_source_revision", "incoming run revision is older than current state");
    if (incomingTime === currentTime && canonicalJson(currentRun) !== canonicalJson(incomingRun)) {
      throw importPlanError("revision_conflict", "the same run timestamp names different normalized content");
    }
  }
  const workspace = mergeWorkspaces(current, incoming, { evidencePolicy });
  const beforeDigest = digestValue(JSON.stringify(current));
  const afterDigest = digestValue(JSON.stringify(workspace));
  const existingProof = proofBundle ? store.getProofBundle(proofBundle.id) : null;
  if (existingProof && canonicalJson(existingProof) !== canonicalJson(proofBundle)) {
    throw importPlanError("proof_bundle_conflict", "proof bundle id already names different immutable evidence");
  }
  const receiptId = `${adapterId}-${incomingRun.id}-${sourceDigest}`;
  const existingReceipt = store.listWorkspaceImportEvents(incoming.workspace.id).find((event) => event.receiptId === receiptId) || null;
  if (existingReceipt && (existingReceipt.adapter !== adapterId || existingReceipt.sourceDigest !== sourceDigest)) {
    throw importPlanError("receipt_conflict", "receipt id already names different import data");
  }
  if (existingReceipt && beforeDigest !== afterDigest) {
    throw importPlanError("stale_packet_replay", "an already committed packet cannot replace newer workspace state");
  }

  const channel = entityChange(current?.channels, incoming.channels[0]);
  const agent = entityChange(current?.agents, incoming.agents[0]);
  const run = entityChange(current?.threads, incomingRun);
  const proofAction = !proofBundle ? "none" : existingProof ? "reuse" : "attach";
  const action = existingReceipt && beforeDigest === afterDigest && proofAction !== "attach"
    ? "noop"
    : !current ? "create" : beforeDigest === afterDigest ? "record" : "update";
  const beforeCounts = workspaceCounts(current, store, incoming.workspace.id);
  const afterCounts = workspaceCounts(workspace, store, incoming.workspace.id, proofBundle, proofAction);
  const decisions = reopenedDecisions(store, current, workspace, incomingRun.id);
  const qualityStatus = qualityWarnings.length ? "degraded" : "accepted";
  const previewWithoutDigest = {
    schemaVersion: importPlanSchemaVersion,
    type: "halba.import.preview",
    outcome: qualityStatus,
    action,
    writesState: false,
    adapter: { id: adapterId, inputName: inputName || adapterId },
    target: {
      workspaceId: incoming.workspace.id,
      channelId: incomingRun.channelId,
      agentId: incomingRun.agentId,
      runId: incomingRun.id
    },
    inputs: canonicalValue(inputs),
    base: { workspaceDigest: beforeDigest },
    expected: { workspaceDigest: afterDigest },
    changes: {
      workspace: { action, beforeDigest, afterDigest },
      channel,
      agent,
      run,
      proof: proofChange(proofBundle, proofAction),
      counts: countChanges(beforeCounts, afterCounts),
      decisions
    },
    quality: { status: qualityStatus, warnings: qualityWarnings },
    privacy: {
      storedOnCommit: ["safe_routing_labels", "aggregate_source_metadata", "typed_events", "digests", "adjudication", "declared_proof_source_bytes"],
      excluded: [...commonExcluded],
      sourceReferencePolicy: "basename_only",
      proofSourceStorage: proofBundle ? "private_content_addressed_sqlite" : "none"
    },
    proposedReceipt: { id: receiptId, sourceDigest, sourceRef, observedAt }
  };
  const preview = { ...previewWithoutDigest, planDigest: digestValue(previewWithoutDigest) };
  validateImportPlanPreview(preview);
  return {
    preview,
    prepared: { workspace, proofBundle, sourceRoot, expectedWorkspaceDigest: beforeDigest, revalidate }
  };
}

export async function commitAdapterImportPlan(store, plan, { expectedPlanDigest = null, allowDegraded = false } = {}) {
  const preview = validateImportPlanPreview(plan?.preview);
  const calculated = digestValue(withoutPlanDigest(preview));
  if (calculated !== preview.planDigest) throw importPlanError("plan_integrity_failed", "import plan digest does not match its contents");
  if (expectedPlanDigest && expectedPlanDigest !== preview.planDigest) throw importPlanError("plan_changed", "expected import plan digest does not match current inputs and state");
  if (preview.quality.status === "degraded" && !allowDegraded) throw importPlanError("degraded_requires_ack", "degraded import requires explicit acknowledgement");
  if (typeof plan.prepared.revalidate === "function") await plan.prepared.revalidate();
  if (preview.action === "noop") {
    const event = store.listWorkspaceImportEvents(preview.target.workspaceId).find((entry) => entry.receiptId === preview.proposedReceipt.id) || null;
    return commitReceipt(preview, { event }, "idempotent");
  }
  const result = store.importWorkspace(plan.prepared.workspace, {
    adapter: preview.adapter.id,
    sourceRef: preview.proposedReceipt.sourceRef,
    sourceDigest: preview.proposedReceipt.sourceDigest,
    importedAt: preview.proposedReceipt.observedAt,
    proofBundle: plan.prepared.proofBundle,
    sourceRoot: plan.prepared.sourceRoot,
    receiptId: preview.proposedReceipt.id,
    status: preview.quality.status,
    warnings: preview.quality.warnings,
    expectedWorkspaceDigest: plan.prepared.expectedWorkspaceDigest
  });
  const event = store.listWorkspaceImportEvents(preview.target.workspaceId).find((entry) => entry.receiptId === preview.proposedReceipt.id) || null;
  return commitReceipt(preview, { ...result, event }, result.unchanged ? "idempotent" : "committed");
}

export function validateImportPlanPreview(preview) {
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) throw importPlanError("invalid_plan", "preview must be an object");
  if (preview.schemaVersion !== importPlanSchemaVersion || preview.type !== "halba.import.preview") throw importPlanError("invalid_plan", "preview schema is unsupported");
  if (!conformanceAdapterIds.includes(preview.adapter?.id) && preview.adapter?.id !== "run-manifest-v1") throw importPlanError("invalid_plan", "preview adapter is unsupported");
  if (!['accepted', 'degraded'].includes(preview.outcome) || preview.writesState !== false) throw importPlanError("invalid_plan", "preview outcome is invalid");
  if (!['create', 'update', 'record', 'noop'].includes(preview.action)) throw importPlanError("invalid_plan", "preview action is invalid");
  requireDigest(preview.planDigest, "plan digest");
  requireDigest(preview.base?.workspaceDigest, "base workspace digest");
  requireDigest(preview.expected?.workspaceDigest, "expected workspace digest");
  requireDigest(preview.proposedReceipt?.sourceDigest, "receipt source digest");
  if (!Array.isArray(preview.quality?.warnings)) throw importPlanError("invalid_plan", "preview warnings are invalid");
  return preview;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function entityChange(currentItems = [], incoming) {
  const current = currentItems?.find((item) => item.id === incoming.id) || null;
  if (!current) return { id: incoming.id, action: "add", changedFields: [] };
  const changedFields = [...new Set([...Object.keys(current), ...Object.keys(incoming)])]
    .filter((key) => canonicalJson(current[key]) !== canonicalJson(incoming[key])).sort();
  return { id: incoming.id, action: changedFields.length ? "update" : "reuse", changedFields };
}

function proofChange(bundle, action) {
  if (!bundle) return { action: "none", bundleId: null, sourceCount: 0, totalBytes: 0, claimCount: 0, reviewGateCount: 0 };
  const proof = bundle.adjudication;
  return {
    action,
    bundleId: bundle.id,
    sourceCount: bundle.sources.length,
    totalBytes: bundle.sources.reduce((sum, source) => sum + source.byteCount, 0),
    claimCount: proof?.findings?.length || 0,
    reviewGateCount: proof?.reviewRequiredCount || 0,
    revisionDigest: digestValue(bundle)
  };
}

function workspaceCounts(workspace, store, workspaceId, proofBundle = null, proofAction = "none") {
  if (!workspace) return { channels: 0, agents: 0, runs: 0, proofSources: 0, reviewGates: 0 };
  const storedSources = store.listProofBundles(workspaceId).reduce((sum, bundle) => sum + store.listProofSources(bundle.id).length, 0);
  return {
    channels: workspace.channels.length,
    agents: workspace.agents.length,
    runs: workspace.threads.length,
    proofSources: storedSources + (proofAction === "attach" ? proofBundle?.sources?.length || 0 : 0),
    reviewGates: workspace.threads.reduce((sum, thread) => sum + thread.reviewGateCount, 0)
  };
}

function countChanges(before, after) {
  return {
    before,
    after,
    delta: Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]))
  };
}

function reopenedDecisions(store, current, after, runId) {
  if (!current) return { applicableBefore: 0, applicableAfter: 0, reopened: 0, affectedClaimIds: [] };
  const beforeRun = current.threads.find((thread) => thread.id === runId);
  const afterRun = after.threads.find((thread) => thread.id === runId);
  const decisions = store.listWorkspaceReviewDecisions(current.workspace.id).filter((decision) => decision.threadId === runId);
  const affected = decisions.filter((decision) => beforeRun?.reviewEvidence?.[decision.claimId] === decision.evidenceIdentity && afterRun?.reviewEvidence?.[decision.claimId] !== decision.evidenceIdentity);
  return {
    applicableBefore: decisions.filter((decision) => beforeRun?.reviewEvidence?.[decision.claimId] === decision.evidenceIdentity).length,
    applicableAfter: decisions.filter((decision) => afterRun?.reviewEvidence?.[decision.claimId] === decision.evidenceIdentity).length,
    reopened: affected.length,
    affectedClaimIds: affected.map((decision) => decision.claimId).sort()
  };
}

function commitReceipt(preview, result, outcome) {
  return {
    schemaVersion: 1,
    type: "halba.import.receipt",
    outcome,
    receiptId: preview.proposedReceipt.id,
    planDigest: preview.planDigest,
    workspaceId: preview.target.workspaceId,
    runId: preview.target.runId,
    adapter: preview.adapter.id,
    status: preview.quality.status,
    sourceRef: preview.proposedReceipt.sourceRef,
    sourceDigest: preview.proposedReceipt.sourceDigest,
    observedAt: preview.proposedReceipt.observedAt,
    recordedAt: result?.event?.recordedAt || null,
    changes: { run: preview.changes.run.action, proof: preview.changes.proof.action, reviewGatesOpened: Math.max(0, preview.changes.counts.delta.reviewGates), decisionsReopened: preview.changes.decisions.reopened },
    counts: result?.counts || preview.changes.counts.after,
    warnings: preview.quality.warnings,
    transaction: { atomic: true, stateCommitted: outcome === "committed", receiptProjectionStored: outcome === "committed", appendOnlyEventStored: outcome === "committed" }
  };
}

function withoutPlanDigest(preview) {
  const { planDigest, ...rest } = preview;
  return rest;
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw importPlanError("invalid_digest", `${label} must be a SHA-256 digest`);
}

function requireTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw importPlanError("invalid_timestamp", `${label} must be a timestamp`);
}

function importPlanError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
