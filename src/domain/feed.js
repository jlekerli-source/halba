import { isStale } from "./stale.js";

export const importRunRetention = 20;

export function latestPostTime(post) {
  const replyTimes = (post.replies || []).map((reply) => new Date(reply.createdAt).getTime());
  return Math.max(new Date(post.createdAt).getTime(), 0, ...replyTimes);
}

export function importReceiptSummary(feed) {
  const posts = feed?.posts || [];
  const qa = feed?.qa || [];
  return {
    source: feed?.source || "local files",
    generatedAt: feed?.generatedAt || "unknown",
    projectCount: (feed?.projects || []).length,
    evidenceCount: posts.reduce((count, post) => count + (post.evidence || []).length, 0),
    focusCount: (feed?.focus || []).length,
    qaCount: qa.length,
    redQaCount: qa.filter((item) => item.severity === "red").length
  };
}

export function reviewGateSummary(feed, {
  visibleFocusCount = (feed?.focus || []).length,
  now = new Date()
} = {}) {
  const qa = feed?.qa || [];
  return {
    staleProjectCount: (feed?.projects || []).filter((project) => isStale(project, now)).length,
    redQaCount: qa.filter((item) => item.severity === "red").length,
    amberQaCount: qa.filter((item) => item.severity === "amber").length,
    visibleFocusCount,
    weeklyExportProjectCount: (feed?.projects || []).length
  };
}

export function reviewGateStatus(gate) {
  if (gate.redQaCount || gate.staleProjectCount) return "Blocked";
  if (gate.amberQaCount || gate.visibleFocusCount) return "Review";
  return "Clear";
}

export function reviewGateReceipt(feed, options = {}) {
  const gate = reviewGateSummary(feed, options);
  const receipt = importReceiptSummary(feed);
  return [
    "Halba Review Gate",
    `status: ${reviewGateStatus(gate)}`,
    `source: ${receipt.source}`,
    `generated: ${receipt.generatedAt}`,
    options.scopeLabel ? `scope: ${options.scopeLabel}` : "",
    options.filterLabel ? `filters: ${options.filterLabel}` : "",
    `scope projects: ${gate.weeklyExportProjectCount}`,
    `stale projects: ${gate.staleProjectCount}`,
    `red QA blockers: ${gate.redQaCount}`,
    `amber QA issues: ${gate.amberQaCount}`,
    `review focus shown: ${gate.visibleFocusCount}`,
    `weekly export projects: ${gate.weeklyExportProjectCount}`
  ].filter(Boolean).join("\n");
}

export function importRunReceipt(feed, { importedAt = new Date().toISOString() } = {}) {
  const receipt = importReceiptSummary(feed);
  const evidenceCounts = projectEvidenceCounts(feed?.posts || []);
  const warnings = (feed?.qa || []).map((item) => ({
    severity: item.severity,
    kind: item.kind,
    projectId: item.projectId,
    text: item.text,
    path: item.path || ""
  }));
  return {
    id: `${importedAt.replace(/[:.]/g, "-")}-${slug(receipt.source)}`,
    importedAt,
    source: receipt.source,
    generatedAt: receipt.generatedAt,
    projectCount: receipt.projectCount,
    evidenceCount: receipt.evidenceCount,
    reviewFocusCount: receipt.focusCount,
    qaCount: receipt.qaCount,
    redQaCount: receipt.redQaCount,
    warningCount: warnings.length,
    warnings,
    projects: (feed?.projects || []).map((project) => ({
      projectId: project.id,
      claim: project.claim || "",
      health: project.health,
      lastProofDate: project.lastProofDate,
      stale: isStale(project, new Date(importedAt)),
      evidenceCount: evidenceCounts.get(project.id) || 0,
      nextGoal: project.review?.nextGoal || "",
      whatToStop: project.review?.whatToStop || ""
    })),
    evidence: evidenceReceipts(feed?.posts || [])
  };
}

export function mergeImportRunHistory(history, receipt, retention = importRunRetention) {
  const priorRuns = Array.isArray(history?.runs) ? history.runs : [];
  const runs = [
    receipt,
    ...priorRuns.filter((run) => run.id !== receipt.id)
  ].slice(0, retention);
  return { retention, runs };
}

export function importRunDelta(history) {
  const [latest, prior] = Array.isArray(history?.runs) ? history.runs : [];
  if (!latest) return { status: "no runs", changes: [] };
  if (!prior) return { status: "no prior run", latest, changes: [] };

  const fields = ["generatedAt", "projectCount", "evidenceCount", "reviewFocusCount", "qaCount", "redQaCount"];
  const changes = fields
    .filter((field) => latest[field] !== prior[field])
    .map((field) => ({ field, before: prior[field], after: latest[field] }));

  const latestWarnings = warningSignatures(latest);
  const priorWarnings = warningSignatures(prior);
  const addedWarnings = latestWarnings.filter((item) => !priorWarnings.includes(item));
  const removedWarnings = priorWarnings.filter((item) => !latestWarnings.includes(item));
  if (addedWarnings.length || removedWarnings.length) {
    changes.push({ field: "warningSignatures", added: addedWarnings, removed: removedWarnings });
  }

  const projectChange = projectRunDelta(latest, prior);
  if (projectChange.added.length || projectChange.removed.length || projectChange.changed.length) {
    changes.push({ field: "projects", ...projectChange });
  }

  const evidenceChange = evidenceRunDelta(latest, prior);
  if (evidenceChange.added.length || evidenceChange.removed.length || evidenceChange.statusChanged.length) {
    changes.push({ field: "evidence", ...evidenceChange });
  }

  return {
    status: changes.length ? "changed" : "unchanged",
    latest,
    prior,
    changes
  };
}

