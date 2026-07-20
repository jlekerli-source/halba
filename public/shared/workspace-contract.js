import { validateTrustConfiguration } from "./trust-contract.js";

export const workspaceSchemaVersion = 1;

export const workspaceEventTypes = Object.freeze([
  "run_started",
  "note",
  "file_changed",
  "check_completed",
  "claim_made",
  "proof_completed",
  "human_gate",
  "run_completed"
]);

export const workspaceThreadStatuses = Object.freeze(["running", "needs_review", "completed", "failed"]);
export const workspaceProofStates = Object.freeze(["ready", "collecting", "not_required", "unavailable"]);
export const proofVerdicts = Object.freeze(["supported", "unsupported", "contradictory", "stale", "uncertain"]);
export const workspaceLimits = Object.freeze({ channels: 64, agents: 128, threads: 2000, eventsPerThread: 256, text: 4000, evidenceIdentity: 65536 });

const eventTypes = new Set(workspaceEventTypes);
const threadStatuses = new Set(workspaceThreadStatuses);
const proofStates = new Set(workspaceProofStates);
const idPattern = /^[a-z0-9][a-z0-9-]*$/;

function invariant(condition, message) {
  if (!condition) throw new Error(`invalid workspace: ${message}`);
}

function validTimestamp(value) {
  return typeof value === "string" && value.includes("T") && Number.isFinite(Date.parse(value));
}

function uniqueIds(items, label) {
  const ids = items.map((item) => item?.id);
  invariant(ids.every((id) => typeof id === "string" && idPattern.test(id)), `${label} ids must be safe slugs`);
  invariant(new Set(ids).size === ids.length, `${label} ids must be unique`);
  return new Set(ids);
}

function boundedString(value, label, max = workspaceLimits.text) {
  invariant(typeof value === "string" && value.length > 0 && value.length <= max, `${label} must be 1-${max} characters`);
}

export function validateWorkspace(data, { proofBundleId } = {}) {
  invariant(data && typeof data === "object" && !Array.isArray(data), "root must be an object");
  invariant(data.schemaVersion === workspaceSchemaVersion, `schemaVersion must be ${workspaceSchemaVersion}`);
  invariant(data.workspace && typeof data.workspace.name === "string", "workspace is required");
  uniqueIds([data.workspace], "workspace");
  boundedString(data.workspace.name, `workspace ${data.workspace.id} name`, 120);
  invariant(Array.isArray(data.channels) && data.channels.length, "at least one channel is required");
  invariant(Array.isArray(data.agents) && data.agents.length, "at least one agent is required");
  invariant(Array.isArray(data.threads) && data.threads.length, "at least one thread is required");
  invariant(data.channels.length <= workspaceLimits.channels, `workspace exceeds ${workspaceLimits.channels} channels`);
  invariant(data.agents.length <= workspaceLimits.agents, `workspace exceeds ${workspaceLimits.agents} agents`);
  invariant(data.threads.length <= workspaceLimits.threads, `workspace exceeds ${workspaceLimits.threads} threads`);

  const channelIds = uniqueIds(data.channels, "channel");
  const agentIds = uniqueIds(data.agents, "agent");
  uniqueIds(data.threads, "thread");

  for (const channel of data.channels) {
    boundedString(channel.name, `channel ${channel.id} name`, 120);
    boundedString(channel.topic, `channel ${channel.id} topic`);
  }

  for (const agent of data.agents) {
    boundedString(agent.name, `agent ${agent.id} name`, 120);
    boundedString(agent.role, `agent ${agent.id} role`, 500);
    invariant(typeof agent.initial === "string" && agent.initial.length === 1, `agent ${agent.id} needs one initial`);
  }

  for (const thread of data.threads) validateThread(thread, { agentIds, channelIds, proofBundleId });
  if (data.trust !== undefined) validateTrustConfiguration(data);
  return data;
}

