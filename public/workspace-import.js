const eventTypes = new Set(["run_started", "note", "file_changed", "check_completed", "claim_made", "proof_completed", "human_gate", "run_completed"]);
const statuses = new Set(["running", "needs_review", "completed", "failed"]);
const proofStates = new Set(["ready", "collecting", "not_required", "unavailable"]);
const verdicts = ["supported", "unsupported", "contradictory", "stale", "uncertain"];
const safeIdPattern = /^[a-z0-9][a-z0-9-]*$/;

export function validateImportedWorkspace(data) {
  const fail = (message) => { throw new Error(`Workspace rejected: ${message}`); };
  const safeId = (value) => typeof value === "string" && safeIdPattern.test(value);
  const timestamp = (value) => typeof value === "string" && value.includes("T") && Number.isFinite(Date.parse(value));
  const ids = (items, label) => {
    if (!Array.isArray(items) || !items.length) fail(`${label} list is required.`);
    const values = items.map((item) => item?.id);
    if (!values.every(safeId) || new Set(values).size !== values.length) fail(`${label} ids must be unique safe slugs.`);
    return new Set(values);
  };

  if (!data || typeof data !== "object" || Array.isArray(data)) fail("root must be an object.");
  if (data.schemaVersion !== 1) fail("schemaVersion must be 1.");
  if (!data.workspace || !safeId(data.workspace.id) || typeof data.workspace.name !== "string" || !data.workspace.name) fail("workspace identity is invalid.");

  const channelIds = ids(data.channels, "channel");
  const agentIds = ids(data.agents, "agent");
  ids(data.threads, "thread");

  for (const channel of data.channels) {
    if (!channel.name || !channel.topic) fail(`channel ${channel.id} needs a name and topic.`);
  }
  for (const agent of data.agents) {
    if (!agent.name || !agent.role || typeof agent.initial !== "string" || agent.initial.length !== 1) fail(`agent ${agent.id} is incomplete.`);
  }
  for (const thread of data.threads) {
    if (!channelIds.has(thread.channelId) || !agentIds.has(thread.agentId)) fail(`thread ${thread.id} has an unknown channel or agent.`);
    if (!thread.title || !thread.goal || !thread.summary) fail(`thread ${thread.id} is missing visible run content.`);
    if (!statuses.has(thread.status) || !proofStates.has(thread.proofState)) fail(`thread ${thread.id} has an unknown status.`);
    if (!timestamp(thread.startedAt) || !timestamp(thread.updatedAt)) fail(`thread ${thread.id} has invalid timestamps.`);
    const boundaryEnd = thread.completedAt || thread.updatedAt;
    if (thread.status === "running" ? thread.completedAt !== null : !timestamp(thread.completedAt)) fail(`thread ${thread.id} completion does not match its status.`);
    if (Date.parse(thread.startedAt) > Date.parse(boundaryEnd)) fail(`thread ${thread.id} ends before it starts.`);
    if (thread.proofBundleId !== null && (typeof thread.proofBundleId !== "string" || !thread.proofBundleId)) fail(`thread ${thread.id} has an invalid proof bundle.`);
    if (thread.proofState === "ready" && !thread.proofBundleId) fail(`thread ${thread.id} needs a proof bundle.`);
    if (!Number.isInteger(thread.claimCount) || thread.claimCount < 0) fail(`thread ${thread.id} has an invalid claim count.`);
    if (!Number.isInteger(thread.reviewGateCount) || thread.reviewGateCount < 0) fail(`thread ${thread.id} has an invalid review count.`);
    if (!Array.isArray(thread.reviewClaimIds) || thread.reviewClaimIds.length !== thread.reviewGateCount) fail(`thread ${thread.id} has inconsistent review gates.`);
    if (new Set(thread.reviewClaimIds).size !== thread.reviewClaimIds.length || !thread.reviewClaimIds.every(safeId)) fail(`thread ${thread.id} has invalid review claim ids.`);
    if (!thread.verdictCounts || !verdicts.every((verdict) => Number.isInteger(thread.verdictCounts[verdict]) && thread.verdictCounts[verdict] >= 0)) fail(`thread ${thread.id} has invalid verdict counts.`);
    if (verdicts.reduce((sum, verdict) => sum + thread.verdictCounts[verdict], 0) !== thread.claimCount) fail(`thread ${thread.id} verdicts do not match its claim count.`);
    ids(thread.events, `thread ${thread.id} event`);
    for (const event of thread.events) {
      if (!eventTypes.has(event.type) || !timestamp(event.at)) fail(`event ${event.id} is invalid.`);
      if (Date.parse(event.at) < Date.parse(thread.startedAt) || Date.parse(event.at) > Date.parse(boundaryEnd)) fail(`event ${event.id} is outside its thread.`);
      if (!event.title || !event.detail) fail(`event ${event.id} is missing content.`);
    }
  }
  return data;
}
