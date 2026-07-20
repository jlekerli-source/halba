import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { assertSafeBundlePath } from "./bundle.js";

export function storedBundleSummary(record) {
  if (!record?.bundle?.id) throw storedError("stored proof bundle is malformed", 500);
  const adjudication = record.bundle.adjudication;
  return {
    id: record.bundle.id,
    title: record.bundle.title,
    generatedAt: record.bundle.generatedAt,
    evaluationDate: record.bundle.definition?.evaluationDate || adjudication?.bundle?.evaluationDate,
    agent: record.bundle.definition?.agent || adjudication?.bundle?.agent,
    sourceCount: record.bundle.sources.length,
    totalBytes: record.bundle.sources.reduce((sum, source) => sum + source.byteCount, 0),
    portable: record.portableSourceCount === record.bundle.sources.length,
    executionMode: adjudication?.execution?.mode || null,
    sources: record.bundle.sources.map((source) => ({
      path: source.path,
      label: source.label,
      kind: source.kind,
      bytes: source.byteCount,
      sha256: source.sha256,
      lineCount: source.lineCount
    }))
  };
}

export function storedAdjudication(record) {
  const adjudication = record?.bundle?.adjudication;
  if (!adjudication || adjudication.bundle?.id !== record.bundle.id) throw storedError("stored proof adjudication is unavailable", 409);
  return adjudication;
}

export async function loadStoredSource(record, sourcePath, { startLine, endLine }) {
  assertSafeBundlePath(sourcePath);
  const declared = record.bundle.sources.find((source) => source.path === sourcePath);
  if (!declared) throw storedError("stored proof source is not declared", 404);
  const object = typeof record.sourceObjectProvider === "function" ? record.sourceObjectProvider(sourcePath) : null;
  const bytes = object?.bytes || await loadExternalBytes(record, sourcePath, declared);
  if (bytes.length !== declared.byteCount) throw storedError("stored proof source size changed", 409);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== declared.sha256) throw storedError("stored proof source hash changed", 409);
  const text = bytes.toString("utf8").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== declared.lineCount) throw storedError("stored proof source line map changed", 409);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) {
    throw storedError("invalid stored proof source range", 400);
  }
  return {
    path: declared.path,
    label: declared.label,
    kind: declared.kind,
    sha256,
    startLine,
    endLine,
    lineCount: lines.length,
    text: lines.slice(startLine - 1, endLine).join("\n")
  };
}

async function loadExternalBytes(record, sourcePath, declared) {
  if (!record?.sourceRoot) throw storedError("stored proof source root is unavailable", 409);
  const root = await realpath(record.sourceRoot).catch(() => null);
  if (!root) throw storedError("stored proof source root is unavailable", 409);
  const target = path.resolve(root, sourcePath);
  const resolved = await realpath(target).catch(() => null);
  if (!resolved || !isInside(root, resolved)) throw storedError("stored proof source is unavailable", 404);
  const fileStat = await stat(resolved);
  if (!fileStat.isFile() || fileStat.size !== declared.byteCount) throw storedError("stored proof source size changed", 409);
  return readFile(resolved);
}

function isInside(base, target) {
  const relative = path.relative(base, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function storedError(message, status) {
  const error = new Error(message);
  error.code = "stored_proof_error";
  error.status = status;
  return error;
}
