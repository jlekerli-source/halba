import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ciManifestSchemaVersion = 1;
export const ciManifestByteLimit = 64 * 1024;
export const ciManifestCheckLimit = 64;

const checkStatuses = new Set(["passed", "failed", "running", "cancelled", "skipped"]);
const terminalCheckStatuses = new Set(["passed", "failed", "cancelled", "skipped"]);
const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const externalIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const digestPattern = /^[a-f0-9]{64}$/i;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const unsafeTextPattern = /[\u0000-\u001f\u007f]|(?:https?:\/\/|www\.)|(?:^|\s)(?:\/|[a-z]:[\\/])/i;

const rootKeys = ["schemaVersion", "routing", "source", "run", "checks"];
const routingKeys = ["workspace", "channel", "agent"];
const workspaceKeys = ["id", "name"];
const channelKeys = ["id", "name", "topic"];
const agentKeys = ["id", "name", "role", "initial"];
const sourceKeys = ["provider", "workflow", "externalRunId", "revision", "commitSha"];
const runKeys = ["id", "title", "goal", "startedAt", "updatedAt"];
const checkKeys = ["id", "status", "at", "exitCode", "receiptSha256"];

export async function inspectCiManifest(file) {
  const sourcePath = path.resolve(file instanceof URL ? fileURLToPath(file) : file);
  const bytes = await readBoundedRegularFile(sourcePath);
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw ciError("source must contain valid JSON");
  }

  const normalized = normalizeManifest(manifest);
  const semanticDocument = {
    schemaVersion: ciManifestSchemaVersion,
    routing: normalized.routing,
    source: normalized.source,
    run: normalized.run,
    checks: normalized.checks,
    conclusion: normalized.conclusion,
    readiness: normalized.readiness,
    warnings: normalized.warnings,
    events: normalized.events
  };
  return {
    schemaVersion: ciManifestSchemaVersion,
    adapter: { id: "ci-manifest-v1", version: 1 },
    sourceRef: path.basename(sourcePath),
    sourceDigest: createHash("sha256").update(bytes).digest("hex"),
    semanticDigest: createHash("sha256").update(canonicalJson(semanticDocument)).digest("hex"),
    ...normalized
  };
}

