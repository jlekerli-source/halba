import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proofVerdicts } from "./schema.js";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const defaultProofBundlePath = path.join(moduleRoot, "data", "demo", "bundle.json");
export const sourceByteLimit = 64 * 1024;
export const bundleByteLimit = 128 * 1024;
export const totalSourceByteLimit = 256 * 1024;
export const sourceCountLimit = 32;

const sourceKinds = new Set(["report", "source", "receipt", "diff", "test"]);
const guardTypes = new Set([
  "source_contains",
  "receipt_exit",
  "citation_required",
  "json_field_equals",
  "freshness"
]);

export async function loadProofBundle(bundleFile = process.env.HALBA_PROOF_BUNDLE || defaultProofBundlePath) {
  const bundlePath = path.resolve(bundleFile);
  const bundleStat = await stat(bundlePath);
  if (!bundleStat.isFile()) throw bundleError("proof bundle is not a file");
  if (bundleStat.size > bundleByteLimit) throw bundleError("proof bundle exceeds the size limit");

  const definition = JSON.parse(await readFile(bundlePath, "utf8"));
  assertBundleDefinition(definition);

  const bundleRoot = await realpath(path.dirname(bundlePath));
  const sources = [];
  let totalBytes = 0;

  for (const sourceDefinition of definition.sources) {
    const sourcePath = resolveBundleSource(bundleRoot, sourceDefinition.path);
    const sourceRealPath = await realpath(sourcePath).catch(() => null);
    if (!sourceRealPath || !isInside(bundleRoot, sourceRealPath)) {
      throw bundleError(`source is missing or outside the bundle: ${sourceDefinition.path}`);
    }
    const sourceStat = await stat(sourceRealPath);
    if (!sourceStat.isFile()) throw bundleError(`source is not a file: ${sourceDefinition.path}`);
    if (sourceStat.size > sourceByteLimit) throw bundleError(`source exceeds the size limit: ${sourceDefinition.path}`);
    totalBytes += sourceStat.size;
    if (totalBytes > totalSourceByteLimit) throw bundleError("proof bundle sources exceed the total size limit");

    const bytes = await readFile(sourceRealPath);
    const text = bytes.toString("utf8").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    sources.push({
      ...sourceDefinition,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      lineCount: lines.length,
      lines,
      text
    });
  }

  const sourceByPath = new Map(sources.map((source) => [source.path, source]));
  if (!sourceByPath.has(definition.reportPath)) throw bundleError("reportPath is not declared as a source");

  for (const guard of definition.guards) {
    if (guard.path && !sourceByPath.has(guard.path)) {
      throw bundleError(`guard source is not declared: ${guard.path}`);
    }
  }

  return {
    bundlePath,
    bundleRoot,
    definition,
    sources,
    sourceByPath,
    totalBytes
  };
}

export function publicBundleSummary(bundle) {
  return {
    id: bundle.definition.id,
    title: bundle.definition.title,
    generatedAt: bundle.definition.generatedAt,
    evaluationDate: bundle.definition.evaluationDate,
    agent: bundle.definition.agent,
    sourceCount: bundle.sources.length,
    totalBytes: bundle.totalBytes,
    sources: bundle.sources.map(({ path: sourcePath, label, kind, bytes, sha256, lineCount }) => ({
      path: sourcePath,
      label,
      kind,
      bytes,
      sha256,
      lineCount
    }))
  };
}

export function assertSafeBundlePath(value) {
  const filePath = String(value || "");
  const segments = filePath.split(/[\\/]+/);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(filePath);
  if (
    !filePath
    || path.isAbsolute(filePath)
    || path.win32.isAbsolute(filePath)
    || hasScheme
    || segments.includes("..")
  ) {
    throw bundleError(`unsafe bundle path: ${filePath || "(empty)"}`);
  }
  return filePath;
}

function assertBundleDefinition(definition) {
  invariant(definition?.schemaVersion === 1, "unsupported proof bundle schemaVersion");
  for (const field of ["id", "title", "generatedAt", "evaluationDate", "agent", "reportPath"]) {
    invariant(typeof definition[field] === "string" && definition[field].trim(), `proof bundle is missing ${field}`);
  }
  invariant(!Number.isNaN(new Date(definition.generatedAt).getTime()), "proof bundle has an invalid generatedAt");
  invariant(!Number.isNaN(new Date(`${definition.evaluationDate}T12:00:00Z`).getTime()), "proof bundle has an invalid evaluationDate");
  assertSafeBundlePath(definition.reportPath);
  invariant(Array.isArray(definition.sources) && definition.sources.length > 0, "proof bundle is missing sources");
  invariant(definition.sources.length <= sourceCountLimit, "proof bundle has too many sources");

  const sourcePaths = new Set();
  for (const source of definition.sources) {
    invariant(source && typeof source === "object", "proof bundle source must be an object");
    assertSafeBundlePath(source.path);
    invariant(!sourcePaths.has(source.path), `duplicate proof bundle source ${source.path}`);
    sourcePaths.add(source.path);
    invariant(typeof source.label === "string" && source.label.trim(), `proof source ${source.path} is missing a label`);
    invariant(sourceKinds.has(source.kind), `proof source ${source.path} has an invalid kind`);
  }

  invariant(Array.isArray(definition.guards), "proof bundle is missing guards");
  for (const guard of definition.guards) {
    invariant(typeof guard.claimId === "string" && guard.claimId.trim(), "proof guard is missing claimId");
    invariant(guardTypes.has(guard.type), `proof guard ${guard.claimId} has an invalid type`);
    invariant(proofVerdicts.has(guard.passVerdict), `proof guard ${guard.claimId} has an invalid passVerdict`);
    invariant(proofVerdicts.has(guard.failVerdict), `proof guard ${guard.claimId} has an invalid failVerdict`);
    if (guard.path) assertSafeBundlePath(guard.path);
  }
}

function resolveBundleSource(bundleRoot, sourcePath) {
  assertSafeBundlePath(sourcePath);
  const target = path.resolve(bundleRoot, sourcePath);
  if (!isInside(bundleRoot, target)) throw bundleError(`source is outside the bundle: ${sourcePath}`);
  return target;
}

function isInside(base, target) {
  const relative = path.relative(base, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function invariant(condition, message) {
  if (!condition) throw bundleError(message);
}

function bundleError(message) {
  const error = new Error(message);
  error.name = "ProofBundleError";
  error.code = "invalid_proof_bundle";
  return error;
}
