import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeAgentUpdates } from "./domain/agent-updates.js";
import { analyzeClaimHistory } from "./domain/claim-history.js";
import { buildWeeklyReview, weeklyReviewMarkdown } from "./domain/weekly-review.js";
import { buildTrustOperations } from "./domain/trust-operations.js";
import { formatImportRunDelta, formatImportRunDeltaDetails, importRunDelta } from "./domain/feed.js";
import { loadWorkspace } from "./domain/workspace.js";
import { loadProofBundle, publicBundleSummary } from "./proof/bundle.js";
import { runProof } from "./proof/run.js";
import { loadStoredSource, storedAdjudication, storedBundleSummary } from "./proof/stored.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const domainDir = path.join(root, "src", "domain");
const feedPath = path.resolve(root, process.env.HALBA_FEED_FILE || "data/sample-feed.json");
const sourceRoot = path.resolve(root, process.env.HALBA_SOURCE_ROOT || "data/sample-source");
const agentUpdatesPath = process.env.HALBA_AGENT_UPDATES_FILE
  ? path.resolve(root, process.env.HALBA_AGENT_UPDATES_FILE)
  : null;
const importRunsPath = process.env.HALBA_IMPORT_RUNS_FILE
  ? path.resolve(root, process.env.HALBA_IMPORT_RUNS_FILE)
  : null;
const legacyFeedEnabled = process.env.HALBA_ENABLE_LEGACY_FEED === "1";
const port = Number(process.env.PORT || 4177);
const host = String(process.env.HALBA_HOST || "127.0.0.1").trim();
const remoteAccessEnabled = process.env.HALBA_ALLOW_REMOTE === "1";
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");
if (!host) throw new Error("HALBA_HOST must not be empty");
if (!loopbackHosts.has(host) && !remoteAccessEnabled) {
  throw new Error("Refusing non-loopback HALBA_HOST without HALBA_ALLOW_REMOTE=1");
}
const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  `http://[::1]:${port}`,
  ...String(process.env.HALBA_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean)
]);
const sourceLimit = 14000;
const requestBodyLimit = 4096;
const decisionBodyLimit = 64 * 1024;
const stateFile = String(process.env.HALBA_STATE_FILE || "").trim();
const localStore = stateFile
  ? await import("./storage/local-store.js").then(({ openLocalStore }) => openLocalStore(stateFile))
  : null;

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function pathParts(rawPath) {
  const [filePath, anchor] = String(rawPath || "").split("#");
  return { filePath, anchor };
}

