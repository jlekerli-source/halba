import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";

import { buildAdapterImportPlan, commitAdapterImportPlan, digestNamedInputs, digestValue } from "../src/importers/adapter-contract.js";
import { inspectCiManifest } from "../src/importers/ci-manifest.js";
import { inspectCodexSession } from "../src/importers/codex-session.js";
import { inspectReleaseManifest } from "../src/importers/release-manifest.js";
import { loadRunManifest, proofBundleRecord, workspaceFromRunManifest } from "../src/importers/run-manifest.js";
import { loadProofBundle } from "../src/proof/bundle.js";
import { adjudicateProof } from "../src/proof/engine.js";
import { assertProofOutput } from "../src/proof/schema.js";
import { defaultStateFile, openLocalStore, openLocalStoreReadOnly } from "../src/storage/local-store.js";

const options = parseOptions(process.argv.slice(2));
const adapterId = adapterIdentity(options.adapter);
validateOptions(options, adapterId);

const prepared = await inspectInputs(options, adapterId);
const stateFile = path.resolve(options.state || process.env.HALBA_STATE_FILE || defaultStateFile);
const store = options.dryRun
  ? await openPreviewStore(stateFile)
  : await openLocalStore(stateFile);

try {
  const plan = buildAdapterImportPlan({
    store,
    adapterId,
    inputName: options.adapter,
    incoming: prepared.incoming,
    sourceRef: prepared.sourceRef,
    sourceDigest: prepared.packetDigest,
    observedAt: prepared.incoming.threads[0].updatedAt,
    warnings: prepared.warnings,
    proofBundle: prepared.bundleRecord,
    sourceRoot: prepared.bundle?.bundleRoot || null,
    evidencePolicy: prepared.evidencePolicy,
    inputs: prepared.inputDigests,
    revalidate: prepared.revalidate
  });
  if (!options.dryRun) await waitAtConformanceCommitBarrier();
  const output = options.dryRun
    ? plan.preview
    : await commitAdapterImportPlan(store, plan, {
      expectedPlanDigest: options.expectPlanDigest || null,
      allowDegraded: options.allowDegraded
    });
  printOutput(output, options.format);
} finally {
  store.close();
}