export function formatImportRunDelta(delta) {
  if (delta.status === "no runs") return "Import delta: no runs";
  if (delta.status === "no prior run") return `Import delta: no prior run for ${delta.latest.id}`;
  if (delta.status === "unchanged") return `Import delta: unchanged since ${delta.prior.id}`;
  return [
    `Import delta: changed since ${delta.prior.id}`,
    ...delta.changes.map((change) => {
      if (change.field === "warningSignatures") {
        return `- warnings added ${change.added.length}, removed ${change.removed.length}`;
      }
      if (change.field === "projects") {
        return `- projects added ${change.added.length}, removed ${change.removed.length}, changed ${change.changed.length}`;
      }
      if (change.field === "evidence") {
        return `- evidence added ${change.added.length}, removed ${change.removed.length}, status changed ${change.statusChanged.length}`;
      }
      return `- ${change.field}: ${change.before} -> ${change.after}`;
    })
  ].join("\n");
}

export function formatImportRunDeltaDetails(delta) {
  const summary = formatImportRunDelta(delta);
  const projectChange = (delta.changes || []).find((change) => change.field === "projects");
  const evidenceChange = (delta.changes || []).find((change) => change.field === "evidence");

  return [
    summary,
    projectChange?.added.length ? `projects added: ${projectChange.added.join(", ")}` : "",
    projectChange?.removed.length ? `projects removed: ${projectChange.removed.join(", ")}` : "",
    projectChange?.changed.length ? "projects changed:" : "",
    ...(projectChange?.changed || []).map((project) => `- ${project.projectId}: ${project.changes.map(formatProjectFieldChange).join("; ")}`),
    evidenceChange?.added.length ? "evidence added:" : "",
    ...(evidenceChange?.added || []).map((record) => `- ${formatEvidenceRecord(record)}`),
    evidenceChange?.removed.length ? "evidence removed:" : "",
    ...(evidenceChange?.removed || []).map((record) => `- ${formatEvidenceRecord(record)}`),
    evidenceChange?.statusChanged.length ? "evidence status changed:" : "",
    ...(evidenceChange?.statusChanged || []).map((record) => `- ${formatEvidenceRecord(record)}: ${record.before} -> ${record.after}`)
  ].filter(Boolean).join("\n");
}

export function importDeltaCopyText(feed, detailText = "") {
  const receipt = importReceiptSummary(feed);
  const header = [
    "Import Delta",
    `source: ${receipt.source}`,
    `generated: ${receipt.generatedAt}`
  ].join("\n");
  return detailText ? `${header}\n\n${detailText}` : header;
}

function evidenceReceipts(posts) {
  return posts.flatMap((post) => (post.evidence || []).map((item) => ({
    projectId: post.projectId,
    kind: item.kind,
    label: item.label,
    path: item.path,
    status: item.status
  })));
}

function projectEvidenceCounts(posts) {
  const counts = new Map();
  for (const post of posts) {
    counts.set(post.projectId, (counts.get(post.projectId) || 0) + (post.evidence || []).length);
  }
  return counts;
}

function projectRunDelta(latest, prior) {
  const latestProjects = Array.isArray(latest?.projects) ? latest.projects : [];
  const priorProjects = Array.isArray(prior?.projects) ? prior.projects : [];
  const latestById = new Map(latestProjects.map((project) => [project.projectId, project]));
  const priorById = new Map(priorProjects.map((project) => [project.projectId, project]));
  const fields = ["claim", "health", "lastProofDate", "stale", "evidenceCount", "nextGoal", "whatToStop"];
  return {
    added: latestProjects.filter((project) => !priorById.has(project.projectId)).map((project) => project.projectId),
    removed: priorProjects.filter((project) => !latestById.has(project.projectId)).map((project) => project.projectId),
    changed: latestProjects
      .filter((project) => priorById.has(project.projectId))
      .map((project) => ({
        projectId: project.projectId,
        changes: fields
          .filter((field) => project[field] !== priorById.get(project.projectId)[field])
          .map((field) => ({ field, before: priorById.get(project.projectId)[field], after: project[field] }))
      }))
      .filter((project) => project.changes.length)
  };
}

function evidenceRunDelta(latest, prior) {
  const latestEvidence = Array.isArray(latest?.evidence) ? latest.evidence : [];
  const priorEvidence = Array.isArray(prior?.evidence) ? prior.evidence : [];
  const latestByKey = new Map(latestEvidence.map((record) => [evidenceKey(record), record]));
  const priorByKey = new Map(priorEvidence.map((record) => [evidenceKey(record), record]));
  return {
    added: latestEvidence.filter((record) => !priorByKey.has(evidenceKey(record))),
    removed: priorEvidence.filter((record) => !latestByKey.has(evidenceKey(record))),
    statusChanged: latestEvidence
      .filter((record) => priorByKey.has(evidenceKey(record)) && record.status !== priorByKey.get(evidenceKey(record)).status)
      .map((record) => ({ ...record, before: priorByKey.get(evidenceKey(record)).status, after: record.status }))
  };
}

function formatProjectFieldChange(change) {
  return `${change.field} ${formatProjectFieldValue(change.before)} -> ${formatProjectFieldValue(change.after)}`;
}

function formatProjectFieldValue(value) {
  if (value === undefined || value === null) return "(missing)";
  if (value === "") return "(blank)";
  return String(value);
}

function formatEvidenceRecord(record) {
  return `${record.projectId} / ${record.kind} / ${record.label} / ${record.path}`;
}

function evidenceKey(record) {
  return [record.projectId, record.kind, record.label, record.path].join("|");
}

function warningSignatures(run) {
  return (run?.warnings || [])
    .map((item) => [item.severity, item.kind, item.projectId, item.text, item.path || ""].join("|"))
    .sort();
}

function slug(value) {
  return String(value || "local")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "local";
}
