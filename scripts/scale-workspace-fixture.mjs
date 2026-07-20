export function buildScaleWorkspace(threadCount = 2000) {
  const threads = Array.from({ length: threadCount }, (_, index) => {
    const suffix = String(index + 1);
    const at = new Date(Date.UTC(2026, 6, 1, 0, index % 60, 0)).toISOString();
    return {
      id: `run-${suffix}`, channelId: "operations", agentId: "runner", title: `Bounded run ${suffix}`,
      goal: "Measure canonical local-state behavior within the declared workspace limit.",
      summary: "Synthetic bounded scale fixture with no source bytes or private data.",
      status: "completed", proofState: "not_required", startedAt: at, updatedAt: at, completedAt: at,
      proofBundleId: null, claimCount: 0, reviewGateCount: 0, reviewClaimIds: [], reviewEvidence: {},
      verdictCounts: { supported: 0, unsupported: 0, contradictory: 0, stale: 0, uncertain: 0 },
      events: [{ id: `event-${suffix}`, type: "run_completed", at, title: "Run completed", detail: "Synthetic scale receipt" }]
    };
  });
  return {
    schemaVersion: 1,
    workspace: { id: "scale-check", name: "Scale Check" },
    channels: [{ id: "operations", name: "operations", topic: "Bounded scale verification." }],
    agents: [{ id: "runner", name: "Runner", role: "scale fixture", initial: "R" }],
    threads
  };
}
