import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const codexSessionByteLimit = 64 * 1024 * 1024;
export const codexSessionRecordLimit = 200_000;

const knownTopLevelTypes = new Set(["session_meta", "event_msg", "response_item", "turn_context", "world_state", "compacted"]);
const knownEventTypes = new Set([
  "task_started",
  "task_complete",
  "task_completed",
  "turn_aborted",
  "agent_message",
  "user_message",
  "token_count"
]);

export async function inspectCodexSession(file) {
  const sessionPath = path.resolve(file instanceof URL ? fileURLToPath(file) : file);
  let handle;
  try {
    handle = await open(sessionPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  } catch (error) {
    if (error?.code === "ELOOP") throw sessionError("source must be a regular non-symlink JSONL file");
    throw error;
  }
  const fileStat = await handle.stat();
  if (!fileStat.isFile()) {
    await handle.close();
    throw sessionError("source must be a regular non-symlink JSONL file");
  }
  if (fileStat.size > codexSessionByteLimit) {
    await handle.close();
    throw sessionError("source exceeds the 64 MB limit");
  }

  const digest = createHash("sha256");
  const counts = { records: 0, malformed: 0, turns: 0, responseItems: 0, toolCalls: 0, eventMessages: 0 };
  const topLevelTypes = new Map();
  const eventTypes = new Map();
  let sessionId = null;
  let earliest = null;
  let latest = null;
  let lastTaskBoundary = null;

  const input = handle.createReadStream({ autoClose: false });
  input.on("data", (chunk) => digest.update(chunk));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      counts.records += 1;
      if (counts.records > codexSessionRecordLimit) throw sessionError("source exceeds the record limit");
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        counts.malformed += 1;
        continue;
      }
      if (typeof record?.type !== "string") continue;
      increment(topLevelTypes, knownTopLevelTypes.has(record.type) ? record.type : "other");
      const timestamp = validTimestamp(record.timestamp);
      if (timestamp) {
        if (!earliest || timestamp < earliest) earliest = timestamp;
        if (!latest || timestamp > latest) latest = timestamp;
      }
      if (record.type === "session_meta") {
        const candidate = safeSessionId(record.payload?.session_id || record.payload?.id);
        if (candidate && sessionId && candidate !== sessionId) throw sessionError("source contains multiple session ids");
        sessionId ||= candidate;
      }
      if (record.type === "turn_context") counts.turns += 1;
      if (record.type === "event_msg") {
        counts.eventMessages += 1;
        if (typeof record.payload?.type === "string") increment(eventTypes, knownEventTypes.has(record.payload.type) ? record.payload.type : "other");
        if (["task_started", "task_complete", "task_completed"].includes(record.payload?.type)) lastTaskBoundary = record.payload.type;
      }
      if (record.type === "response_item") {
        counts.responseItems += 1;
        if (["function_call", "custom_tool_call", "local_shell_call"].includes(record.payload?.type)) counts.toolCalls += 1;
      }
    }
  } finally {
    await handle.close();
  }

  if (!sessionId) throw sessionError("source does not contain a session id");
  if (!earliest || !latest) throw sessionError("source does not contain bounded timestamps");
  const warnings = [];
  if (counts.malformed) warnings.push(`${counts.malformed} malformed JSONL ${counts.malformed === 1 ? "record was" : "records were"} skipped`);
  const complete = ["task_complete", "task_completed"].includes(lastTaskBoundary);
  const proofEligible = complete && counts.malformed === 0;
  if (!complete) warnings.push("session has no explicit completion for its latest task");

  return {
    sessionId,
    sourceDigest: digest.digest("hex"),
    sourceRef: path.basename(sessionPath),
    complete,
    proofEligible,
    startedAt: earliest,
    updatedAt: latest,
    counts,
    topLevelTypes: Object.fromEntries([...topLevelTypes].sort()),
    eventTypes: Object.fromEntries([...eventTypes].sort()),
    warnings,
    events: aggregateEvents({ counts, sessionId, startedAt: earliest, updatedAt: latest, warnings })
  };
}

function aggregateEvents({ counts, sessionId, startedAt, updatedAt, warnings }) {
  const points = interpolateTimes(startedAt, updatedAt, 4);
  return [
    { id: "codex-session-start", type: "run_started", at: points[0], title: "Indexed a bounded Codex session", detail: `session ${shortId(sessionId)} · transcript bodies excluded` },
    { id: "codex-turn-boundary", type: "note", at: points[1], title: "Counted run boundaries", detail: `${counts.turns} turns · ${counts.responseItems} response items` },
    { id: "codex-tool-boundary", type: "check_completed", at: points[2], title: "Recorded safe execution metadata", detail: `${counts.toolCalls} tool calls · command text excluded` },
    {
      id: "codex-session-end",
      type: warnings.length ? "human_gate" : "run_completed",
      at: points[3],
      title: warnings.length ? "Imported with degraded source metadata" : "Completed Codex metadata import",
      detail: warnings.length ? `${warnings.length} import warning${warnings.length === 1 ? "" : "s"} require review` : `${counts.records} JSONL records hashed`
    }
  ];
}

function interpolateTimes(startedAt, updatedAt, count) {
  const start = Date.parse(startedAt);
  const end = Date.parse(updatedAt);
  const step = count > 1 ? (end - start) / (count - 1) : 0;
  return Array.from({ length: count }, (_, index) => new Date(start + step * index).toISOString());
}

function safeSessionId(value) {
  const id = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

function validTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function shortId(value) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function sessionError(message) {
  const error = new Error(`invalid Codex session: ${message}`);
  error.code = "invalid_codex_session";
  return error;
}
