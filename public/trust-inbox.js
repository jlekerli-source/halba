export const trustInboxFilters = Object.freeze(["all", "new", "critical", "contradiction", "expired", "imports"]);

const reasonLabels = Object.freeze({
  contradiction: "Contradiction",
  unsafe_approval: "Unsafe approval",
  ambiguous_lineage: "Ambiguous lineage",
  failed_required_guard: "Failed guard",
  non_authoritative_verdict: "Non-authoritative verdict",
  changed_since_trust: "Changed since trust",
  unsupported: "Unsupported",
  dependency_affected: "Dependency affected",
  missing_required_guard: "Missing guard",
  uncertain: "Uncertain",
  decision_expired: "Decision expired",
  failed_run: "Failed run",
  stale: "Stale proof",
  freshness_expired: "Freshness expired",
  human_review_required: "Human review required",
  proof_requested: "More proof requested",
  missing_proof: "Missing proof",
  degraded_import: "Degraded import"
});

export function trustReasonLabel(code) {
  return reasonLabels[code] || String(code || "Attention").replaceAll("_", " ");
}

export function filterTrustItems(items, filter = "all") {
  const list = Array.isArray(items) ? items : [];
  const selected = trustInboxFilters.includes(filter) ? filter : "all";
  if (selected === "all") return list;
  if (selected === "new") return list.filter((item) => item.newSinceCheckpoint);
  if (selected === "critical") return list.filter((item) => item.criticality === "critical");
  if (selected === "contradiction") return list.filter((item) => item.reasons?.some((reason) => reason.code === "contradiction" || reason.code === "unsafe_approval"));
  if (selected === "expired") return list.filter((item) => item.reasons?.some((reason) => reason.code === "decision_expired" || reason.code === "freshness_expired" || reason.code === "stale"));
  return list.filter((item) => item.kind === "import");
}

export function trustPrimaryReason(item) {
  return item?.reasons?.[0] || { code: "attention", explanation: "This item requires operator attention." };
}

export function trustInboxSummary(report) {
  const items = Array.isArray(report?.items) ? report.items : [];
  return {
    attention: items.length,
    newCount: items.filter((item) => item.newSinceCheckpoint).length,
    criticalCount: items.filter((item) => item.criticality === "critical").length,
    workspaceCount: Number.isInteger(report?.workspaceCount) ? report.workspaceCount : 0
  };
}

export function validateTrustOperationsReport(report) {
  invariant(report && typeof report === "object" && !Array.isArray(report), "report must be an object");
  invariant(report.schemaVersion === 1, "schemaVersion must be 1");
  invariant(validTimestamp(report.evaluatedAt), "evaluatedAt must be a timestamp");
  invariant(Number.isInteger(report.workspaceCount) && report.workspaceCount >= 1 && report.workspaceCount <= 64, "workspaceCount is invalid");
  invariant(report.counts && Number.isInteger(report.counts.attention) && report.counts.attention >= 0, "attention count is invalid");
  invariant(Array.isArray(report.items) && report.items.length <= 100, "items must be a bounded array");
  if (report.page !== undefined) {
    invariant(report.page && Number.isInteger(report.page.limit) && report.page.limit >= 1 && report.page.limit <= 100, "page limit is invalid");
    invariant(Number.isInteger(report.page.returned) && report.page.returned === report.items.length, "page returned count is invalid");
    invariant(Number.isInteger(report.page.totalItems) && report.page.totalItems >= report.page.returned, "page total is invalid");
    invariant(report.page.truncated === (report.page.totalItems > report.page.returned), "page truncation state is invalid");
  }
  const ids = new Set();
  for (const item of report.items) {
    invariant(item && typeof item.id === "string" && item.id.length <= 300 && !ids.has(item.id), "item ids must be unique bounded strings");
    ids.add(item.id);
    invariant(["claim", "run", "import"].includes(item.kind), `item ${item.id} kind is invalid`);
    invariant(["low", "medium", "high", "critical"].includes(item.criticality), `item ${item.id} criticality is invalid`);
    invariant(validTimestamp(item.updatedAt), `item ${item.id} updatedAt is invalid`);
    invariant(item.priority && Number.isFinite(item.priority.score) && Array.isArray(item.priority.components), `item ${item.id} priority is invalid`);
    invariant(Array.isArray(item.reasons) && item.reasons.length > 0, `item ${item.id} reasons are invalid`);
    invariant(item.reasons.every((reason) => typeof reason.code === "string" && typeof reason.explanation === "string"), `item ${item.id} reason is invalid`);
    invariant(item.target?.kind === item.kind && item.target.workspaceId === item.workspaceId, `item ${item.id} target is invalid`);
    if (item.kind === "claim") invariant(typeof item.target.threadId === "string" && (item.target.bundleId === null || typeof item.target.bundleId === "string") && typeof item.target.claimId === "string" && (item.target.evidenceIdentity === null || typeof item.target.evidenceIdentity === "string"), `item ${item.id} claim target is invalid`);
    if (item.kind === "run") invariant(typeof item.target.threadId === "string", `item ${item.id} run target is invalid`);
    if (item.kind === "import") invariant(typeof item.target.receiptId === "string", `item ${item.id} import target is invalid`);
  }
  return report;
}

function invariant(condition, message) {
  if (!condition) throw new Error(`invalid Trust Operations response: ${message}`);
}

function validTimestamp(value) {
  return typeof value === "string" && value.includes("T") && Number.isFinite(Date.parse(value));
}
