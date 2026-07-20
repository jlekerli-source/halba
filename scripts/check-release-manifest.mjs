import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectReleaseManifest } from "../src/importers/release-manifest.js";

const fixtureUrl = new URL("../data/import-fixtures/release-manifest.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const fixtureRoot = path.dirname(new URL(fixtureUrl).pathname);
const inspection = await inspectReleaseManifest(fixtureUrl, { root: fixtureRoot });
assert.equal(inspection.adapter.id, "release-manifest-v1");
assert.equal(inspection.readiness.status, "ready");
assert.equal(inspection.artifacts.length, 1);
assert.equal(JSON.stringify(inspection).includes("Halba release artifact fixture"), false, "artifact bytes must never enter the inspection result");
await inspection.revalidate();

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-release-manifest-"));
try {
  const manifestPath = path.join(temporaryRoot, "release.json");
  const artifactPath = path.join(temporaryRoot, "release-artifact.txt");
  await copyFile(new URL("../data/import-fixtures/release-artifact.txt", import.meta.url), artifactPath);

  const reordered = structuredClone(fixture);
  reordered.checks.reverse();
  await writeFile(manifestPath, JSON.stringify(reordered));
  const reorderedInspection = await inspectReleaseManifest(manifestPath, { root: temporaryRoot });
  assert.equal(reorderedInspection.semanticDigest, inspection.semanticDigest, "check order and JSON formatting must not change semantic identity");
  assert.notEqual(reorderedInspection.sourceDigest, inspection.sourceDigest, "raw digest must still identify exact manifest bytes");

  await writeFile(artifactPath, "changed after preview");
  await assert.rejects(reorderedInspection.revalidate(), /byteCount does not match|sha256 does not match/);
  await copyFile(new URL("../data/import-fixtures/release-artifact.txt", import.meta.url), artifactPath);

  const duplicate = structuredClone(fixture);
  duplicate.checks[1].id = duplicate.checks[0].id;
  await writeFile(manifestPath, JSON.stringify(duplicate));
  await assert.rejects(inspectReleaseManifest(manifestPath, { root: temporaryRoot }), /duplicated/);

  const unknown = structuredClone(fixture);
  unknown.artifacts[0].body = "PRIVATE_RELEASE_BODY_SENTINEL";
  await writeFile(manifestPath, JSON.stringify(unknown));
  await assert.rejects(inspectReleaseManifest(manifestPath, { root: temporaryRoot }), /unsupported field body/);

  const traversal = structuredClone(fixture);
  traversal.artifacts[0].path = "../release-artifact.txt";
  await writeFile(manifestPath, JSON.stringify(traversal));
  await assert.rejects(inspectReleaseManifest(manifestPath, { root: temporaryRoot }), /safe relative path/);

  const symlinkManifest = structuredClone(fixture);
  symlinkManifest.artifacts[0].path = "artifact-link.txt";
  await symlink(artifactPath, path.join(temporaryRoot, "artifact-link.txt"));
  await writeFile(manifestPath, JSON.stringify(symlinkManifest));
  await assert.rejects(inspectReleaseManifest(manifestPath, { root: temporaryRoot }), /regular non-symlink/);

  console.log("check passed: release packets use explicit verified allowlists, canonical semantics, and commit-time artifact revalidation");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
