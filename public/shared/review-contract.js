export const reviewDecisionSchemaVersion = 1;
export const reviewDecisionStatuses = Object.freeze(["approved", "rejected", "resolved", "more-proof"]);

const statuses = new Set(reviewDecisionStatuses);

export function evidenceIdentity(finding) {
  const citations = (finding?.citations || [])
    .filter((citation) => citation?.valid)
    .map((citation) => ({
      path: citation.path,
      startLine: citation.startLine,
      endLine: citation.endLine,
      sourceSha256: citation.sourceSha256
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const guards = (finding?.guardResults || [])
    .map((guard) => ({ type: guard.type, passed: guard.passed, explanation: guard.explanation }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({
    version: 1,
    claim: finding?.claim || "",
    verdict: finding?.verdict || "",
    citations,
    guards
  });
}

export function reviewDecisionKey({ workspaceId, threadId, bundleId, claimId }) {
  const parts = [workspaceId, threadId, bundleId, claimId];
  if (parts.some((part) => typeof part !== "string" || !part)) throw new Error("review decision scope is incomplete");
  return `v${reviewDecisionSchemaVersion}:${parts.map(encodeURIComponent).join(":")}`;
}

export function createReviewDecision({ workspaceId, threadId, bundleId, finding, status, note = "", updatedAt = new Date().toISOString() }) {
  if (!statuses.has(status)) throw new Error("review decision status is invalid");
  if (!finding?.claimId) throw new Error("review decision claim is missing");
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error("review decision timestamp is invalid");
  reviewDecisionKey({ workspaceId, threadId, bundleId, claimId: finding.claimId });
  return {
    schemaVersion: reviewDecisionSchemaVersion,
    workspaceId,
    threadId,
    bundleId,
    claimId: finding.claimId,
    evidenceIdentity: evidenceIdentity(finding),
    status,
    note: String(note).slice(0, 4000),
    updatedAt
  };
}

export function reviewDecisionMatches(decision, scope, expectedEvidenceIdentity) {
  if (!decision || decision.schemaVersion !== reviewDecisionSchemaVersion || !statuses.has(decision.status)) return false;
  return decision.workspaceId === scope.workspaceId
    && decision.threadId === scope.threadId
    && decision.bundleId === scope.bundleId
    && decision.claimId === scope.claimId
    && decision.evidenceIdentity === expectedEvidenceIdentity;
}

export function decisionClosesGate(decision) {
  return ["approved", "rejected", "resolved"].includes(decision?.status);
}
