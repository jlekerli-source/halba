import assert from "node:assert/strict";
import { importReceiptSummary, importRunReceipt, mergeImportRunHistory, latestPostTime, reviewGateReceipt, reviewGateStatus, reviewGateSummary } from "../src/domain/feed.js";

const post = {
  createdAt: "2026-06-01T12:00:00Z",
  replies: [
    { createdAt: "2026-06-03T12:00:00Z" },
    { createdAt: "2026-06-02T12:00:00Z" }
  ]
};

assert.equal(latestPostTime(post), new Date("2026-06-03T12:00:00Z").getTime());
assert.equal(latestPostTime({ createdAt: "2026-06-01T12:00:00Z", replies: [] }), new Date("2026-06-01T12:00:00Z").getTime());
assert.deepEqual(importReceiptSummary({
  generatedAt: "2026-06-21",
  source: "Demo Bundle",
  projects: [{ id: "sample-research" }, { id: "sample-build" }],
  posts: [{ evidence: [{}, {}] }, { evidence: [{}] }],
  focus: [{}, {}],
  qa: [{ severity: "amber" }, { severity: "red" }]
}), {
  source: "Demo Bundle",
  generatedAt: "2026-06-21",
  projectCount: 2,
  evidenceCount: 3,
  focusCount: 2,
  qaCount: 2,
  redQaCount: 1
});
assert.deepEqual(reviewGateSummary({
  generatedAt: "2026-06-21",
  source: "Demo Bundle",
  projects: [
    { lastProofDate: "2026-06-01", proofWindowDays: 7 },
    { lastProofDate: "2026-06-21", proofWindowDays: 14 }
  ],
  qa: [{ severity: "amber" }, { severity: "red" }]
}, {
  visibleFocusCount: 4,
  now: new Date("2026-06-23T12:00:00Z")
}), {
  staleProjectCount: 1,
  redQaCount: 1,
  amberQaCount: 1,
  visibleFocusCount: 4,
  weeklyExportProjectCount: 2
});
assert.equal(reviewGateStatus({ staleProjectCount: 0, redQaCount: 0, amberQaCount: 1, visibleFocusCount: 0 }), "Review");
const gateReceipt = reviewGateReceipt({
  generatedAt: "2026-06-21",
  source: "Demo Bundle",
  projects: [{ lastProofDate: "2026-06-21", proofWindowDays: 14 }],
  qa: [{ severity: "amber" }]
}, {
  visibleFocusCount: 0,
  scopeLabel: "All projects / 1 project",
  filterLabel: 'search "release proof"',
  now: new Date("2026-06-23T12:00:00Z")
});
assert.ok(gateReceipt.includes("source: Demo Bundle"));
assert.ok(gateReceipt.includes("scope: All projects / 1 project"));
assert.ok(gateReceipt.includes('filters: search "release proof"'));
const runReceipt = importRunReceipt({
  generatedAt: "2026-06-21",
  source: "Demo Bundle",
  projects: [{ id: "sample-build" }],
  posts: [{ evidence: [{}, {}] }],
  focus: [{}],
  qa: [{ severity: "amber", kind: "review", projectId: "sample-build", text: "Missing review field.", path: "sample/build.md" }]
}, { importedAt: "2026-06-23T12:00:00.000Z" });
assert.equal(runReceipt.id, "2026-06-23T12-00-00-000Z-demo-bundle");
assert.equal(runReceipt.warningCount, 1);
assert.deepEqual(mergeImportRunHistory({ runs: [{ id: "old" }, { id: "older" }] }, runReceipt, 2).runs.map((run) => run.id), [
  runReceipt.id,
  "old"
]);

console.log("check passed: feed sorting uses latest post or reply time");
