import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { validateImportedWorkspace } from "../public/workspace-import.js";
import { decisionClosesGate, shouldAdvanceReviewSelection } from "../public/workspace-state.js";
import {
  createReviewDecision,
  evidenceIdentity,
  reviewDecisionKey,
  reviewDecisionMatches
} from "../public/shared/review-contract.js";
import { validateWorkspace } from "../src/domain/workspace.js";

const workspace = JSON.parse(await readFile(new URL("../data/demo/workspace.json", import.meta.url), "utf8"));
assert.equal(validateImportedWorkspace(structuredClone(workspace)).threads.length, 4);

const unknownAgent = structuredClone(workspace);
unknownAgent.threads[0].agentId = "missing-agent";
assert.throws(() => validateImportedWorkspace(unknownAgent), /references an unknown agent/);
assert.throws(() => validateWorkspace(unknownAgent), /references an unknown agent/);

const mismatchedClaims = structuredClone(workspace);
mismatchedClaims.threads[0].claimCount += 1;
if (mismatchedClaims.threads[0].claimIds) mismatchedClaims.threads[0].claimIds.push("unaccounted-claim");
assert.throws(() => validateImportedWorkspace(mismatchedClaims), /verdicts must match/);

const unsafeEvent = structuredClone(workspace);
unsafeEvent.threads[0].events[0].id = "../../private";
assert.throws(() => validateImportedWorkspace(unsafeEvent), /safe slugs/);

assert.equal(decisionClosesGate({ status: "approved" }), true);
assert.equal(decisionClosesGate({ status: "rejected" }), true);
assert.equal(decisionClosesGate({ status: "resolved" }), true);
assert.equal(decisionClosesGate({ status: "more-proof" }), false);
assert.equal(shouldAdvanceReviewSelection("more-proof"), false, "requesting proof must keep the current gate selected");
assert.equal(shouldAdvanceReviewSelection("approved"), true, "closing a gate should advance the review queue");

const scope = {
  workspaceId: workspace.workspace.id,
  threadId: workspace.threads[0].id,
  bundleId: workspace.threads[0].proofBundleId,
  claimId: "deployed"
};
const finding = {
  claimId: "deployed",
  claim: "The demo is deployed.",
  verdict: "unsupported",
  citations: [{ valid: true, path: "report.md", startLine: 1, endLine: 2, sourceSha256: "a".repeat(64) }],
  guardResults: [{ type: "source", passed: false, explanation: "No deployment receipt." }]
};
const decision = createReviewDecision({ ...scope, finding, status: "approved", note: "Checked locally", updatedAt: "2026-07-17T12:00:00.000Z" });
assert.equal(reviewDecisionMatches(decision, scope, evidenceIdentity(finding)), true);
assert.equal(reviewDecisionMatches(decision, { ...scope, bundleId: "another-bundle" }, evidenceIdentity(finding)), false, "decisions must not cross bundle boundaries");
const changedFinding = structuredClone(finding);
changedFinding.citations[0].sourceSha256 = "b".repeat(64);
assert.equal(reviewDecisionMatches(decision, scope, evidenceIdentity(changedFinding)), false, "changed evidence must reopen the decision");
const changedGuard = structuredClone(finding);
changedGuard.guardResults[0].explanation = "A newer receipt was found.";
assert.equal(reviewDecisionMatches(decision, scope, evidenceIdentity(changedGuard)), false, "changed guard evidence must reopen the decision");
assert.notEqual(reviewDecisionKey(scope), reviewDecisionKey({ ...scope, threadId: "another-thread" }));

console.log("check passed: shared workspace validation rejects unsafe boundaries and evidence-scoped decisions reopen on change");
