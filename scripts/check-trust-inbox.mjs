import assert from "node:assert/strict";

import { filterTrustItems, trustInboxSummary, trustReasonLabel, validateTrustOperationsReport } from "../public/trust-inbox.js";
import { buildTrustOperations } from "../src/domain/trust-operations.js";
import { buildTrustBenchmark } from "./trust-benchmark-fixture.mjs";

const benchmark = buildTrustBenchmark();
const fullReport = buildTrustOperations({ contexts: benchmark.contexts, evaluatedAt: benchmark.evaluatedAt });
const report = validateTrustOperationsReport({
  ...fullReport,
  page: { limit: 50, returned: fullReport.items.length, totalItems: fullReport.items.length, truncated: false }
});

assert.deepEqual(report.items.slice(0, 3).map((item) => item.id), [
  "claim:alpha:alpha-contradiction",
  "claim:gamma:gamma-release-new",
  "claim:beta:beta-unsupported"
], "the Monday-morning triage order must remain deterministic");
assert.equal(trustInboxSummary(report).attention, 11);
assert.equal(trustInboxSummary(report).workspaceCount, 3);
assert.ok(filterTrustItems(report.items, "contradiction").some((item) => item.id === benchmark.expectedTopId));
assert.ok(filterTrustItems(report.items, "expired").every((item) => item.reasons.some((reason) => ["decision_expired", "freshness_expired", "stale"].includes(reason.code))));
assert.ok(filterTrustItems(report.items, "imports").every((item) => item.kind === "import"));
assert.equal(trustReasonLabel("future_reason"), "future reason", "future reason codes must remain renderable");

const unsafePage = structuredClone(report);
unsafePage.page.returned += 1;
assert.throws(() => validateTrustOperationsReport(unsafePage), /page returned count/);

console.log("check passed: Trust Inbox validates a bounded response and preserves the exact top-three triage order across 3 workspaces");
