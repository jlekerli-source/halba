import { createReviewDecision, evidenceIdentity } from "../public/shared/review-contract.js";
import { validateWorkspace } from "../public/shared/workspace-contract.js";

export const trustBenchmarkVersion = 1;
export const trustBenchmarkEvaluatedAt = "2026-08-01T12:00:00.000Z";

const policy = Object.freeze({
  id: "operator-default",
  version: 1,
  defaultFreshnessDays: 30,
  defaultDecisionTtlDays: 30,
  requireHumanDecisionFor: ["high", "critical"]
});

export function buildTrustBenchmark() {
  const alpha = workspaceBuilder("alpha", "Alpha Release");
  alpha.addClaim({ id: "alpha-contradiction", stableKey: "release:artifact", criticality: "critical", verdict: "contradictory", reviewRequired: true, claim: "The release artifact is verified and ready to ship." });
  alpha.addClaim({ id: "alpha-healthy", stableKey: "release:checks", criticality: "high", verdict: "supported", reviewRequired: true, decision: { status: "approved", updatedAt: "2026-07-30T12:00:00.000Z" } });
  alpha.addClaim({ id: "alpha-open", stableKey: "release:privacy", criticality: "high", verdict: "supported", reviewRequired: true });
  alpha.addClaim({ id: "alpha-guard", stableKey: "release:receipt", criticality: "medium", verdict: "supported", requiredGuards: ["receipt"], guards: [] });
  alpha.addReceipt({ id: "alpha-import", adapter: "codex-session-v1", status: "degraded", importedAt: "2026-07-31T12:00:00.000Z" });
  alpha.fillRuns(40);

  const beta = workspaceBuilder("beta", "Beta Runtime");
  beta.addClaim({ id: "beta-unsupported", stableKey: "runtime:recovery", criticality: "high", verdict: "unsupported", reviewRequired: true });
  beta.addClaim({ id: "beta-expired", stableKey: "runtime:latency", criticality: "high", verdict: "supported", reviewRequired: true, decision: { status: "approved", updatedAt: "2026-06-20T12:00:00.000Z" } });
  beta.addClaim({ id: "beta-uncertain", stableKey: "runtime:capacity", criticality: "medium", verdict: "uncertain", reviewRequired: true });
  beta.addClaim({ id: "beta-healthy", stableKey: "runtime:health", criticality: "medium", verdict: "supported" });
  beta.addNoiseRun({ id: "beta-failed-run", status: "failed", updatedAt: "2026-07-31T10:00:00.000Z" });
  beta.fillRuns(40);

  const gamma = workspaceBuilder("gamma", "Gamma Delivery");
  gamma.addClaim({
    id: "gamma-release-old",
    stableKey: "delivery:release",
    criticality: "high",
    verdict: "supported",
    reviewRequired: true,
    claim: "Release artifact digest is alpha.",
    updatedAt: "2026-07-20T12:00:00.000Z",
    decision: { status: "approved", updatedAt: "2026-07-20T13:00:00.000Z" }
  });
  gamma.addClaim({
    id: "gamma-release-new",
    stableKey: "delivery:release",
    criticality: "high",
    verdict: "supported",
    reviewRequired: true,
    claim: "Release artifact digest is beta.",
    updatedAt: "2026-07-31T12:00:00.000Z",
    supersedes: ["gamma-release-old"]
  });
  gamma.addClaim({ id: "gamma-downstream", stableKey: "delivery:deploy", criticality: "medium", verdict: "supported", dependsOn: ["delivery:release"] });
  gamma.addClaim({ id: "gamma-stale", stableKey: "delivery:rollback", criticality: "low", verdict: "supported", freshnessDays: 1, updatedAt: "2026-07-28T12:00:00.000Z" });
  gamma.addClaim({ id: "gamma-healthy", stableKey: "delivery:docs", criticality: "low", verdict: "supported" });
  gamma.fillRuns(40);

  const contexts = [alpha.finish(), beta.finish(), gamma.finish()];
  const expectedAttentionIds = [
    "claim:alpha:alpha-contradiction",
    "claim:alpha:alpha-open",
    "claim:alpha:alpha-guard",
    "import:alpha:codex-session-v1",
    "claim:beta:beta-unsupported",
    "claim:beta:beta-expired",
    "claim:beta:beta-uncertain",
    "run:beta:beta-failed-run",
    "claim:gamma:gamma-release-new",
    "claim:gamma:gamma-downstream",
    "claim:gamma:gamma-stale"
  ].sort();
  return {
    version: trustBenchmarkVersion,
    evaluatedAt: trustBenchmarkEvaluatedAt,
    contexts,
    expectedAttentionIds,
    expectedTopId: "claim:alpha:alpha-contradiction",
    runCount: contexts.reduce((sum, context) => sum + context.workspace.threads.length, 0)
  };
}