async function readBoundedRegularFile(sourcePath) {
  let metadata;
  try {
    metadata = await lstat(sourcePath);
  } catch {
    throw ciError("source is unavailable");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw ciError("source must be a regular non-symlink JSON file");
  if (metadata.size > ciManifestByteLimit) throw ciError("source exceeds the 64 KB limit");

  let handle;
  try {
    const noFollow = fsConstants.O_NOFOLLOW || 0;
    handle = await open(sourcePath, fsConstants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (!opened.isFile()) throw ciError("source must be a regular non-symlink JSON file");
    if (opened.size > ciManifestByteLimit) throw ciError("source exceeds the 64 KB limit");
    const bytes = await handle.readFile();
    if (bytes.length > ciManifestByteLimit) throw ciError("source exceeds the 64 KB limit");
    if (bytes.length !== opened.size) throw ciError("source changed during inspection");
    return bytes;
  } catch (error) {
    if (error?.code === "invalid_ci_manifest") throw error;
    if (["ELOOP", "EMLINK"].includes(error?.code)) throw ciError("source must be a regular non-symlink JSON file");
    throw ciError("source could not be read safely");
  } finally {
    await handle?.close();
  }
}

function normalizeManifest(manifest) {
  requireObject(manifest, "manifest");
  exactKeys(manifest, rootKeys, "manifest");
  if (manifest.schemaVersion !== ciManifestSchemaVersion) throw ciError(`schemaVersion must be ${ciManifestSchemaVersion}`);

  requireObject(manifest.routing, "routing");
  exactKeys(manifest.routing, routingKeys, "routing");
  const routing = {
    workspace: normalizeWorkspace(manifest.routing.workspace),
    channel: normalizeChannel(manifest.routing.channel),
    agent: normalizeAgent(manifest.routing.agent)
  };
  const source = normalizeSource(manifest.source);
  const run = normalizeRun(manifest.run, routing);
  const checks = normalizeChecks(manifest.checks, run);
  const conclusion = deriveConclusion(checks);
  const readiness = conclusion === "passed"
    ? "ready"
    : conclusion === "running"
      ? "in_progress"
      : conclusion === "failed"
        ? "blocked"
        : "indeterminate";
  const status = conclusion === "passed"
    ? "completed"
    : conclusion === "running"
      ? "running"
      : conclusion === "failed"
        ? "failed"
        : "needs_review";
  const warnings = buildWarnings(checks, conclusion);
  const counts = countChecks(checks);
  const completedAt = status === "running" ? null : run.updatedAt;
  const events = buildEvents({ checks, run, conclusion, counts });

  return {
    routing,
    source,
    run: {
      ...run,
      workspaceId: routing.workspace.id,
      channelId: routing.channel.id,
      agentId: routing.agent.id,
      summary: summaryFor(conclusion, counts),
      status,
      proofState: "not_required",
      completedAt
    },
    checks,
    conclusion,
    readiness,
    complete: status !== "running",
    counts,
    warnings,
    events,
    privacy: {
      logBodiesRetained: false,
      commandTextRetained: false,
      urlsRetained: false,
      environmentRetained: false,
      arbitraryBodiesRetained: false,
      absolutePathsRetained: false
    }
  };
}

function normalizeWorkspace(value) {
  requireObject(value, "workspace routing");
  exactKeys(value, workspaceKeys, "workspace routing");
  return { id: safeSlug(value.id, "workspace id"), name: safeText(value.name, "workspace name", 120) };
}

function normalizeChannel(value) {
  requireObject(value, "channel routing");
  exactKeys(value, channelKeys, "channel routing");
  return {
    id: safeSlug(value.id, "channel id"),
    name: safeText(value.name, "channel name", 120),
    topic: safeText(value.topic, "channel topic", 500)
  };
}

function normalizeAgent(value) {
  requireObject(value, "agent routing");
  exactKeys(value, agentKeys, "agent routing");
  const initial = safeText(value.initial, "agent initial", 1);
  if ([...initial].length !== 1) throw ciError("agent initial must contain one character");
  return {
    id: safeSlug(value.id, "agent id"),
    name: safeText(value.name, "agent name", 120),
    role: safeText(value.role, "agent role", 200),
    initial
  };
}

function normalizeSource(value) {
  requireObject(value, "CI source identity");
  exactKeys(value, sourceKeys, "CI source identity");
  if (typeof value.externalRunId !== "string" || value.externalRunId.length > 128 || !externalIdPattern.test(value.externalRunId)) {
    throw ciError("externalRunId must be a bounded safe identifier");
  }
  if (!Number.isInteger(value.revision) || value.revision < 1 || value.revision > 1_000_000_000) {
    throw ciError("source revision must be a positive bounded integer");
  }
  if (typeof value.commitSha !== "string" || !commitPattern.test(value.commitSha)) throw ciError("commitSha must be a 40- or 64-character hexadecimal digest");
  return {
    provider: safeSlug(value.provider, "CI provider"),
    workflow: safeSlug(value.workflow, "CI workflow"),
    externalRunId: value.externalRunId,
    revision: value.revision,
    commitSha: value.commitSha.toLowerCase()
  };
}

function normalizeRun(value, routing) {
  requireObject(value, "run routing");
  exactKeys(value, runKeys, "run routing");
  const startedAt = timestamp(value.startedAt, "run startedAt");
  const updatedAt = timestamp(value.updatedAt, "run updatedAt");
  if (Date.parse(updatedAt) < Date.parse(startedAt)) throw ciError("run updatedAt must not precede startedAt");
  return {
    id: safeSlug(value.id, "run id"),
    title: safeText(value.title, "run title", 200),
    goal: safeText(value.goal, "run goal", 500),
    startedAt,
    updatedAt,
    workspaceId: routing.workspace.id,
    channelId: routing.channel.id,
    agentId: routing.agent.id
  };
}

function normalizeChecks(value, run) {
  if (!Array.isArray(value) || value.length < 1 || value.length > ciManifestCheckLimit) {
    throw ciError(`checks must contain 1-${ciManifestCheckLimit} entries`);
  }
  const ids = new Set();
  const checks = value.map((check) => {
    requireObject(check, "CI check");
    exactKeys(check, checkKeys, `CI check ${check.id || "(unknown)"}`);
    const id = safeSlug(check.id, "CI check id");
    if (ids.has(id)) throw ciError(`duplicate CI check id ${id}`);
    ids.add(id);
    if (!checkStatuses.has(check.status)) throw ciError(`CI check ${id} has an unknown status`);
    const at = timestamp(check.at, `CI check ${id} timestamp`);
    if (Date.parse(at) < Date.parse(run.startedAt) || Date.parse(at) > Date.parse(run.updatedAt)) {
      throw ciError(`CI check ${id} timestamp is outside the run boundary`);
    }
    if (check.exitCode !== undefined && (!Number.isInteger(check.exitCode) || check.exitCode < -255 || check.exitCode > 255)) {
      throw ciError(`CI check ${id} exitCode must be a bounded integer`);
    }
    if (check.status === "passed" && check.exitCode !== undefined && check.exitCode !== 0) throw ciError(`passed CI check ${id} cannot have a non-zero exitCode`);
    if (check.status === "failed" && check.exitCode === 0) throw ciError(`failed CI check ${id} cannot have exitCode 0`);
    if (!terminalCheckStatuses.has(check.status) && check.exitCode !== undefined) throw ciError(`non-terminal CI check ${id} cannot have an exitCode`);
    if (check.receiptSha256 !== undefined && (typeof check.receiptSha256 !== "string" || !digestPattern.test(check.receiptSha256))) {
      throw ciError(`CI check ${id} receiptSha256 must be a SHA-256 digest`);
    }
    return {
      id,
      status: check.status,
      at,
      ...(check.exitCode === undefined ? {} : { exitCode: check.exitCode }),
      ...(check.receiptSha256 === undefined ? {} : { receiptSha256: check.receiptSha256.toLowerCase() })
    };
  });
  return checks.sort((left, right) => left.id.localeCompare(right.id));
}

function deriveConclusion(checks) {
  if (checks.some((check) => check.status === "running")) return "running";
  if (checks.some((check) => ["failed", "cancelled"].includes(check.status))) return "failed";
  if (checks.every((check) => check.status === "skipped")) return "indeterminate";
  return "passed";
}

function buildWarnings(checks, conclusion) {
  const warnings = [];
  const skipped = checks.filter((check) => check.status === "skipped").length;
  const receiptsMissing = checks.filter((check) => terminalCheckStatuses.has(check.status) && !check.receiptSha256).length;
  if (skipped) warnings.push({ code: "checks_skipped", severity: "warning", count: skipped });
  if (receiptsMissing) warnings.push({ code: "receipt_digest_missing", severity: "warning", count: receiptsMissing });
  if (conclusion === "indeterminate") warnings.push({ code: "no_executed_checks", severity: "degraded", count: checks.length });
  return warnings;
}

function countChecks(checks) {
  const counts = { checks: checks.length, passed: 0, failed: 0, running: 0, cancelled: 0, skipped: 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

function buildEvents({ checks, run, conclusion, counts }) {
  const events = [{
    id: "ci-run-start",
    type: "run_started",
    at: run.startedAt,
    title: "Indexed bounded CI receipt",
    detail: `${counts.checks} structured checks · logs and commands excluded`
  }];
  for (const check of checks) {
    events.push({
      id: `ci-check-${check.id}`,
      type: terminalCheckStatuses.has(check.status) ? "check_completed" : "note",
      at: check.at,
      title: `CI check ${check.id}`,
      detail: [check.status, check.exitCode === undefined ? "" : `exit ${check.exitCode}`, check.receiptSha256 ? `receipt sha256:${check.receiptSha256}` : "receipt digest unavailable"].filter(Boolean).join(" · ")
    });
  }
  events.push({
    id: "ci-run-outcome",
    type: conclusion === "running" ? "note" : conclusion === "indeterminate" ? "human_gate" : "run_completed",
    at: run.updatedAt,
    title: conclusion === "passed" ? "CI checks passed" : conclusion === "running" ? "CI checks are still running" : conclusion === "failed" ? "CI checks failed" : "CI result needs review",
    detail: summaryFor(conclusion, counts)
  });
  return events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id));
}

function summaryFor(conclusion, counts) {
  return `Structured CI receipt is ${conclusion}: ${counts.passed} passed, ${counts.failed} failed, ${counts.running} running, ${counts.cancelled} cancelled, ${counts.skipped} skipped.`;
}

function safeSlug(value, label) {
  if (typeof value !== "string" || value.length > 120 || !slugPattern.test(value)) throw ciError(`${label} must be a bounded safe slug`);
  return value;
}

function safeText(value, label, limit) {
  if (typeof value !== "string" || value.length < 1 || value.length > limit || unsafeTextPattern.test(value)) {
    throw ciError(`${label} must be bounded routing text without paths, URLs, or control characters`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw ciError(`${label} must be a timestamp`);
  return new Date(value).toISOString();
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw ciError(`${label} must be an object`);
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key) && !["exitCode", "receiptSha256"].includes(key));
  if (unknown.length) throw ciError(`${label} contains unsupported field ${unknown.sort()[0]}`);
  if (missing.length) throw ciError(`${label} is missing ${missing[0]}`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function ciError(message) {
  const error = new Error(`invalid CI manifest: ${message}`);
  error.code = "invalid_ci_manifest";
  return error;
}
