import { isStale } from "./stale.js";

export function reviewExport(feed, now = new Date()) {
  return feed.projects
    .map((project) => {
      const stale = isStale(project, now) ? "STALE" : "CURRENT";
      const source = project.review?.sourcePath || project.statusFile || "";
      return [
        `## ${project.name}`,
        `evidence: ${project.lastProofDate} (${stale})${project.evidenceLabel ? ` - ${project.evidenceLabel}` : ""}`,
        `source: ${source}`,
        `health: ${project.health}`,
        `next measurable goal: ${project.review?.nextGoal || project.claim}`,
        `what to stop: ${project.review?.whatToStop || project.stopCondition || "unsourced status claims"}`,
        `lane status: ${project.lane}`
      ].join("\n");
    })
    .join("\n\n");
}

export function reviewExportCopyText(feed, scopeLabel = "", now = new Date()) {
  return [
    "Weekly Export",
    scopeLabel ? `scope: ${scopeLabel}` : "",
    feed?.source ? `source: ${feed.source}` : "",
    feed?.generatedAt ? `generated: ${feed.generatedAt}` : "",
    `projects: ${(feed?.projects || []).length}`,
    "",
    reviewExport(feed, now)
  ].filter((line, index) => index >= 3 || line).join("\n");
}