async function inspectInputs(options, adapterId) {
  const manifestRecord = options.manifest ? await loadRunManifest(options.manifest) : null;
  const inputDigests = {};
  if (manifestRecord) inputDigests.routing = manifestRecord.manifestDigest;
  let inspection = null;
  let normalizedManifest;

  if (adapterId === "ci-manifest-v1") {
    inspection = await inspectCiManifest(options.source);
    inputDigests.source = inspection.semanticDigest;
    normalizedManifest = manifestFromCiInspection(inspection);
  } else {
    normalizedManifest = structuredClone(manifestRecord.manifest);
  }

  if (adapterId === "codex-session-v1") {
    inspection = await inspectCodexSession(options.source);
    inputDigests.source = inspection.sourceDigest;
    if (normalizedManifest.sourceSessionId && normalizedManifest.sourceSessionId !== inspection.sessionId) {
      fail("manifest sourceSessionId does not match the Codex session");
    }
    normalizedManifest.run.startedAt = inspection.startedAt;
    normalizedManifest.run.updatedAt = inspection.updatedAt;
    if (!inspection.complete) normalizedManifest.run.status = "running";
    normalizedManifest.run.completedAt = normalizedManifest.run.status === "running" ? null : inspection.updatedAt;
    normalizedManifest.run.events = inspection.events;
  }

  if (adapterId === "release-manifest-v1") {
    inspection = await inspectReleaseManifest(options.source, { root: options.root });
    inputDigests.source = inspection.semanticDigest;
    applyReleaseInspection(normalizedManifest, inspection);
  }

  if (adapterId === "run-manifest-v1") inputDigests.source = manifestRecord.manifestDigest;

  let proof = null;
  let bundle = null;
  let bundleRecord = null;
  let proofOutputRecord = null;
  if (options.bundle) {
    if (inspection && adapterId === "codex-session-v1" && !inspection.proofEligible) {
      fail("cannot attach proof while the Codex source is incomplete or malformed");
    }
    bundle = await loadProofBundle(options.bundle);
    proofOutputRecord = await readBoundedJson(options.proofOutput, 128 * 1024, "proof output");
    const modelRun = proofOutputRecord.value;
    if (!["recorded", "imported"].includes(modelRun?.execution?.mode)) fail("proof output execution mode must be recorded or imported");
    if (modelRun.execution.store !== false) fail("proof output must record store=false");
    assertProofOutput(modelRun.output);
    proof = adjudicateProof(bundle, modelRun);
    bundleRecord = proofBundleRecord(bundle, proof);
    inputDigests.proof = digestValue(bundleRecord);
    inputDigests["proof-output"] = digestValue(modelRun);
  }

  const warnings = [
    ...(normalizedManifest.warnings || []),
    ...inspectionWarnings(inspection)
  ];
  normalizedManifest.warnings = warnings;
  const incoming = workspaceFromRunManifest(normalizedManifest, {
    proof,
    events: normalizedManifest.run.events
  });
  const packetDigest = digestNamedInputs(inputDigests);

  return {
    incoming,
    warnings,
    packetDigest,
    inputDigests,
    sourceRef: inspection?.sourceRef || path.basename(manifestRecord.manifestPath),
    bundle,
    bundleRecord,
    evidencePolicy: normalizedManifest.evidencePolicy || null,
    revalidate: async () => {
      if (manifestRecord) {
        const current = await loadRunManifest(manifestRecord.manifestPath);
        if (current.manifestDigest !== manifestRecord.manifestDigest) fail("routing manifest changed after preview");
      }
      if (adapterId === "codex-session-v1") {
        const current = await inspectCodexSession(options.source);
        if (current.sourceDigest !== inspection.sourceDigest) fail("Codex source changed after preview");
      } else if (adapterId === "ci-manifest-v1") {
        const current = await inspectCiManifest(options.source);
        if (current.semanticDigest !== inspection.semanticDigest) fail("CI source changed after preview");
      } else if (adapterId === "release-manifest-v1") {
        await inspection.revalidate();
      }
      if (bundle) {
        const currentBundle = await loadProofBundle(options.bundle);
        const currentOutput = await readBoundedJson(options.proofOutput, 128 * 1024, "proof output");
        const currentProof = adjudicateProof(currentBundle, currentOutput.value);
        if (digestValue(proofBundleRecord(currentBundle, currentProof)) !== inputDigests.proof || digestValue(currentOutput.value) !== inputDigests["proof-output"]) {
          fail("proof packet changed after preview");
        }
      }
    }
  };
}

function manifestFromCiInspection(inspection) {
  return {
    schemaVersion: 1,
    workspace: inspection.routing.workspace,
    channel: inspection.routing.channel,
    agent: inspection.routing.agent,
    run: { ...inspection.run, events: inspection.events },
    warnings: []
  };
}

function applyReleaseInspection(manifest, inspection) {
  const generatedAt = inspection.manifest.release.generatedAt;
  const startedAt = Date.parse(manifest.run.startedAt);
  const updatedAt = Date.parse(manifest.run.updatedAt);
  if (Date.parse(generatedAt) < startedAt || Date.parse(generatedAt) > updatedAt) {
    fail("release generatedAt is outside the routed run boundary");
  }
  const blocking = inspection.manifest.checks.filter((check) => check.required && check.status !== "passed");
  const pending = blocking.some((check) => check.status === "pending");
  const failed = blocking.some((check) => check.status === "failed");
  manifest.run.updatedAt = generatedAt;
  manifest.run.status = pending ? "running" : failed ? "failed" : blocking.length ? "needs_review" : "completed";
  manifest.run.completedAt = pending ? null : generatedAt;
  manifest.run.proofState = "not_required";
  manifest.run.summary = inspection.readiness.ready
    ? `Release ${inspection.manifest.release.version} passed all required structured checks with ${inspection.artifacts.length} verified artifacts.`
    : `Release ${inspection.manifest.release.version} is blocked by ${blocking.length} required structured checks.`;
  manifest.run.events = [
    { id: "release-inspection-start", type: "run_started", at: manifest.run.startedAt, title: "Opened bounded release packet", detail: `${inspection.artifacts.length} explicitly declared artifacts · discovery disabled` },
    { id: "release-inspection-end", type: pending ? "note" : blocking.length ? "human_gate" : "run_completed", at: generatedAt, title: inspection.readiness.ready ? "Release packet is ready" : "Release packet is blocked", detail: `${inspection.readiness.passed}/${inspection.readiness.required} required checks passed · artifact bytes excluded` }
  ];
}

