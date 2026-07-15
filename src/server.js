import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeAgentUpdates } from "./domain/agent-updates.js";
import { formatImportRunDelta, formatImportRunDeltaDetails, importRunDelta } from "./domain/feed.js";
import { loadWorkspace } from "./domain/workspace.js";
import { loadProofBundle, publicBundleSummary } from "./proof/bundle.js";
import { runProof } from "./proof/run.js";

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
const port = Number(process.env.PORT || 4177);
const sourceLimit = 14000;
const requestBodyLimit = 4096;

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

async function proofBundleResponse() {
  const bundle = await loadProofBundle();
  return { status: 200, body: publicBundleSummary(bundle) };
}

async function workspaceResponse() {
  const bundle = await loadProofBundle();
  return { status: 200, body: await loadWorkspace(undefined, { proofBundleId: bundle.id }) };
}

async function proofSourceResponse(searchParams) {
  const sourcePath = searchParams.get("path") || "";
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
  const body = await readJsonBody(req);
  const proof = await runProof({ mode: body.mode || "recorded" });
  return { status: 200, body: proof };
}

async function readJsonBody(req) {
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim();
  if (contentType !== "application/json") throw apiError("content_type_required", "Proof requests require application/json.", 415);

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > requestBodyLimit) throw apiError("request_too_large", "Proof request exceeds the 4 KB limit.", 413);
    chunks.push(chunk);
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
    return body;
  } catch {
    throw apiError("invalid_json", "Proof request body must be a JSON object.", 400);
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
    message: error?.status ? error.message : "Proof analysis failed unexpectedly."
  };
}

function resolveRequest(url) {
  const pathname = new URL(url, "http://localhost").pathname;
  if (pathname === "/api/feed") return feedPath;
  if (pathname.startsWith("/domain/")) {
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
  if (url.pathname === "/api/feed") {
    const { status, body } = await feedResponse();
    res.writeHead(status, { "content-type": types[".json"] });
    res.end(JSON.stringify(body));
    return;
  }
  if (url.pathname === "/api/import-delta") {
    const { status, body } = await importDeltaResponse();
    res.writeHead(status, { "content-type": types[".json"] });
    res.end(JSON.stringify(body));
    return;
  }
  if (url.pathname === "/api/roadmap") {
    const { status, body } = await roadmapResponse();
    res.writeHead(status, { "content-type": types[".json"] });
    res.end(JSON.stringify(body));
    return;
  }
  if (url.pathname === "/api/workspace" && req.method === "GET") {
    try {
      const { status, body } = await workspaceResponse();
      res.writeHead(status, { "content-type": types[".json"] });
      res.end(JSON.stringify(body));
    } catch (error) {
      res.writeHead(500, { "content-type": types[".json"] });
      res.end(JSON.stringify(errorBody(error)));
    }
    return;
  }
  if (url.pathname === "/api/proof/bundle" && req.method === "GET") {
    try {
      const { status, body } = await proofBundleResponse();
      res.writeHead(status, { "content-type": types[".json"] });
      res.end(JSON.stringify(body));
    } catch (error) {
      res.writeHead(error?.status || 500, { "content-type": types[".json"] });
      res.end(JSON.stringify(errorBody(error)));
    }
    return;
  }
  if (url.pathname === "/api/proof/source" && req.method === "GET") {
    try {
      const { status, body } = await proofSourceResponse(url.searchParams);
      res.writeHead(status, { "content-type": types[".json"] });
      res.end(JSON.stringify(body));
    } catch (error) {
      res.writeHead(error?.status || 500, { "content-type": types[".json"] });
      res.end(JSON.stringify(errorBody(error)));
    }
    return;
  }
  if (url.pathname === "/api/proof/run" && req.method === "POST") {
    try {
      const { status, body } = await proofRunResponse(req);
      res.writeHead(status, { "content-type": types[".json"] });
      res.end(JSON.stringify(body));
    } catch (error) {
      res.writeHead(error?.status || 500, { "content-type": types[".json"] });
      res.end(JSON.stringify(errorBody(error)));
    }
    return;
  }
  if (url.pathname === "/api/source") {
    const { status, body } = await sourceResponse(url.searchParams);
    res.writeHead(status, { "content-type": types[".json"] });
    res.end(JSON.stringify(body));
    return;
  }
  if (url.pathname === "/source") {
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

server.listen(port, () => {
  console.log(`Halba running at http://localhost:${port}`);
});
