import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const releaseManifestSchemaVersion = 1;
export const releaseManifestByteLimit = 64 * 1024;
export const releaseArtifactLimit = 32;
export const releaseCheckLimit = 64;
export const releaseArtifactByteLimit = 16 * 1024 * 1024;
export const releaseTotalByteLimit = 64 * 1024 * 1024;

const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const checkStatuses = new Set(["passed", "failed", "pending", "skipped"]);
const rootKeys = new Set(["schemaVersion", "release", "artifacts", "checks"]);
const releaseKeys = new Set(["id", "version", "revision", "commitSha", "generatedAt"]);
const artifactKeys = new Set(["id", "path", "sha256", "byteCount"]);
const checkKeys = new Set(["id", "required", "status"]);

export async function inspectReleaseManifest(file, { root } = {}) {
  if (!root) throw manifestError("--root is required");
  const manifestPath = path.resolve(file instanceof URL ? fileURLToPath(file) : file);
  const rootInput = path.resolve(root instanceof URL ? fileURLToPath(root) : root);
  const rootPath = await resolveRoot(rootInput);
  const manifestBytes = await readManifestBytes(manifestPath);
  const sourceDigest = sha256(manifestBytes);
  let parsed;
  try {
    parsed = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw manifestError("manifest must contain valid JSON");
  }

  const manifest = canonicalManifest(parsed);
  const artifacts = await inspectArtifacts(rootPath, manifest.artifacts);
  const readiness = releaseReadiness(manifest.checks);
  const canonicalDigest = sha256(Buffer.from(canonicalJson(manifest)));

  return {
    adapter: { id: "release-manifest-v1", version: 1 },
    manifest,
    manifestPath,
    sourceRef: path.basename(manifestPath),
    sourceDigest,
    canonicalDigest,
    semanticDigest: canonicalDigest,
    artifacts,
    checks: structuredClone(manifest.checks),
    readiness,
    async revalidate() {
      const currentRoot = await resolveRoot(rootInput);
      if (currentRoot !== rootPath) throw manifestError("--root resolves to a different boundary than inspection");
      const currentManifestBytes = await readManifestBytes(manifestPath);
      if (sha256(currentManifestBytes) !== sourceDigest) throw manifestError("manifest changed after inspection");
      const currentArtifacts = await inspectArtifacts(rootPath, manifest.artifacts);
      return {
        sourceDigest,
        canonicalDigest,
        artifactCount: currentArtifacts.length,
        totalBytes: currentArtifacts.reduce((sum, artifact) => sum + artifact.byteCount, 0),
        artifacts: currentArtifacts
      };
    }
  };
}

function canonicalManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw manifestError("manifest root must be an object");
  exactKeys(input, rootKeys, "manifest");
  if (input.schemaVersion !== releaseManifestSchemaVersion) throw manifestError(`schemaVersion must be ${releaseManifestSchemaVersion}`);
  if (!input.release || typeof input.release !== "object" || Array.isArray(input.release)) throw manifestError("release must be an object");
  exactKeys(input.release, releaseKeys, "release");
  requireId(input.release.id, "release id");
  if (typeof input.release.version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(input.release.version)) throw manifestError("release version must be a bounded identifier");
  if (!Number.isSafeInteger(input.release.revision) || input.release.revision < 1) throw manifestError("release revision must be a positive safe integer");
  if (typeof input.release.commitSha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(input.release.commitSha)) throw manifestError("release commitSha must be a 40- or 64-character hexadecimal digest");
  if (typeof input.release.generatedAt !== "string" || !Number.isFinite(Date.parse(input.release.generatedAt))) throw manifestError("release generatedAt must be a timestamp");
  const release = {
    id: input.release.id,
    version: input.release.version,
    revision: input.release.revision,
    commitSha: input.release.commitSha.toLowerCase(),
    generatedAt: new Date(input.release.generatedAt).toISOString()
  };
  if (!Array.isArray(input.artifacts) || !input.artifacts.length) throw manifestError("artifacts must be a non-empty allowlist");
  if (input.artifacts.length > releaseArtifactLimit) throw manifestError(`artifacts exceed the ${releaseArtifactLimit}-item limit`);
  if (!Array.isArray(input.checks)) throw manifestError("checks must be an array");
  if (input.checks.length > releaseCheckLimit) throw manifestError(`checks exceed the ${releaseCheckLimit}-item limit`);

  const artifactIds = new Set();
  const artifactPaths = new Set();
  const artifacts = input.artifacts.map((artifact, index) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) throw manifestError(`artifact ${index + 1} must be an object`);
    exactKeys(artifact, artifactKeys, `artifact ${index + 1}`);
    requireId(artifact.id, `artifact ${index + 1} id`);
    if (artifactIds.has(artifact.id)) throw manifestError(`artifact id ${artifact.id} is duplicated`);
    artifactIds.add(artifact.id);
    const relativePath = safeRelativePath(artifact.path, `artifact ${artifact.id} path`);
    if (artifactPaths.has(relativePath)) throw manifestError(`artifact path ${relativePath} is duplicated`);
    artifactPaths.add(relativePath);
    if (!sha256Pattern.test(artifact.sha256 || "")) throw manifestError(`artifact ${artifact.id} sha256 must be 64 lowercase hexadecimal characters`);
    if (!Number.isSafeInteger(artifact.byteCount) || artifact.byteCount < 0 || artifact.byteCount > releaseArtifactByteLimit) throw manifestError(`artifact ${artifact.id} byteCount exceeds the per-artifact limit`);
    return { id: artifact.id, path: relativePath, sha256: artifact.sha256, byteCount: artifact.byteCount };
  }).sort(compareByIdThenPath);

  const checkIds = new Set();
  const checks = input.checks.map((check, index) => {
    if (!check || typeof check !== "object" || Array.isArray(check)) throw manifestError(`check ${index + 1} must be an object`);
    exactKeys(check, checkKeys, `check ${index + 1}`);
    requireId(check.id, `check ${index + 1} id`);
    if (checkIds.has(check.id)) throw manifestError(`check id ${check.id} is duplicated`);
    checkIds.add(check.id);
    if (typeof check.required !== "boolean") throw manifestError(`check ${check.id} required must be boolean`);
    if (!checkStatuses.has(check.status)) throw manifestError(`check ${check.id} status must be passed, failed, pending, or skipped`);
    return { id: check.id, required: check.required, status: check.status };
  }).sort(compareById);

  const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.byteCount, 0);
  if (totalBytes > releaseTotalByteLimit) throw manifestError("artifacts exceed the total byte limit");
  return { schemaVersion: releaseManifestSchemaVersion, release, artifacts, checks };
}