function workspaceBuilder(workspaceId, name) {
  const threads = [];
  const proofRecords = [];
  const decisions = [];
  const receipts = [];
  const bindings = [];
  let sequence = 0;

  return {
    addClaim(options) {
      sequence += 1;
      const updatedAt = options.updatedAt || new Date(Date.parse("2026-07-30T08:00:00.000Z") + sequence * 60_000).toISOString();
      const claimId = "claim";
      const bundleId = `${options.id}-bundle`;
      const finding = makeFinding({
        claimId,
        claim: options.claim || `${options.stableKey} satisfies its declared operational claim.`,
        verdict: options.verdict,
        reviewRequired: Boolean(options.reviewRequired),
        guards: options.guards === undefined ? [{ type: "receipt", passed: true, explanation: "bounded deterministic receipt passed" }] : options.guards
      });
      const thread = proofThread({ id: options.id, bundleId, finding, updatedAt });
      threads.push(thread);
      proofRecords.push(proofRecord({ workspaceId, thread, bundleId, finding }));
      bindings.push({
        id: options.id,
        stableKey: options.stableKey,
        threadId: options.id,
        claimId,
        class: "operational",
        criticality: options.criticality,
        freshnessDays: options.freshnessDays,
        decisionTtlDays: options.decisionTtlDays,
        requiredGuards: options.requiredGuards || [],
        dependsOn: options.dependsOn || [],
        supersedes: options.supersedes || []
      });
      if (options.decision) {
        decisions.push(createReviewDecision({
          workspaceId,
          threadId: thread.id,
          bundleId,
          finding,
          status: options.decision.status,
          updatedAt: options.decision.updatedAt
        }));
      }
    },
    addNoiseRun(options) {
      threads.push(noiseThread({ workspaceId, ...options }));
    },
    addReceipt(receipt) {
      receipts.push({ ...receipt, workspaceId, sourceRef: "synthetic-public-safe", sourceDigest: workspaceId.padEnd(64, "a").slice(0, 64), counts: {}, warnings: receipt.status === "degraded" ? ["synthetic degraded import"] : [] });
    },
    fillRuns(count) {
      while (threads.length < count) {
        const index = threads.length + 1;
        this.addNoiseRun({ id: `${workspaceId}-noise-${String(index).padStart(2, "0")}`, status: "completed", updatedAt: new Date(Date.parse("2026-07-01T00:00:00.000Z") + index * 60_000).toISOString() });
      }
    },
    finish() {
      const workspace = validateWorkspace({
        schemaVersion: 1,
        workspace: { id: workspaceId, name },
        channels: [{ id: "operations", name: "operations", topic: "Synthetic public-safe trust operations benchmark." }],
        agents: [{ id: "benchmark-agent", name: "Benchmark Agent", role: "synthetic evidence producer", initial: "B" }],
        threads,
        trust: { schemaVersion: 2, policy: { ...policy }, bindings }
      });
      return { workspace, proofRecords, decisions, receipts, checkpointAt: "2026-07-25T12:00:00.000Z" };
    }
  };
}