function inspectionWarnings(inspection) {
  if (!inspection) return [];
  if (Array.isArray(inspection.warnings)) {
    return inspection.warnings.map((warning) => typeof warning === "string" ? warning : `${warning.code}:${warning.count}`);
  }
  if (inspection.readiness && !inspection.readiness.ready) {
    return [`release_blocked:${inspection.readiness.blockingCheckIds.length}`];
  }
  return [];
}

async function openPreviewStore(stateFile) {
  try {
    const metadata = await stat(stateFile);
    if (!metadata.isFile()) fail("preview state must be a regular file");
    return openLocalStoreReadOnly(stateFile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return openLocalStore(":memory:");
  }
}

function adapterIdentity(value) {
  const identities = {
    codex: "codex-session-v1",
    ci: "ci-manifest-v1",
    release: "release-manifest-v1",
    manifest: "run-manifest-v1"
  };
  if (!identities[value]) fail("--adapter must be codex, ci, release, or manifest");
  return identities[value];
}

function validateOptions(options, adapterId) {
  if (["codex-session-v1", "release-manifest-v1", "run-manifest-v1"].includes(adapterId) && !options.manifest) fail("--manifest is required for this adapter");
  if (["codex-session-v1", "ci-manifest-v1", "release-manifest-v1"].includes(adapterId) && !options.source) fail("--source is required for this adapter");
  if (adapterId === "release-manifest-v1" && !options.root) fail("--root is required for the release adapter");
  if (Boolean(options.bundle) !== Boolean(options.proofOutput)) fail("--bundle and --proof-output must be provided together");
  if (options.bundle && adapterId !== "codex-session-v1") fail("proof packets are currently accepted only by the Codex adapter");
  if (options.expectPlanDigest && options.dryRun) fail("--expect-plan-digest applies only to commit");
}

function parseOptions(args) {
  const options = { dryRun: false, allowDegraded: false, format: "json" };
  const booleans = new Set(["dry-run", "allow-degraded"]);
  const allowed = new Set(["adapter", "manifest", "source", "root", "bundle", "proof-output", "state", "expect-plan-digest", "format", ...booleans]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) fail(`unexpected positional argument ${argument}`);
    const rawKey = argument.slice(2);
    if (!allowed.has(rawKey)) fail(`unknown option ${argument}`);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (booleans.has(rawKey)) {
      options[key] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    if (Object.hasOwn(options, key) && key !== "format") fail(`${argument} was provided more than once`);
    options[key] = value;
    index += 1;
  }
  if (!options.adapter) fail("--adapter is required");
  if (!["json", "text"].includes(options.format)) fail("--format must be json or text");
  if (options.expectPlanDigest && !/^[a-f0-9]{64}$/i.test(options.expectPlanDigest)) fail("--expect-plan-digest must be a SHA-256 digest");
  return options;
}

async function readBoundedJson(file, limit, label) {
  const target = path.resolve(file);
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const metadata = await handle.stat();
    if (!metadata.isFile()) fail(`${label} must be a regular non-symlink file`);
    if (metadata.size > limit) fail(`${label} exceeds the size limit`);
    const bytes = await handle.readFile();
    try {
      return { value: JSON.parse(bytes.toString("utf8")), digest: digestValue(bytes.toString("utf8")) };
    } catch {
      fail(`${label} must contain valid JSON`);
    }
  } catch (error) {
    if (error?.code === "ELOOP") fail(`${label} must be a regular non-symlink file`);
    throw error;
  } finally {
    await handle?.close();
  }
}

function printOutput(output, format) {
  if (format === "json") {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  const label = output.type === "halba.import.preview" ? `preview ${output.action}` : output.outcome;
  console.log(`${label}: ${output.adapter} ${output.workspaceId || output.target.workspaceId}/${output.runId || output.target.runId}`);
  console.log(`plan ${output.planDigest}`);
}

async function waitAtConformanceCommitBarrier() {
  if (process.env.HALBA_TEST_IMPORT_COMMIT_BARRIER !== "1") return;
  if (typeof process.send !== "function") fail("test import commit barrier requires an IPC parent");
  process.send({ type: "halba.test.import-plan-ready" });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("test import commit barrier timed out")), 5000);
    process.once("message", (message) => {
      clearTimeout(timeout);
      if (message?.type !== "halba.test.continue-import") reject(new Error("test import commit barrier received an invalid response"));
      else resolve();
    });
  });
}

function fail(message) {
  const error = new Error(`run import failed: ${message}`);
  error.code = "run_import_failed";
  throw error;
}