function validateThread(thread, { agentIds, channelIds, proofBundleId }) {
  invariant(channelIds.has(thread.channelId), `thread ${thread.id} references an unknown channel`);
  invariant(agentIds.has(thread.agentId), `thread ${thread.id} references an unknown agent`);
  boundedString(thread.title, `thread ${thread.id} title`, 500);
  invariant(threadStatuses.has(thread.status), `thread ${thread.id} has an unknown status`);
  invariant(proofStates.has(thread.proofState), `thread ${thread.id} has an unknown proof state`);
  invariant(validTimestamp(thread.startedAt) && validTimestamp(thread.updatedAt), `thread ${thread.id} needs valid timestamps`);
  invariant(thread.completedAt === null || validTimestamp(thread.completedAt), `thread ${thread.id} has an invalid completion timestamp`);
  invariant(thread.status === "running" ? thread.completedAt === null : validTimestamp(thread.completedAt), `thread ${thread.id} completion must match its status`);
  const boundaryEnd = thread.completedAt || thread.updatedAt;
  invariant(Date.parse(thread.startedAt) <= Date.parse(boundaryEnd), `thread ${thread.id} ends before it starts`);
  boundedString(thread.goal, `thread ${thread.id} goal`);
  boundedString(thread.summary, `thread ${thread.id} summary`);
  invariant(thread.proofBundleId === null || (typeof thread.proofBundleId === "string" && thread.proofBundleId.length > 0), `thread ${thread.id} has an invalid proof bundle`);
  if (thread.proofState === "ready") {
    invariant(typeof thread.proofBundleId === "string", `thread ${thread.id} needs a proof bundle`);
    if (proofBundleId) invariant(thread.proofBundleId === proofBundleId, `thread ${thread.id} references the wrong proof bundle`);
  }
  invariant(Number.isInteger(thread.claimCount) && thread.claimCount >= 0, `thread ${thread.id} needs a claim count`);
  if (thread.claimIds !== undefined) {
    invariant(Array.isArray(thread.claimIds) && thread.claimIds.length === thread.claimCount, `thread ${thread.id} claim ids must match its claim count`);
    uniqueIds(thread.claimIds.map((id) => ({ id })), `thread ${thread.id} claim`);
  }
  invariant(Number.isInteger(thread.reviewGateCount) && thread.reviewGateCount >= 0, `thread ${thread.id} needs a review gate count`);
  if (thread.reviewGateCount > 0) invariant(thread.proofState === "ready" && typeof thread.proofBundleId === "string", `thread ${thread.id} review gates require a ready proof bundle`);
  invariant(Array.isArray(thread.reviewClaimIds) && thread.reviewClaimIds.length === thread.reviewGateCount, `thread ${thread.id} review claims must match its gate count`);
  invariant(thread.reviewGateCount <= thread.claimCount, `thread ${thread.id} review gates exceed its claims`);
  uniqueIds(thread.reviewClaimIds.map((id) => ({ id })), `thread ${thread.id} review claim`);
  invariant(thread.verdictCounts && typeof thread.verdictCounts === "object", `thread ${thread.id} needs verdict counts`);
  invariant(proofVerdicts.every((verdict) => Number.isInteger(thread.verdictCounts[verdict]) && thread.verdictCounts[verdict] >= 0), `thread ${thread.id} has invalid verdict counts`);
  invariant(proofVerdicts.reduce((sum, verdict) => sum + thread.verdictCounts[verdict], 0) === thread.claimCount, `thread ${thread.id} verdicts must match its claim count`);
  validateReviewEvidence(thread);
  invariant(Array.isArray(thread.events) && thread.events.length, `thread ${thread.id} needs events`);
  invariant(thread.events.length <= workspaceLimits.eventsPerThread, `thread ${thread.id} exceeds ${workspaceLimits.eventsPerThread} events`);
  uniqueIds(thread.events, `thread ${thread.id} event`);
  for (const event of thread.events) {
    invariant(eventTypes.has(event.type), `event ${event.id} has an unknown type`);
    invariant(validTimestamp(event.at), `event ${event.id} needs a valid timestamp`);
    invariant(Date.parse(event.at) >= Date.parse(thread.startedAt) && Date.parse(event.at) <= Date.parse(boundaryEnd), `event ${event.id} is outside its thread`);
    boundedString(event.title, `event ${event.id} title`, 500);
    boundedString(event.detail, `event ${event.id} detail`);
  }
}

function validateReviewEvidence(thread) {
  if (thread.reviewEvidence === undefined) return;
  invariant(thread.reviewEvidence && typeof thread.reviewEvidence === "object" && !Array.isArray(thread.reviewEvidence), `thread ${thread.id} has invalid review evidence`);
  const entries = Object.entries(thread.reviewEvidence);
  invariant(entries.every(([claimId, identity]) => thread.reviewClaimIds.includes(claimId) && typeof identity === "string" && identity.length > 0 && identity.length <= workspaceLimits.evidenceIdentity), `thread ${thread.id} has invalid review evidence`);
  invariant(entries.length === thread.reviewClaimIds.length, `thread ${thread.id} review evidence must match its review claims`);
}
