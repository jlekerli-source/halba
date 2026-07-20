import assert from "node:assert/strict";

import { evidenceIdentity } from "../public/shared/review-contract.js";
import { analyzeClaimHistory } from "../src/domain/claim-history.js";

const finding = (claimId, claim, verdict, hash) => ({
  claimId,
  claim,
  verdict,
  citations: [{ valid: true, path: "report.md", startLine: 1, endLine: 1, sourceSha256: hash }],
  guardResults: []
});
const proofRecord = (id, threadId, generatedAt, findings) => ({
  threadId,
  bundle: { id, adjudication: { bundle: { id, generatedAt }, findings } }
});
const thread = (id, updatedAt, proofBundleId) => ({ id, agentId: "codex", channelId: "build", updatedAt, proofBundleId });
const workspace = {
  workspace: { id: "history" },
  threads: [
    thread("run-1", "2026-07-01T10:00:00.000Z", "bundle-1"),
    thread("run-2", "2026-07-10T10:00:00.000Z", "bundle-2"),
    thread("run-3", "2026-07-12T10:00:00.000Z", null)
  ]
};
const oldFinding = finding("contract", "The contract is canonical.", "supported", "a".repeat(64));
const newFinding = finding("contract", "The contract is canonical.", "supported", "b".repeat(64));
const explicitStale = finding("privacy", "The audit is current.", "stale", "c".repeat(64));
const report = analyzeClaimHistory({
  workspace,
  proofRecords: [
    proofRecord("bundle-1", "run-1", "2026-07-01T10:00:00.000Z", [oldFinding]),
    proofRecord("bundle-2", "run-2", "2026-07-10T10:00:00.000Z", [newFinding, explicitStale])
  ],
  evaluatedAt: "2026-07-18T10:00:00.000Z",
  maxAgeDays: 7
});

assert.deepEqual(report.counts, { current: 0, stale: 2, superseded: 1 });
const superseded = report.claims.find((claim) => claim.bundleId === "bundle-1");
assert.equal(superseded.state, "superseded");
assert.equal(superseded.supersededBy.bundleId, "bundle-2");
assert.notEqual(superseded.evidenceIdentity, evidenceIdentity(newFinding));
const currentContract = report.claims.find((claim) => claim.bundleId === "bundle-2" && claim.claimId === "contract");
assert.equal(currentContract.state, "stale");
assert.match(currentContract.reasons.join(" "), /older than the 7-day|newer run run-3/);
assert.equal(report.claims.find((claim) => claim.claimId === "privacy").state, "stale");

const exactBoundary = analyzeClaimHistory({
  workspace: { ...workspace, threads: workspace.threads.slice(0, 2) },
  proofRecords: [proofRecord("bundle-2", "run-2", "2026-07-10T10:00:00.000Z", [newFinding])],
  evaluatedAt: "2026-07-17T10:00:00.000Z",
  maxAgeDays: 7
});
assert.equal(exactBoundary.claims[0].state, "current", "the exact freshness boundary remains current");
assert.throws(() => analyzeClaimHistory({ workspace, proofRecords: [], evaluatedAt: "bad" }), /evaluation time/);

console.log("check passed: claim history marks superseded, aged, explicitly stale, and advanced-run proof without changing the freshness boundary");