function isInside(base, target) {
  const relative = path.relative(base, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sourceFile(rawPath) {
  const { filePath } = pathParts(rawPath);
  const parts = String(filePath || "").split(/[\\/]+/);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(filePath || "");
  if (
    !filePath
      || path.isAbsolute(filePath)
      || path.win32.isAbsolute(filePath)
      || hasScheme
      || parts.includes("..")
  ) return null;
  const target = path.resolve(sourceRoot, filePath);
  if (!isInside(sourceRoot, target)) return null;
  return target;
}

function markdownSection(text, anchor) {
  if (!anchor) return null;
  const headings = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  const index = headings.findIndex((match) => slug(match[2]) === anchor);
  if (index === -1) return null;

  const current = headings[index];
  const currentLevel = current[1].length;
  const next = headings.slice(index + 1).find((match) => match[1].length <= currentLevel);
  return text.slice(current.index, next?.index ?? text.length).trim();
}

function lineCount(text) {
  return text ? String(text).split(/\r\n|\r|\n/).length : 0;
}

async function sourceResponse(searchParams, limit = sourceLimit) {
  const relativePath = searchParams.get("path") || "";
  const { anchor } = pathParts(relativePath);
  const file = sourceFile(relativePath);
  if (!file) return { status: 403, body: { error: "forbidden source path" } };

  try {
    const text = await readFile(file, "utf8");
    const preview = markdownSection(text, anchor) || text;
    const bodyText = preview.length > limit ? preview.slice(0, limit) : preview;
    return {
      status: 200,
      body: {
        path: relativePath,
        anchor: anchor || null,
        text: bodyText,
        lineCount: lineCount(bodyText),
        truncated: preview.length > limit
      }
    };
  } catch {
    return { status: 404, body: { error: "source not found", path: relativePath } };
  }
}

async function importDeltaResponse() {
  if (!importRunsPath) {
    const delta = importRunDelta({ runs: [] });
    return { status: 200, body: { delta, text: formatImportRunDelta(delta), detailText: formatImportRunDeltaDetails(delta) } };
  }
  try {
    const text = await readFile(importRunsPath, "utf8");
    const history = JSON.parse(text);
    const delta = importRunDelta(history);
    return { status: 200, body: { delta, text: formatImportRunDelta(delta), detailText: formatImportRunDeltaDetails(delta) } };
  } catch (error) {
    if (error?.code === "ENOENT") {
      const delta = importRunDelta({ runs: [] });
      return { status: 200, body: { delta, text: formatImportRunDelta(delta), detailText: formatImportRunDeltaDetails(delta) } };
    }
    return { status: 500, body: { error: "import delta unavailable" } };
  }
}

async function feedResponse() {
  try {
    const feed = JSON.parse(await readFile(feedPath, "utf8"));
    if (!agentUpdatesPath) return { status: 200, body: feed };
    try {
      const receipts = JSON.parse(await readFile(agentUpdatesPath, "utf8"));
      return { status: 200, body: mergeAgentUpdates(feed, receipts) };
    } catch (error) {
      if (error?.code === "ENOENT") return { status: 200, body: feed };
      throw error;
    }
  } catch {
    return { status: 500, body: { error: "feed unavailable" } };
  }
}

function roadmapStatusKind(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("optional")) return "optional";
  if (value.includes("in progress")) return "active";
  if (value.includes("complete") || value.includes("current baseline")) return "complete";
  return "planned";
}

function roadmapStatusCounts(items) {
  return items.reduce((counts, item) => {
    const kind = item.statusKind || "planned";
    counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, { complete: 0, active: 0, planned: 0, optional: 0 });
}

function roadmapProgressSummary(counts, total) {
  return [
    `${counts.complete || 0} of ${total} major versions complete`,
    counts.active ? `${counts.active} active` : "",
    counts.planned ? `${counts.planned} planned` : "",
    counts.optional ? `${counts.optional} optional` : ""
  ].filter(Boolean).join("; ");
}

function roadmapSummary(text) {
  const headingBlock = (match, headingPattern = /\n###\s+|\n##\s+/) => {
    const rest = text.slice(match.index + match[0].length);
    const nextHeading = rest.search(headingPattern);
    return text.slice(match.index, nextHeading === -1 ? text.length : match.index + match[0].length + nextHeading);
  };
  const fieldValue = (block, label) => block.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`))?.[1].trim() || "";
  const bulletSection = (block, label) => {
    const marker = `**${label}:**`;
    const markerIndex = block.indexOf(marker);
    if (markerIndex === -1) return [];
    const section = block.slice(markerIndex + marker.length);
    const sectionEnd = section.search(/\n\*\*[^*]+:\*\*|\n###\s+|\n##\s+/);
    const body = sectionEnd === -1 ? section : section.slice(0, sectionEnd);
    return [...body.matchAll(/^\s*-\s+(.+)$/gm)].map((match) => match[1].trim());
  };
  const nextMatch = text.match(/^### Next:\s+(v[\d.]+)\s+(.+)$/m);
  const completedMatches = [...text.matchAll(/^### Completed:\s+(v[\d.]+)\s+(.+)$/gm)];
  const versionMatches = [...text.matchAll(/^###\s+(v[\d.]+)\s+(.+)$/gm)];
  const versionLadder = versionMatches.map((match) => {
    const block = headingBlock(match);
    const targets = bulletSection(block, "Targets");
    const measurableTargets = bulletSection(block, "Measurable Targets");
    const status = fieldValue(block, "Status");
    return {
      version: match[1],
      title: match[2].trim(),
      status,
      statusKind: roadmapStatusKind(status),
      goal: fieldValue(block, "Goal"),
      target: targets[0] || measurableTargets[0] || ""
    };
  });
  const statusCounts = roadmapStatusCounts(versionLadder);
  const completed = completedMatches.map((match) => {
    const block = headingBlock(match, /\n###\s+/);
    return {
      version: match[1],
      title: match[2].trim(),
      doneOn: block.match(/\*\*Done on:\*\*\s*(.+)/)?.[1].trim() || ""
    };
  });
  const nextSource = nextMatch ? text.slice(nextMatch.index) : "";
  const nextEnd = nextSource.search(/\n##\s+/);
  const nextBlock = nextEnd === -1 ? nextSource : nextSource.slice(0, nextEnd);
  const next = nextMatch ? {
    version: nextMatch[1],
    title: nextMatch[2].trim(),
    target: nextBlock.match(/\*\*Target:\*\*\s*(.+)/)?.[1].trim() || "",
    checks: [...nextBlock.matchAll(/`([^`]+)`/g)].map((match) => match[1])
  } : null;
  return {
    next,
    versionLadder,
    statusCounts,
    progressSummary: roadmapProgressSummary(statusCounts, versionLadder.length),
    completedCount: completed.length,
    lastCompleted: completed.at(-1) || null,
    recentCompleted: completed.slice(-3).reverse()
  };
}

async function roadmapResponse() {
  try {
    const text = await readFile(path.join(root, "docs", "roadmap.md"), "utf8");
    return { status: 200, body: roadmapSummary(text) };
  } catch {
    return { status: 500, body: { error: "roadmap unavailable" } };
  }
}

async function proofBundleResponse(searchParams) {
  if (localStore) {
    const bundleId = searchParams.get("bundleId") || "";
    const record = bundleId ? localStore.getProofBundleRecord(bundleId) : null;
    if (!record) return { status: 404, body: { error: "proof_bundle_not_found", message: "The requested proof bundle is unavailable." } };
    return { status: 200, body: storedBundleSummary(record) };
  }
  const bundle = await loadProofBundle();
  return { status: 200, body: publicBundleSummary(bundle) };
}

async function workspaceResponse(searchParams) {
  if (localStore) {
    const requestedId = searchParams.get("workspaceId");
    const workspaceId = requestedId || localStore.listWorkspaces()[0]?.id;
    const workspace = workspaceId ? localStore.getWorkspace(workspaceId) : null;
    if (!workspace) return { status: 404, body: { error: "workspace_not_found", message: "The requested workspace is unavailable." } };
    return { status: 200, body: workspace };
  }
  const bundle = await loadProofBundle();
  return { status: 200, body: await loadWorkspace(undefined, { proofBundleId: bundle.id }) };
}

async function proofSourceResponse(searchParams) {
  const sourcePath = searchParams.get("path") || "";
  if (localStore) {
    const bundleId = searchParams.get("bundleId") || "";
    const record = bundleId ? localStore.getProofBundleRecord(bundleId) : null;
    if (!record) return { status: 404, body: { error: "proof_bundle_not_found", message: "The requested proof bundle is unavailable." } };
    const declared = record.bundle.sources.find((source) => source.path === sourcePath);
    const requestedStart = Number(searchParams.get("startLine") || 1);
    const requestedEnd = Number(searchParams.get("endLine") || declared?.lineCount || 0);
    return { status: 200, body: await loadStoredSource(record, sourcePath, { startLine: requestedStart, endLine: requestedEnd }) };
  }
  const bundle = await loadProofBundle();
  const source = bundle.sourceByPath.get(sourcePath);
  if (!source) return { status: 404, body: { error: "proof source not found" } };

  const requestedStart = Number(searchParams.get("startLine") || 1);
  const requestedEnd = Number(searchParams.get("endLine") || source.lineCount);
  if (
    !Number.isInteger(requestedStart)
    || !Number.isInteger(requestedEnd)
    || requestedStart < 1
    || requestedEnd < requestedStart
    || requestedEnd > source.lineCount
  ) {
    return { status: 400, body: { error: "invalid proof source range" } };
  }

  return {
    status: 200,
    body: {
      path: source.path,
      label: source.label,
      kind: source.kind,
      sha256: source.sha256,
      startLine: requestedStart,
      endLine: requestedEnd,
      lineCount: source.lineCount,
      text: source.lines.slice(requestedStart - 1, requestedEnd).join("\n")
    }
  };
}

async function proofRunResponse(req) {
  const body = await readJsonBody(req, { label: "Proof request" });
  if (localStore) {
    if (!body.bundleId) throw apiError("proof_bundle_required", "Durable proof requests require a bundle id.", 400);
    if (body.mode === "live") throw apiError("live_unavailable", "Live analysis is unavailable for an imported proof packet. Re-import a newly adjudicated packet instead.", 409);
    if (!["recorded", "imported"].includes(body.mode || "recorded")) throw apiError("invalid_mode", "Proof mode must be recorded or imported.", 400);
    const record = localStore.getProofBundleRecord(body.bundleId);
    if (!record) throw apiError("proof_bundle_not_found", "The requested proof bundle is unavailable.", 404);
    return { status: 200, body: storedAdjudication(record) };
  }
  const proof = await runProof({ mode: body.mode || "recorded" });
  return { status: 200, body: proof };
}

async function reviewDecisionResponse(req) {
  if (!localStore) throw apiError("durable_state_disabled", "Durable Halba state is not configured.", 409);
  const decision = await readJsonBody(req, { limit: decisionBodyLimit, label: "Review decision" });
  localStore.saveReviewDecision(decision);
  return { status: 200, body: localStore.getReviewDecision(decision) };
}

async function deleteReviewDecisionResponse(req) {
  if (!localStore) throw apiError("durable_state_disabled", "Durable Halba state is not configured.", 409);
  const scope = await readJsonBody(req, { label: "Review decision scope" });
  return { status: 200, body: { deleted: localStore.deleteReviewDecision(scope) } };
}

async function readJsonBody(req, { limit = requestBodyLimit, label = "Request" } = {}) {
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim();
  if (contentType !== "application/json") throw apiError("content_type_required", `${label} requires application/json.`, 415);

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw apiError("request_too_large", `${label} exceeds the request size limit.`, 413);
    chunks.push(chunk);
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
    return body;
  } catch {
    throw apiError("invalid_json", `${label} body must be a JSON object.`, 400);
  }
}

