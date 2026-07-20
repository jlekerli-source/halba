import { decisionClosesGate, reviewDecisionKey, reviewDecisionMatches } from "../../public/shared/review-contract.js";

export const weeklyReviewSchemaVersion = 1;

export function buildWeeklyReview({ workspace, claimHistory, decisions = [], receipts = [], generatedAt = new Date().toISOString(), windowDays = 7 }) {
  if (!workspace?.workspace?.id || !Array.isArray(workspace.threads)) throw new Error("weekly review requires a workspace");
  if (claimHistory?.workspaceId !== workspace.workspace.id || !Array.isArray(claimHistory.claims)) throw new Error("weekly review requires matching claim history");
  const endTime = Date.parse(generatedAt);
  if (!Number.isFinite(endTime)) throw new Error("weekly review generatedAt is invalid");
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) throw new Error("weekly review windowDays must be between 1 and 90");
  const startTime = endTime - windowDays * 86_400_000;
  const inWindow = (value) => Number.isFinite(Date.parse(value)) && Date.parse(value) >= startTime && Date.parse(value) <= endTime;
  const decisionMap = new Map(decisions.map((decision) => [reviewDecisionKey(decision), decision]));

  const summarizedRuns = workspace.threads.map((thread) => ({
      id: thread.id,
      channelId: thread.channelId,
      agentId: thread.agentId,
      title: thread.title,
      status: thread.status,
      proofState: thread.proofState,
      updatedAt: thread.updatedAt,
      claimCount: thread.claimCount,
      openReviewClaimIds: thread.reviewClaimIds.filter((claimId) => {
        const scope = { workspaceId: workspace.workspace.id, threadId: thread.id, bundleId: thread.proofBundleId, claimId };
        const decision = decisionMap.get(reviewDecisionKey(scope));
        return !reviewDecisionMatches(decision, scope, thread.reviewEvidence?.[claimId]) || !decisionClosesGate(decision);
      })
    }));
  const runs = summarizedRuns.filter((run) => inWindow(run.updatedAt)).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const openReviewGates = summarizedRuns.flatMap((run) => {
    const thread = workspace.threads.find((item) => item.id === run.id);
    return run.openReviewClaimIds.map((claimId) => ({
      threadId: run.id,
      bundleId: thread.proofBundleId,
      claimId,
      evidenceIdentity: thread.reviewEvidence?.[claimId] || null
    }));
  });
  const staleClaims = claimHistory.claims.filter((claim) => claim.state === "stale");
  const supersededClaims = claimHistory.claims.filter((claim) => claim.state === "superseded" && inWindow(claim.supersededBy?.generatedAt));
  const reviewDecisions = decisions.filter((decision) => inWindow(decision.updatedAt)).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const importReceipts = receipts.filter((receipt) => inWindow(receipt.importedAt)).sort((left, right) => Date.parse(right.importedAt) - Date.parse(left.importedAt));

  return {
    schemaVersion: weeklyReviewSchemaVersion,
    workspace: structuredClone(workspace.workspace),
    generatedAt: new Date(endTime).toISOString(),
    window: { startAt: new Date(startTime).toISOString(), endAt: new Date(endTime).toISOString(), days: windowDays },
    counts: {
      runs: runs.length,
      completed: runs.filter((run) => run.status === "completed").length,
      failed: runs.filter((run) => run.status === "failed").length,
      running: runs.filter((run) => run.status === "running").length,
      openReviewGates: openReviewGates.length,
      staleClaims: staleClaims.length,
      supersededClaims: supersededClaims.length,
      decisions: reviewDecisions.length,
      imports: importReceipts.length
    },
    runs,
    openReviewGates,
    staleClaims,
    supersededClaims,
    decisions: reviewDecisions,
    importReceipts
  };
}

export function weeklyReviewMarkdown(review) {
  const lines = [
    `# ${review.workspace.name} weekly evidence review`,
    "",
    `- Window: ${review.window.startAt} to ${review.window.endAt}`,
    `- Runs: ${review.counts.runs} (${review.counts.completed} completed, ${review.counts.failed} failed, ${review.counts.running} running)`,
    `- Attention: ${review.counts.openReviewGates} open review gates; ${review.counts.staleClaims} stale claims`,
    `- Activity: ${review.counts.decisions} decisions; ${review.counts.imports} imports`,
    "",
    "## Runs",
    ""
  ];
  if (!review.runs.length) lines.push("No runs updated in this window.", "");
  for (const run of review.runs) {
    lines.push(`### ${inline(run.title)}`, "", `- Run: ${run.id}`, `- Agent/channel: ${run.agentId} / ${run.channelId}`, `- Status: ${run.status}; proof ${run.proofState}`, `- Updated: ${run.updatedAt}`, `- Claims: ${run.claimCount}; open review gates: ${run.openReviewClaimIds.length}`, "");
  }
  lines.push("## Current review gates", "");
  if (!review.openReviewGates.length) lines.push("No evidence-scoped review gates remain open.", "");
  for (const gate of review.openReviewGates) {
    lines.push(`- ${gate.threadId} / ${gate.bundleId} / ${gate.claimId}`);
    if (gate.evidenceIdentity) lines.push(`  - Evidence identity: ${inline(gate.evidenceIdentity)}`);
  }
  if (review.openReviewGates.length) lines.push("");
  lines.push("## Stale claims", "");
  if (!review.staleClaims.length) lines.push("No current claims require fresh proof.", "");
  for (const claim of review.staleClaims) {
    lines.push(`### ${inline(claim.claim)}`, "", `- Run/bundle/claim: ${claim.threadId} / ${claim.bundleId} / ${claim.claimId}`, `- Last verdict: ${claim.verdict}`, `- Proof generated: ${claim.generatedAt}`, `- Evidence identity: ${inline(claim.evidenceIdentity)}`, `- Reason: ${inline(claim.reasons.join("; "))}`, "");
  }
  lines.push("## Human decisions", "");
  if (!review.decisions.length) lines.push("No human decisions recorded in this window.", "");
  for (const decision of review.decisions) {
    lines.push(`- ${decision.updatedAt} — ${decision.threadId}/${decision.claimId}: ${decision.status}${decision.note ? ` — ${inline(decision.note)}` : ""}`);
    lines.push(`  - Evidence identity: ${inline(decision.evidenceIdentity)}`);
  }
  lines.push("", "## Import receipts", "");
  if (!review.importReceipts.length) lines.push("No imports recorded in this window.", "");
  for (const receipt of review.importReceipts) {
    lines.push(`- ${receipt.importedAt} — ${receipt.adapter} — ${receipt.status} — sha256:${receipt.sourceDigest}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

function inline(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
