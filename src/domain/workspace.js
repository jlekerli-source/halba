import { readFile } from "node:fs/promises";

const defaultWorkspaceUrl = new URL("../../data/demo/workspace.json", import.meta.url);
const eventTypes = new Set([
  "run_started",
  "note",
  "file_changed",
  "check_completed",
  "claim_made",
  "proof_completed",
  "human_gate",
  "run_completed"
]);
const threadStatuses = new Set(["running", "needs_review", "completed", "failed"]);
const proofStates = new Set(["ready", "collecting", "not_required", "unavailable"]);
const verdicts = ["supported", "unsupported", "contradictory", "stale", "uncertain"];
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

export function validateWorkspace(data, { proofBundleId } = {}) {
  invariant(data && typeof data === "object" && !Array.isArray(data), "root must be an object");
  invariant(data.schemaVersion === 1, "schemaVersion must be 1");
  invariant(data.workspace && typeof data.workspace.name === "string", "workspace is required");
  uniqueIds([data.workspace], "workspace");
  invariant(Array.isArray(data.channels) && data.channels.length, "at least one channel is required");
  invariant(Array.isArray(data.agents) && data.agents.length, "at least one agent is required");
  invariant(Array.isArray(data.threads) && data.threads.length, "at least one thread is required");

  const channelIds = uniqueIds(data.channels, "channel");
  const agentIds = uniqueIds(data.agents, "agent");
  uniqueIds(data.threads, "thread");

  for (const channel of data.channels) {
    invariant(typeof channel.name === "string" && channel.name.length > 0, `channel ${channel.id} needs a name`);
    invariant(typeof channel.topic === "string" && channel.topic.length > 0, `channel ${channel.id} needs a topic`);
  }

  for (const agent of data.agents) {
    invariant(typeof agent.name === "string" && agent.name.length > 0, `agent ${agent.id} needs a name`);
    invariant(typeof agent.role === "string" && agent.role.length > 0, `agent ${agent.id} needs a role`);
    invariant(typeof agent.initial === "string" && agent.initial.length === 1, `agent ${agent.id} needs one initial`);
  }

  for (const thread of data.threads) {
    invariant(channelIds.has(thread.channelId), `thread ${thread.id} references an unknown channel`);
    invariant(agentIds.has(thread.agentId), `thread ${thread.id} references an unknown agent`);
    invariant(typeof thread.title === "string" && thread.title.length > 0, `thread ${thread.id} needs a title`);
    invariant(threadStatuses.has(thread.status), `thread ${thread.id} has an unknown status`);
    invariant(proofStates.has(thread.proofState), `thread ${thread.id} has an unknown proof state`);
    invariant(validTimestamp(thread.startedAt) && validTimestamp(thread.updatedAt), `thread ${thread.id} needs valid timestamps`);
    invariant(thread.completedAt === null || validTimestamp(thread.completedAt), `thread ${thread.id} has an invalid completion timestamp`);
    invariant(thread.status === "running" ? thread.completedAt === null : validTimestamp(thread.completedAt), `thread ${thread.id} completion must match its status`);
    const boundaryEnd = thread.completedAt || thread.updatedAt;
    invariant(Date.parse(thread.startedAt) <= Date.parse(boundaryEnd), `thread ${thread.id} ends before it starts`);
    invariant(typeof thread.goal === "string" && thread.goal.length > 0, `thread ${thread.id} needs a goal`);
    invariant(typeof thread.summary === "string" && thread.summary.length > 0, `thread ${thread.id} needs a summary`);
    invariant(thread.proofBundleId === null || (typeof thread.proofBundleId === "string" && thread.proofBundleId.length > 0), `thread ${thread.id} has an invalid proof bundle`);
    if (thread.proofState === "ready") {
      invariant(typeof thread.proofBundleId === "string", `thread ${thread.id} needs a proof bundle`);
      if (proofBundleId) invariant(thread.proofBundleId === proofBundleId, `thread ${thread.id} references the wrong proof bundle`);
    }
    invariant(Number.isInteger(thread.claimCount) && thread.claimCount >= 0, `thread ${thread.id} needs a claim count`);
    invariant(Number.isInteger(thread.reviewGateCount) && thread.reviewGateCount >= 0, `thread ${thread.id} needs a review gate count`);
    invariant(Array.isArray(thread.reviewClaimIds) && thread.reviewClaimIds.length === thread.reviewGateCount, `thread ${thread.id} review claims must match its gate count`);
    uniqueIds(thread.reviewClaimIds.map((id) => ({ id })), `thread ${thread.id} review claim`);
    invariant(thread.verdictCounts && typeof thread.verdictCounts === "object", `thread ${thread.id} needs verdict counts`);
    invariant(verdicts.every((verdict) => Number.isInteger(thread.verdictCounts[verdict]) && thread.verdictCounts[verdict] >= 0), `thread ${thread.id} has invalid verdict counts`);
    invariant(verdicts.reduce((sum, verdict) => sum + thread.verdictCounts[verdict], 0) === thread.claimCount, `thread ${thread.id} verdicts must match its claim count`);
    invariant(Array.isArray(thread.events) && thread.events.length, `thread ${thread.id} needs events`);
    uniqueIds(thread.events, `thread ${thread.id} event`);
    for (const event of thread.events) {
      invariant(eventTypes.has(event.type), `event ${event.id} has an unknown type`);
      invariant(validTimestamp(event.at), `event ${event.id} needs a valid timestamp`);
      invariant(Date.parse(event.at) >= Date.parse(thread.startedAt) && Date.parse(event.at) <= Date.parse(boundaryEnd), `event ${event.id} is outside its thread`);
      invariant(typeof event.title === "string" && event.title.length > 0, `event ${event.id} needs a title`);
      invariant(typeof event.detail === "string" && event.detail.length > 0, `event ${event.id} needs detail`);
    }
  }

  return data;
}

export async function loadWorkspace(file = defaultWorkspaceUrl, options = {}) {
  const text = await readFile(file, "utf8");
  invariant(Buffer.byteLength(text) <= 64 * 1024, "file exceeds 64 KB");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("invalid workspace: file must contain JSON");
  }
  return validateWorkspace(data, options);
}