function apiError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function errorBody(error) {
  return {
    error: error?.code || "internal_error",
    message: error?.status ? error.message : "Halba could not complete the request."
  };
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "content-type": types[".json"] });
  res.end(JSON.stringify(body));
}

function requestSecurityError(req, url) {
  if (!url.pathname.startsWith("/api/")) return null;
  const method = String(req.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") {
    return apiError("cross_site_request_rejected", "Cross-site state-changing requests are not allowed.", 403);
  }
  const origin = String(req.headers.origin || "").trim();
  if (origin && !allowedOrigins.has(origin)) {
    return apiError("origin_not_allowed", "The request origin is not allowed by this local Halba server.", 403);
  }
  return null;
}

function resolveRequest(url) {
  const pathname = new URL(url, "http://localhost").pathname;
  if (legacyFeedEnabled && pathname === "/api/feed") return feedPath;
  if (legacyFeedEnabled && pathname.startsWith("/domain/")) {
    const target = path.resolve(domainDir, `.${pathname.replace("/domain", "")}`);
    return isInside(domainDir, target) ? target : null;
  }
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const target = path.resolve(publicDir, `.${normalized}`);
  if (!isInside(publicDir, target)) return null;
  return target;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  if (url.pathname.startsWith("/api/")) res.setHeader("cache-control", "no-store");
  const securityError = requestSecurityError(req, url);
  if (securityError) {
    jsonResponse(res, securityError.status, errorBody(securityError));
    return;
  }
  if (url.pathname === "/api/runtime" && req.method === "GET") {
    jsonResponse(res, 200, { durableState: Boolean(localStore) });
    return;
  }
  if (url.pathname === "/api/workspaces" && req.method === "GET") {
    if (!localStore) {
      jsonResponse(res, 200, []);
    } else {
      jsonResponse(res, 200, localStore.listWorkspaces());
    }
    return;
  }
  if (url.pathname === "/api/import-receipts" && req.method === "GET") {
    if (!localStore) {
      jsonResponse(res, 409, { error: "durable_state_disabled", message: "Durable Halba state is not configured." });
    } else {
      const workspaceId = url.searchParams.get("workspaceId") || "";
      if (!localStore.getWorkspace(workspaceId)) jsonResponse(res, 404, { error: "workspace_not_found", message: "The requested workspace is unavailable." });
      else jsonResponse(res, 200, localStore.listImportReceipts(workspaceId));
    }
    return;
  }
  if (url.pathname === "/api/import-receipt" && req.method === "GET") {
    if (!localStore) {
      jsonResponse(res, 409, { error: "durable_state_disabled", message: "Durable Halba state is not configured." });
    } else {
      try {
        const workspaceId = url.searchParams.get("workspaceId") || "";
        const receiptId = url.searchParams.get("receiptId") || "";
        if (!localStore.getWorkspace(workspaceId)) throw apiError("workspace_not_found", "The requested workspace is unavailable.", 404);
        const receipt = localStore.listImportReceipts(workspaceId).find((item) => item.id === receiptId);
        if (!receipt) throw apiError("receipt_not_found", "The requested import receipt is unavailable.", 404);
        const event = localStore.listWorkspaceImportEvents(workspaceId).find((item) => item.receiptId === receiptId);
        jsonResponse(res, 200, { ...receipt, recordedAt: event?.recordedAt || null });
      } catch (error) {
        jsonResponse(res, error?.status || 400, errorBody(error));
      }
    }
    return;
  }
  if (url.pathname === "/api/claim-history" && req.method === "GET") {
    if (!localStore) {
      jsonResponse(res, 409, { error: "durable_state_disabled", message: "Durable Halba state is not configured." });
    } else {
      try {
        const workspaceId = url.searchParams.get("workspaceId") || localStore.listWorkspaces()[0]?.id;
        const workspace = workspaceId ? localStore.getWorkspace(workspaceId) : null;
        if (!workspace) throw apiError("workspace_not_found", "The requested workspace is unavailable.", 404);
        const report = analyzeClaimHistory({
          workspace,
          proofRecords: localStore.listProofBundleRecords(workspaceId),
          evaluatedAt: url.searchParams.get("at") || new Date().toISOString(),
          maxAgeDays: Number(url.searchParams.get("maxAgeDays") || 7)
        });
        jsonResponse(res, 200, report);
      } catch (error) {
        jsonResponse(res, error?.status || 400, errorBody(error));
      }
    }
    return;
  }
  if (url.pathname === "/api/weekly-review" && req.method === "GET") {
    if (!localStore) {
      jsonResponse(res, 409, { error: "durable_state_disabled", message: "Durable Halba state is not configured." });
    } else {
      try {
        const workspaceId = url.searchParams.get("workspaceId") || localStore.listWorkspaces()[0]?.id;
        const workspace = workspaceId ? localStore.getWorkspace(workspaceId) : null;
        if (!workspace) throw apiError("workspace_not_found", "The requested workspace is unavailable.", 404);
        const generatedAt = url.searchParams.get("at") || new Date().toISOString();
        const claimHistory = analyzeClaimHistory({ workspace, proofRecords: localStore.listProofBundleRecords(workspaceId), evaluatedAt: generatedAt, maxAgeDays: Number(url.searchParams.get("maxAgeDays") || 7) });
        const review = buildWeeklyReview({ workspace, claimHistory, decisions: localStore.listWorkspaceReviewDecisions(workspaceId), receipts: localStore.listImportReceipts(workspaceId), generatedAt, windowDays: Number(url.searchParams.get("windowDays") || 7) });
        if (url.searchParams.get("format") === "markdown") {
          res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="halba-${workspaceId}-weekly-review.md"` });
          res.end(weeklyReviewMarkdown(review));
        } else {
          jsonResponse(res, 200, review);
        }
      } catch (error) {
        jsonResponse(res, error?.status || 400, errorBody(error));
      }
    }
    return;
  }
  if (url.pathname === "/api/trust-operations" && req.method === "GET") {
    if (!localStore) {
      jsonResponse(res, 409, { error: "durable_state_disabled", message: "Durable Halba state is not configured." });
    } else {
      try {
        const evaluatedAt = url.searchParams.get("at") || new Date().toISOString();
        const checkpointAt = url.searchParams.get("checkpointAt") || null;
        const limit = Number(url.searchParams.get("limit") || 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw apiError("invalid_limit", "Trust Operations limit must be an integer from 1 to 100.", 400);
        const workspaceFilter = url.searchParams.get("workspaceId") || null;
        const reasonFilter = url.searchParams.get("reason") || null;
        const criticalityFilter = url.searchParams.get("criticality") || null;
        if (workspaceFilter && !localStore.getWorkspace(workspaceFilter)) throw apiError("workspace_not_found", "The requested workspace is unavailable.", 404);
        if (reasonFilter && !/^[a-z][a-z0-9_]{0,63}$/.test(reasonFilter)) throw apiError("invalid_reason", "Trust Operations reason is invalid.", 400);
        if (criticalityFilter && !["low", "medium", "high", "critical"].includes(criticalityFilter)) throw apiError("invalid_criticality", "Trust Operations criticality is invalid.", 400);
        const contexts = localStore.listWorkspaces().map(({ id }) => ({
          workspace: localStore.getWorkspace(id),
          proofRecords: localStore.listProofBundleRecords(id),
          decisions: localStore.listWorkspaceReviewDecisions(id),
          receipts: localStore.listImportReceipts(id),
          checkpointAt
        }));
        const report = buildTrustOperations({ contexts, evaluatedAt });
        const filteredItems = report.items.filter((item) => (
          (!workspaceFilter || item.workspaceId === workspaceFilter)
          && (!reasonFilter || item.reasons.some((reason) => reason.code === reasonFilter))
          && (!criticalityFilter || item.criticality === criticalityFilter)
        ));
        jsonResponse(res, 200, {
          ...report,
          page: { limit, returned: Math.min(limit, filteredItems.length), totalItems: filteredItems.length, truncated: filteredItems.length > limit },
          items: filteredItems.slice(0, limit)
        });
      } catch (error) {
        jsonResponse(res, error?.status || 400, errorBody(error));
      }
    }
    return;
  }
  if (legacyFeedEnabled && url.pathname === "/api/feed") {
    const { status, body } = await feedResponse();
    res.writeHead(status, { "content-type": types[".json"] });
    res.end(JSON.stringify(body));
    return;
  }
  if (legacyFeedEnabled && url.pathname === "/api/import-delta") {
    const { status, body } = await importDeltaResponse();
    res.writeHead(status, { "content-type": types[".json"] });
    res.end(JSON.stringify(body));
    return;
  }
  if (legacyFeedEnabled && url.pathname === "/api/roadmap") {
    const { status, body } = await roadmapResponse();
    res.writeHead(status, { "content-type": types[".json"] });
    res.end(JSON.stringify(body));
    return;
  }
  if (url.pathname === "/api/workspace" && req.method === "GET") {
    try {
      const { status, body } = await workspaceResponse(url.searchParams);
      jsonResponse(res, status, body);
    } catch (error) {
      jsonResponse(res, error?.status || 500, errorBody(error));
    }
    return;
  }
  if (url.pathname === "/api/proof/bundle" && req.method === "GET") {
    try {
      const { status, body } = await proofBundleResponse(url.searchParams);
      jsonResponse(res, status, body);
    } catch (error) {
      jsonResponse(res, error?.status || 500, errorBody(error));
    }
    return;
  }
  if (url.pathname === "/api/proof/source" && req.method === "GET") {
    try {
      const { status, body } = await proofSourceResponse(url.searchParams);
      jsonResponse(res, status, body);
    } catch (error) {
      jsonResponse(res, error?.status || 500, errorBody(error));
    }
    return;
  }
  if (url.pathname === "/api/proof/run" && req.method === "POST") {
    try {
      const { status, body } = await proofRunResponse(req);
      jsonResponse(res, status, body);
    } catch (error) {
      jsonResponse(res, error?.status || 500, errorBody(error));
    }
    return;
  }
  if (url.pathname === "/api/review-decisions" && req.method === "GET") {
    if (!localStore) {
      jsonResponse(res, 409, { error: "durable_state_disabled", message: "Durable Halba state is not configured." });
    } else {
      try {
        const scope = Object.fromEntries(["workspaceId", "threadId", "bundleId"].map((key) => [key, url.searchParams.get(key) || ""]));
        jsonResponse(res, 200, localStore.listReviewDecisions(scope));
      } catch (error) {
        jsonResponse(res, error?.status || 400, errorBody(error));
      }
    }
    return;
  }
  if (url.pathname === "/api/recent-decisions" && req.method === "GET") {
    if (!localStore) {
      jsonResponse(res, 409, { error: "durable_state_disabled", message: "Durable Halba state is not configured." });
    } else {
      try {
        const limit = Number(url.searchParams.get("limit") || 30);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw apiError("invalid_limit", "Recent decisions limit must be an integer from 1 to 100.", 400);
        const workspaceFilter = url.searchParams.get("workspaceId") || null;
        if (workspaceFilter && !localStore.getWorkspace(workspaceFilter)) throw apiError("workspace_not_found", "The requested workspace is unavailable.", 404);
        const workspaces = localStore.listWorkspaces().filter(({ id }) => !workspaceFilter || id === workspaceFilter);
        const items = workspaces.flatMap((workspace) => localStore.listWorkspaceReviewDecisions(workspace.id).flatMap((decision) => {
          const events = localStore.listReviewDecisionEvents(decision);
          const currentEventId = events.at(-1)?.eventId;
          return events.map((event) => ({
            ...event,
            workspaceName: workspace.name,
            current: event.action === "set" && event.eventId === currentEventId,
            currentStatus: decision.status,
            currentUpdatedAt: decision.updatedAt
          }));
        })).sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt) || right.eventId - left.eventId);
        jsonResponse(res, 200, {
          schemaVersion: 1,
          page: { limit, returned: Math.min(limit, items.length), totalItems: items.length, truncated: items.length > limit },
          items: items.slice(0, limit)
        });
      } catch (error) {
        jsonResponse(res, error?.status || 400, errorBody(error));
      }
    }
    return;
  }
  if (url.pathname === "/api/review-decision" && req.method === "PUT") {
    try {
      const { status, body } = await reviewDecisionResponse(req);
      jsonResponse(res, status, body);
    } catch (error) {
      jsonResponse(res, error?.status || 400, errorBody(error));
    }
    return;
  }
  if (url.pathname === "/api/review-decision" && req.method === "DELETE") {
    try {
      const { status, body } = await deleteReviewDecisionResponse(req);
      jsonResponse(res, status, body);
    } catch (error) {
      jsonResponse(res, error?.status || 400, errorBody(error));
    }
    return;
  }
  if (legacyFeedEnabled && url.pathname === "/api/source") {
    const { status, body } = await sourceResponse(url.searchParams);
    res.writeHead(status, { "content-type": types[".json"] });
    res.end(JSON.stringify(body));
    return;
  }
  if (legacyFeedEnabled && url.pathname === "/source") {
    const { status, body } = await sourceResponse(url.searchParams, Number.POSITIVE_INFINITY);
    res.writeHead(status, { "content-type": status === 200 ? "text/plain; charset=utf-8" : types[".json"] });
    res.end(status === 200 ? body.text : JSON.stringify(body));
    return;
  }

  const file = resolveRequest(req.url || "/");
  if (!file) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream"
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Halba running at http://${host.includes(":") ? `[${host}]` : host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    localStore?.close();
    server.close(() => process.exit(0));
  });
}
