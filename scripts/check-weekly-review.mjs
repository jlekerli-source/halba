import assert from "node:assert/strict";

import { buildWeeklyReview, weeklyReviewMarkdown } from "../src/domain/weekly-review.js";

const evidence = "evidence-v1";
const workspace = {
  workspace: { id: "operator-lab", name: "Operator Lab" },
  threads: [{
    id: "run-1", channelId: "build", agentId: "codex", title: "Contract check",
    status: "needs_review", proofState: "ready", proofBundleId: "bundle-1",
    updatedAt: "2026-07-17T12:00:00.000Z", claimCount: 2,
    reviewClaimIds: ["safety"], reviewEvidence: { safety: evidence }
  }]
};
const scope = { schemaVersion: 1, workspaceId: "operator-lab", threadId: "run-1", bundleId: "bundle-1", claimId: "safety", evidenceIdentity: evidence };
const claimHistory = {
  workspaceId: "operator-lab",
  claims: [{ state: "stale", threadId: "run-1", bundleId: "bundle-1", claimId: "contract", claim: "The contract is current.", verdict: "supported", generatedAt: "2026-07-09T12:00:00.000Z", reasons: ["supported proof is older than the 7-day history window"] }]
};
const receipt = { id: "receipt-1", adapter: "codex-session-v1", status: "accepted", sourceDigest: "a".repeat(64), importedAt: "2026-07-17T12:00:00.000Z" };

const open = buildWeeklyReview({
  workspace,
  claimHistory,
  decisions: [{ ...scope, status: "more-proof", note: "Need receipt", updatedAt: "2026-07-17T13:00:00.000Z" }],
  receipts: [receipt],
  generatedAt: "2026-07-18T12:00:00.000Z"
});
assert.deepEqual(open.counts, { runs: 1, completed: 0, failed: 0, running: 0, openReviewGates: 1, staleClaims: 1, supersededClaims: 0, decisions: 1, imports: 1 });
const markdown = weeklyReviewMarkdown(open);
assert.match(markdown, /Operator Lab weekly evidence review/);
assert.match(markdown, /run-1 \/ bundle-1 \/ contract/);
assert.match(markdown, /Need receipt/);
assert.match(markdown, new RegExp(receipt.sourceDigest));

const closed = buildWeeklyReview({
  workspace,
  claimHistory,
  decisions: [{ ...scope, status: "resolved", note: "Receipt checked", updatedAt: "2026-07-17T13:00:00.000Z" }],
  generatedAt: "2026-07-18T12:00:00.000Z"
});
assert.equal(closed.counts.openReviewGates, 0);
assert.throws(() => buildWeeklyReview({ workspace, claimHistory: { workspaceId: "wrong", claims: [] } }), /matching claim history/);

console.log("check passed: canonical weekly review exports run status, open gates, stale claims, decisions, and import digests");
