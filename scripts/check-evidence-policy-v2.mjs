import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createReviewDecision, evidenceIdentity, reviewDecisionMatches } from "../public/shared/review-contract.js";
import { buildTrustOperations } from "../src/domain/trust-operations.js";
import { buildAdapterImportPlan, commitAdapterImportPlan } from "../src/importers/adapter-contract.js";
import { loadRunManifest, mergeWorkspaces } from "../src/importers/run-manifest.js";
import { loadProofBundle } from "../src/proof/bundle.js";
import { adjudicateProof } from "../src/proof/engine.js";
import { openLocalStore } from "../src/storage/local-store.js";
import { buildTrustBenchmark } from "./trust-benchmark-fixture.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtures = path.join(root, "data", "import-fixtures");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-evidence-policy-v2-"));

try {
  await checkModelFailsClosed();
  await checkPolicyImportAndDecisionReopening();
  checkPriorityAuthority();
  console.log("check passed: evidence-policy v2 imports through the CLI, preserves immutable lineage, reopens changed decisions, labels default priority honestly, and keeps model-only support non-authoritative");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function checkModelFailsClosed() {
  const bundle = await loadProofBundle(path.join(root, "data", "demo", "bundle.json"));
  const recorded = JSON.parse(await readFile(path.join(root, "data", "demo", "recorded", "gpt-5.6-sol-proof.json"), "utf8"));
  const candidate = recorded.output.claims.find((claim) => claim.claim_id === "judge-ready");
  candidate.assessment = "supported";
  candidate.human_review = false;
  const finding = adjudicateProof(bundle, recorded).findings.find((item) => item.claimId === candidate.claim_id);
  assert.equal(finding.guardResults.length, 0);
  assert.equal(finding.modelAssessment, "supported", "model inference remains inspectable");
  assert.equal(finding.verdict, "uncertain", "model-only support must fail closed");
  assert.equal(finding.verdictAuthority, "fail-closed");
  assert.equal(finding.reviewRequired, true);
}

async function checkPolicyImportAndDecisionReopening() {
  const stateFile = path.join(temporaryRoot, "halba.sqlite");
  const manifest = JSON.parse(await readFile(path.join(fixtures, "codex-run.json"), "utf8"));
  const evidencePolicy = JSON.parse(await readFile(path.join(fixtures, "evidence-policy-v2.json"), "utf8"));
  manifest.evidencePolicy = evidencePolicy;
  const wrongThreadManifest = structuredClone(manifest);
  wrongThreadManifest.evidencePolicy.bindings[0].threadId = "another-run";
  const wrongThreadFile = path.join(temporaryRoot, "wrong-thread-policy.json");
  await writeFile(wrongThreadFile, `${JSON.stringify(wrongThreadManifest, null, 2)}\n`, "utf8");
  await assert.rejects(loadRunManifest(wrongThreadFile), /evidencePolicy packet is invalid.*must reference packet thread/i);
  const manifestFile = path.join(temporaryRoot, "codex-run-policy-v2.json");
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const imported = spawnSync(process.execPath, [
    "--disable-warning=ExperimentalWarning", "scripts/import-run.mjs",
    "--adapter", "codex",
    "--manifest", manifestFile,
    "--source", path.join(fixtures, "codex-session-clean.jsonl"),
    "--bundle", path.join(fixtures, "codex-proof", "bundle.json"),
    "--proof-output", path.join(fixtures, "codex-proof", "proof-output.json"),
    "--state", stateFile
  ], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);

  const store = await openLocalStore(stateFile);
  try {
    const current = store.getWorkspace("operator-lab");
    assert.deepEqual(current.trust, evidencePolicy, "the bounded manifest policy packet must reach durable state");

    const unchangedIncoming = structuredClone(current);
    delete unchangedIncoming.trust;
    const rewritten = structuredClone(evidencePolicy);
    rewritten.bindings[0].criticality = "low";
    assert.throws(
      () => mergeWorkspaces(current, unchangedIncoming, { evidencePolicy: rewritten }),
      /binding id operator-contract-safety is immutable.*append a new binding/i
    );

    const nextIncoming = structuredClone(unchangedIncoming);
    const nextThread = structuredClone(nextIncoming.threads[0]);
    nextThread.id = "codex-contract-check-v2";
    nextThread.updatedAt = "2026-07-18T08:01:05.000Z";
    nextThread.completedAt = nextThread.updatedAt;
    nextIncoming.threads = [nextThread];
    const successorPolicy = {
      ...structuredClone(evidencePolicy),
      bindings: [{
        ...structuredClone(evidencePolicy.bindings[0]),
        id: "operator-contract-safety-v2",
        threadId: nextThread.id,
        supersedes: ["operator-contract-safety"]
      }]
    };
    const explicitlyAdvanced = mergeWorkspaces(current, nextIncoming, { evidencePolicy: successorPolicy });
    assert.deepEqual(explicitlyAdvanced.trust.bindings.map((binding) => binding.id), ["operator-contract-safety", "operator-contract-safety-v2"]);

    const originalBundleId = current.threads[0].proofBundleId;
    const originalRecord = store.getProofBundle(originalBundleId);
    const originalFinding = originalRecord.adjudication.findings.find((finding) => finding.claimId === "universally-safe");
    const scope = { workspaceId: "operator-lab", threadId: current.threads[0].id, bundleId: originalBundleId, claimId: originalFinding.claimId };
    const decision = createReviewDecision({ ...scope, finding: originalFinding, status: "approved", updatedAt: "2026-07-18T08:00:30.000Z" });
    store.saveReviewDecision(decision);

    const changedRecord = structuredClone(originalRecord);
    changedRecord.id = `${originalBundleId}-v2`;
    changedRecord.definition.id = changedRecord.id;
    changedRecord.adjudication.bundle.id = changedRecord.id;
    const changedFinding = changedRecord.adjudication.findings.find((finding) => finding.claimId === originalFinding.claimId);
    changedFinding.verdict = "unsupported";
    changedFinding.verdictAuthority = "deterministic";
    changedRecord.adjudication.counts.uncertain -= 1;
    changedRecord.adjudication.counts.unsupported += 1;

    const changedWorkspace = structuredClone(current);
    delete changedWorkspace.trust;
    const changedThread = changedWorkspace.threads[0];
    changedThread.updatedAt = "2026-07-18T08:02:05.000Z";
    changedThread.completedAt = changedThread.updatedAt;
    changedThread.proofBundleId = changedRecord.id;
    changedThread.verdictCounts.uncertain -= 1;
    changedThread.verdictCounts.unsupported += 1;
    changedThread.reviewEvidence[changedFinding.claimId] = evidenceIdentity(changedFinding);

    const changedDigest = createHash("sha256").update(JSON.stringify(changedRecord)).digest("hex");
    const plan = buildAdapterImportPlan({
      store,
      adapterId: "codex-session-v1",
      inputName: "codex",
      incoming: changedWorkspace,
      sourceRef: "changed-evidence.json",
      sourceDigest: changedDigest,
      observedAt: changedThread.updatedAt,
      proofBundle: changedRecord,
      sourceRoot: path.join(fixtures, "codex-proof")
    });
    assert.deepEqual(plan.preview.changes.decisions, {
      applicableBefore: 1,
      applicableAfter: 0,
      reopened: 1,
      affectedClaimIds: [changedFinding.claimId]
    });
    const receipt = await commitAdapterImportPlan(store, plan);
    assert.equal(receipt.changes.decisionsReopened, 1);
    assert.equal(reviewDecisionMatches(store.getReviewDecision(scope), scope, evidenceIdentity(changedFinding)), false);
  } finally {
    store.close();
  }
}

function checkPriorityAuthority() {
  const benchmark = buildTrustBenchmark();
  const report = buildTrustOperations({ contexts: benchmark.contexts, evaluatedAt: benchmark.evaluatedAt });
  const failedRun = report.items.find((item) => item.kind === "run");
  const degradedImport = report.items.find((item) => item.kind === "import");
  const claim = report.items.find((item) => item.kind === "claim");
  assert.equal(failedRun.priority.components[0].authority, "deterministic-default");
  assert.equal(degradedImport.priority.components[0].authority, "deterministic-default");
  assert.equal(claim.priority.components[0].authority, "declared-policy");

  const legacyAuthority = structuredClone(benchmark.contexts);
  const legacyFinding = legacyAuthority[1].proofRecords.find((record) => record.threadId === "beta-healthy").bundle.adjudication.findings[0];
  delete legacyFinding.verdictAuthority;
  legacyFinding.modelAssessment = "supported";
  const legacyReport = buildTrustOperations({ contexts: legacyAuthority, evaluatedAt: benchmark.evaluatedAt });
  assert.ok(
    legacyReport.items.find((item) => item.id === "claim:beta:beta-healthy")?.reasons.some((reason) => reason.code === "non_authoritative_verdict"),
    "stored verdicts without deterministic authority must fail closed"
  );
}