function makeFinding({ claimId, claim, verdict, reviewRequired, guards }) {
  return {
    claimId,
    claim,
    verdict,
    verdictAuthority: "deterministic",
    reviewRequired,
    citations: [],
    guardResults: guards,
    issues: [],
    modelDisagreement: false,
    modelAssessment: verdict,
    confidence: 1,
    reasoningBoundary: "Synthetic benchmark candidate only; deterministic verdict and guards remain authoritative.",
    model: { assessment: verdict, confidence: 1, reasoningBoundary: "synthetic benchmark candidate only" }
  };
}

function proofThread({ id, bundleId, finding, updatedAt }) {
  const completedAt = updatedAt;
  const startedAt = new Date(Date.parse(updatedAt) - 60_000).toISOString();
  const reviewClaimIds = finding.reviewRequired ? [finding.claimId] : [];
  return {
    id,
    channelId: "operations",
    agentId: "benchmark-agent",
    title: `Trust observation ${id}`,
    goal: "Exercise deterministic trust operations",
    summary: "Synthetic public-safe benchmark observation.",
    status: finding.reviewRequired ? "needs_review" : "completed",
    proofState: "ready",
    startedAt,
    updatedAt,
    completedAt,
    proofBundleId: bundleId,
    claimCount: 1,
    claimIds: [finding.claimId],
    reviewGateCount: reviewClaimIds.length,
    reviewClaimIds,
    reviewEvidence: Object.fromEntries(reviewClaimIds.map((claimId) => [claimId, evidenceIdentity(finding)])),
    verdictCounts: verdictCounts(finding.verdict),
    events: [
      { id: `${id}-start`, type: "run_started", at: startedAt, title: "Started trust observation", detail: "synthetic benchmark" },
      { id: `${id}-proof`, type: "proof_completed", at: updatedAt, title: "Completed deterministic proof", detail: finding.verdict }
    ]
  };
}

function noiseThread({ id, status, updatedAt }) {
  const startedAt = new Date(Date.parse(updatedAt) - 60_000).toISOString();
  return {
    id,
    channelId: "operations",
    agentId: "benchmark-agent",
    title: `Noise run ${id}`,
    goal: "Exercise realistic workspace volume",
    summary: "Synthetic non-claim run for scale coverage.",
    status,
    proofState: "not_required",
    startedAt,
    updatedAt,
    completedAt: updatedAt,
    proofBundleId: null,
    claimCount: 0,
    claimIds: [],
    reviewGateCount: 0,
    reviewClaimIds: [],
    reviewEvidence: {},
    verdictCounts: verdictCounts(null),
    events: [{ id: `${id}-event`, type: "run_completed", at: updatedAt, title: "Completed synthetic run", detail: status }]
  };
}

function proofRecord({ thread, bundleId, finding }) {
  const generatedAt = new Date(Date.parse(thread.updatedAt) - 1_000).toISOString();
  return {
    bundle: {
      id: bundleId,
      adjudication: {
        bundle: { id: bundleId, title: thread.title, agent: "Benchmark Agent", generatedAt, sourceCount: 0, totalBytes: 0 },
        execution: { mode: "imported", model: "deterministic-benchmark", reasoningEffort: "not_applicable", store: false },
        summary: "Synthetic public-safe Trust Operations observation. Deterministic verdicts and policy traces remain authoritative.",
        findings: [finding],
        counts: verdictCounts(finding.verdict),
        reviewRequiredCount: finding.reviewRequired ? 1 : 0
      },
      sources: []
    },
    workspaceId: thread.workspaceId,
    threadId: thread.id,
    sourceRoot: null,
    sourceDigest: "b".repeat(64),
    importedAt: generatedAt
  };
}

function verdictCounts(verdict) {
  const counts = { supported: 0, unsupported: 0, contradictory: 0, stale: 0, uncertain: 0 };
  if (verdict) counts[verdict] = 1;
  return counts;
}