function releaseReadiness(checks) {
  const required = checks.filter((check) => check.required);
  const blocking = required.filter((check) => check.status !== "passed");
  return {
    status: blocking.length ? "blocked" : "ready",
    ready: blocking.length === 0,
    required: required.length,
    passed: required.length - blocking.length,
    blockingCheckIds: blocking.map((check) => check.id)
  };
}

async function resolveRoot(rootInput) {
  let rootStat;
  try {
    rootStat = await lstat(rootInput);
  } catch {
    throw manifestError("--root does not exist");
  }
  if (!rootStat.isDirectory()) throw manifestError("--root must be a directory");
  return realpath(rootInput);
}

async function readManifestBytes(manifestPath) {
  let manifestStat;
  try {
    manifestStat = await lstat(manifestPath);
  } catch {
    throw manifestError("manifest does not exist");
  }
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw manifestError("manifest must be a regular non-symlink file");
  if (manifestStat.size > releaseManifestByteLimit) throw manifestError("manifest exceeds the 64 KB limit");
  let handle;
  try {
    handle = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) throw manifestError("manifest must be a regular file");
    if (openedStat.size > releaseManifestByteLimit) throw manifestError("manifest exceeds the 64 KB limit");
    return await handle.readFile();
  } catch (error) {
    if (error?.code === "invalid_release_manifest") throw error;
    throw manifestError("manifest could not be inspected");
  } finally {
    await handle?.close();
  }
}

async function inspectArtifacts(rootPath, declarations) {
  const artifacts = [];
  for (const declaration of declarations) artifacts.push(await inspectArtifact(rootPath, declaration));
  return artifacts;
}

async function inspectArtifact(rootPath, declaration) {
  const unresolved = path.resolve(rootPath, declaration.path);
  if (!isInside(rootPath, unresolved)) throw manifestError(`artifact ${declaration.id} escapes --root`);
  let unresolvedStat;
  try {
    unresolvedStat = await lstat(unresolved);
  } catch {
    throw manifestError(`artifact ${declaration.id} does not exist`);
  }
  if (!unresolvedStat.isFile() || unresolvedStat.isSymbolicLink()) throw manifestError(`artifact ${declaration.id} must be a regular non-symlink file`);
  const resolved = await realpath(unresolved);
  if (!isInside(rootPath, resolved)) throw manifestError(`artifact ${declaration.id} escapes --root`);

  let handle;
  try {
    handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    const artifactStat = await handle.stat();
    if (!artifactStat.isFile()) throw manifestError(`artifact ${declaration.id} must be a regular file`);
    if (artifactStat.size !== declaration.byteCount) throw manifestError(`artifact ${declaration.id} byteCount does not match`);
    const digest = await hashHandle(handle);
    if (digest !== declaration.sha256) throw manifestError(`artifact ${declaration.id} sha256 does not match`);
  } catch (error) {
    if (error?.code === "invalid_release_manifest") throw error;
    throw manifestError(`artifact ${declaration.id} could not be inspected`);
  } finally {
    await handle?.close();
  }
  return structuredClone(declaration);
}

async function hashHandle(handle) {
  const digest = createHash("sha256");
  const stream = handle.createReadStream({ autoClose: false, start: 0 });
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

function safeRelativePath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0") || /[*?\[\]{}]/.test(value)) throw manifestError(`${label} must be a safe relative path without glob syntax`);
  if (path.posix.isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) throw manifestError(`${label} must be a safe relative path`);
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) throw manifestError(`${label} must be a safe relative path`);
  return normalized;
}

function requireId(value, label) {
  if (typeof value !== "string" || !idPattern.test(value)) throw manifestError(`${label} must be a safe slug`);
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort();
  const missing = [...allowed].filter((key) => !Object.hasOwn(value, key));
  if (unknown.length) throw manifestError(`${label} contains unsupported field ${unknown[0]}`);
  if (missing.length) throw manifestError(`${label} is missing ${missing[0]}`);
}

function compareById(left, right) {
  return compareText(left.id, right.id);
}

function compareByIdThenPath(left, right) {
  return compareText(left.id, right.id) || compareText(left.path, right.path);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function manifestError(message) {
  const error = new Error(`invalid release manifest: ${message}`);
  error.code = "invalid_release_manifest";
  return error;
}
