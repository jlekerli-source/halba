import { evidenceIdentity } from "../../public/shared/review-contract.js";

export const claimHistorySchemaVersion = 1;

export function analyzeClaimHistory({ workspace, proofRecords, evaluatedAt = new Date().toISOString(), maxAgeDays = 7 }) {
  if (!workspace?.workspace?.id || !Array.isArray(workspace.threads)) throw new Error("claim history requires a workspace");
  if (!Array.isArray(proofRecords)) throw new Error("claim history requires proof records");
  const evaluationTime = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluationTime)) throw new Error("claim history evaluation time is invalid");
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 3650) throw new Error("claim history maxAgeDays must be between 1 and 3650");

  const runs = new Map(workspace.threads.map((thread) => [thread.id, thread]));
  const observations = [];
  for (const record of proofRecords) {
    const run = runs.get(record.threadId);
    const proof = record.bundle?.adjudication;
    if (!run || proof?.bundle?.id !== record.bundle?.id || !Array.isArray(proof.findings)) continue;
    for (const finding of proof.findings) {
      observations.push({
        key: `${run.agentId}:${run.channelId}:${finding.claimId}`,
        claimId: finding.claimId,
        claim: finding.claim,
        verdict: finding.verdict,
        evidenceIdentity: evidenceIdentity(finding),
        workspaceId: workspace.workspace.id,
        threadId: run.id,
        bundleId: record.bundle.id,
        agentId: run.agentId,
        channelId: run.channelId,
        generatedAt: proof.bundle.generatedAt,
        state: "current",
        reasons: []
      });
    }
  }

  const groups = Map.groupBy(observations, (observation) => observation.key);
  for (const group of groups.values()) {
    group.sort((left, right) => Date.parse(left.generatedAt) - Date.parse(right.generatedAt) || left.bundleId.localeCompare(right.bundleId));
    for (const observation of group.slice(0, -1)) {
      const replacement = group.at(-1);
      observation.state = "superseded";
      observation.reasons.push("a newer proof packet adjudicates the same agent/channel claim id");
      observation.supersededBy = { threadId: replacement.threadId, bundleId: replacement.bundleId, generatedAt: replacement.generatedAt };
    }
    const current = group.at(-1);
    const ageMs = evaluationTime - Date.parse(current.generatedAt);
    if (current.verdict === "stale") current.reasons.push("the authoritative adjudication already marks this proof stale");
    if (current.verdict === "supported" && ageMs > maxAgeDays * 86_400_000) {
      current.reasons.push(`supported proof is older than the ${maxAgeDays}-day history window`);
    }
    const laterRun = workspace.threads
      .filter((thread) => thread.agentId === current.agentId && thread.channelId === current.channelId && thread.id !== current.threadId)
      .filter((thread) => Date.parse(thread.updatedAt) > Date.parse(current.generatedAt))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    if (current.verdict === "supported" && laterRun) {
      current.reasons.push(`newer run ${laterRun.id} advanced the same agent/channel after this proof packet`);
      current.advancedBy = { threadId: laterRun.id, updatedAt: laterRun.updatedAt };
    }
    if (current.reasons.length) current.state = "stale";
  }

  observations.sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt) || left.key.localeCompare(right.key));
  const counts = { current: 0, stale: 0, superseded: 0 };
  for (const observation of observations) counts[observation.state] += 1;
  return {
    schemaVersion: claimHistorySchemaVersion,
    workspaceId: workspace.workspace.id,
    evaluatedAt: new Date(evaluationTime).toISOString(),
    maxAgeDays,
    counts,
    claims: observations
  };
}
