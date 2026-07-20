import assert from "node:assert/strict";

import { createReviewDecision } from "../public/shared/review-contract.js";
import { validateWorkspace } from "../public/shared/workspace-contract.js";
import { buildTrustOperations } from "../src/domain/trust-operations.js";
import { buildTrustBenchmark } from "./trust-benchmark-fixture.mjs";

const benchmark = buildTrustBenchmark();
assert.equal(benchmark.runCount, 120);
const report = buildTrustOperations({ contexts: benchmark.contexts, evaluatedAt: benchmark.evaluatedAt });
assert.deepEqual([...report.items.map((item) => item.id)].sort(), benchmark.expectedAttentionIds);
assert.equal(report.items[0].id, benchmark.expectedTopId);
assert.deepEqual(buildTrustOperations({ contexts: benchmark.contexts, evaluatedAt: benchmark.evaluatedAt }), report, "fixed trust inputs must replay byte-for-byte");
assert.equal(report.items.every((item) => item.priority.score === item.priority.components.reduce((sum, component) => sum + component.value, 0)), true);
assert.equal(report.items.every((item) => item.priority.components.every((component) => ["declared-policy", "deterministic-default", "deterministic"].includes(component.authority))), true);
assert.equal(report.items.every((item) => item.target?.workspaceId === item.workspaceId && item.target.kind === item.kind), true, "every attention item must have a discriminated local navigation target");
assert.ok(report.items.find((item) => item.id === "claim:gamma:gamma-release-new").reasons.some((reason) => reason.code === "changed_since_trust"));
assert.ok(report.items.find((item) => item.id === "claim:gamma:gamma-downstream").reasons.some((reason) => reason.code === "dependency_affected"));

const modelDisagreement = structuredClone(benchmark.contexts);
const contradiction = modelDisagreement[0].proofRecords.find((record) => record.threadId === "alpha-contradiction").bundle.adjudication.findings[0];
contradiction.model.assessment = "supported";
const disagreementReport = buildTrustOperations({ contexts: modelDisagreement, evaluatedAt: benchmark.evaluatedAt });
assert.ok(disagreementReport.items.find((item) => item.id === "claim:alpha:alpha-contradiction").reasons.some((reason) => reason.code === "contradiction"), "model text must not overrule the deterministic verdict");

const unsafeApprovalContexts = structuredClone(benchmark.contexts);
const alpha = unsafeApprovalContexts[0];
const unsafeRecord = alpha.proofRecords.find((record) => record.threadId === "alpha-contradiction");
const unsafeFinding = unsafeRecord.bundle.adjudication.findings[0];
alpha.decisions.push(createReviewDecision({
  workspaceId: alpha.workspace.workspace.id,
  threadId: "alpha-contradiction",
  bundleId: unsafeRecord.bundle.id,
  finding: unsafeFinding,
  status: "approved",
  updatedAt: "2026-07-31T13:00:00.000Z"
}));
const unsafeApproval = buildTrustOperations({ contexts: unsafeApprovalContexts, evaluatedAt: benchmark.evaluatedAt });
assert.ok(unsafeApproval.items.find((item) => item.id === "claim:alpha:alpha-contradiction").reasons.some((reason) => reason.code === "unsafe_approval"));

const acknowledgedRiskContexts = structuredClone(benchmark.contexts);
const beta = acknowledgedRiskContexts[1];
const unsupportedRecord = beta.proofRecords.find((record) => record.threadId === "beta-unsupported");
const unsupportedFinding = unsupportedRecord.bundle.adjudication.findings[0];
beta.workspace.trust.bindings.find((binding) => binding.id === "beta-healthy").dependsOn = ["runtime:recovery"];
beta.decisions.push(createReviewDecision({
  workspaceId: beta.workspace.workspace.id,
  threadId: "beta-unsupported",
  bundleId: unsupportedRecord.bundle.id,
  finding: unsupportedFinding,
  status: "resolved",
  updatedAt: "2026-07-31T13:00:00.000Z"
}));
const acknowledgedRisk = buildTrustOperations({ contexts: acknowledgedRiskContexts, evaluatedAt: benchmark.evaluatedAt });
assert.ok(acknowledgedRisk.items.find((item) => item.id === "claim:beta:beta-healthy").reasons.some((reason) => reason.code === "dependency_affected"), "human acknowledgement must not erase deterministic downstream risk");

const boundFailureContexts = structuredClone(benchmark.contexts);
boundFailureContexts[0].workspace.threads.find((thread) => thread.id === "alpha-open").status = "failed";
const boundFailure = buildTrustOperations({ contexts: boundFailureContexts, evaluatedAt: benchmark.evaluatedAt });
assert.ok(boundFailure.items.find((item) => item.id === "claim:alpha:alpha-open").reasons.some((reason) => reason.code === "failed_run"), "failed bound runs must retain their failure signal");

const duplicateGuardContexts = structuredClone(benchmark.contexts);
duplicateGuardContexts[0].proofRecords.find((record) => record.threadId === "alpha-guard").bundle.adjudication.findings[0].guardResults = [
  { type: "receipt", passed: true, explanation: "first duplicate passed" },
  { type: "receipt", passed: false, explanation: "second duplicate failed" }
];
const duplicateGuard = buildTrustOperations({ contexts: duplicateGuardContexts, evaluatedAt: benchmark.evaluatedAt });
assert.ok(duplicateGuard.items.find((item) => item.id === "claim:alpha:alpha-guard").reasons.some((reason) => reason.code === "failed_required_guard"), "every duplicate required guard must pass");

const futureCheckpoint = structuredClone(benchmark.contexts);
futureCheckpoint[0].checkpointAt = "2026-08-02T12:00:00.000Z";
assert.throws(() => buildTrustOperations({ contexts: futureCheckpoint, evaluatedAt: benchmark.evaluatedAt }), /checkpointAt cannot be later/);

const legacy = structuredClone(benchmark.contexts[0].workspace);
delete legacy.trust;
for (const thread of legacy.threads) delete thread.claimIds;
assert.doesNotThrow(() => validateWorkspace(legacy), "trust metadata must remain optional for schema-v1 workspaces");

const unknownDependency = structuredClone(benchmark.contexts[0].workspace);
unknownDependency.trust.bindings[0].dependsOn = ["unknown:claim"];
assert.throws(() => validateWorkspace(unknownDependency), /depends on unknown stable key/);

const cyclicDependency = structuredClone(benchmark.contexts[0].workspace);
cyclicDependency.trust.bindings[0].dependsOn = [cyclicDependency.trust.bindings[1].stableKey];
cyclicDependency.trust.bindings[1].dependsOn = [cyclicDependency.trust.bindings[0].stableKey];
assert.throws(() => validateWorkspace(cyclicDependency), /dependency cycle/);

const implicitLineage = structuredClone(benchmark.contexts[2].workspace);
implicitLineage.trust.bindings.find((binding) => binding.id === "gamma-release-new").supersedes = [];
assert.throws(() => validateWorkspace(implicitLineage), /must explicitly supersede/);

const wrongClaim = structuredClone(benchmark.contexts[0].workspace);
wrongClaim.trust.bindings[0].claimId = "invented-claim";
assert.throws(() => validateWorkspace(wrongClaim), /references unknown claim/);

console.log(`check passed: trust contract rejects implicit authority and cycles; ${report.items.length} gold attention items replay deterministically across 3 workspaces and 120 runs`);
