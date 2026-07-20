import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ciManifestByteLimit, inspectCiManifest } from "../src/importers/ci-manifest.js";

const fixtureUrl = new URL("../data/import-fixtures/ci-receipt.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const inspection = await inspectCiManifest(fixtureUrl);

assert.equal(inspection.adapter.id, "ci-manifest-v1");
assert.equal(inspection.sourceRef, "ci-receipt.json");
assert.match(inspection.sourceDigest, /^[a-f0-9]{64}$/);
assert.match(inspection.semanticDigest, /^[a-f0-9]{64}$/);
assert.equal(inspection.conclusion, "failed");
assert.equal(inspection.readiness, "blocked");
assert.equal(inspection.run.status, "failed");
assert.equal(inspection.run.proofState, "not_required");
assert.equal(inspection.run.completedAt, fixture.run.updatedAt);
assert.deepEqual(inspection.checks.map((check) => check.id), ["package", "privacy"]);
assert.deepEqual(inspection.counts, { checks: 2, passed: 1, failed: 1, running: 0, cancelled: 0, skipped: 0 });
assert.equal(Object.values(inspection.privacy).every((value) => value === false), true);
assert.equal(JSON.stringify(inspection).includes("https://"), false);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-ci-manifest-"));
try {
  const reordered = structuredClone(fixture);
  reordered.checks.reverse();
  const reorderedPath = path.join(temporaryRoot, "reordered.json");
  await writeFile(reorderedPath, JSON.stringify(reordered));
  const reorderedInspection = await inspectCiManifest(reorderedPath);
  assert.equal(reorderedInspection.semanticDigest, inspection.semanticDigest, "semantic digest must ignore source formatting and check order");
  assert.notEqual(reorderedInspection.sourceDigest, inspection.sourceDigest, "raw digest must identify exact source bytes");

  const passed = structuredClone(fixture);
  passed.checks[1].status = "passed";
  passed.checks[1].exitCode = 0;
  const passedPath = path.join(temporaryRoot, "passed.json");
  await writeFile(passedPath, JSON.stringify(passed));
  const passedInspection = await inspectCiManifest(passedPath);
  assert.equal(passedInspection.conclusion, "passed");
  assert.equal(passedInspection.readiness, "ready");
  assert.equal(passedInspection.run.status, "completed");

  const running = structuredClone(fixture);
  running.checks = [{ id: "package", status: "running", at: "2026-07-18T08:02:00.000Z" }];
  const runningPath = path.join(temporaryRoot, "running.json");
  await writeFile(runningPath, JSON.stringify(running));
  const runningInspection = await inspectCiManifest(runningPath);
  assert.equal(runningInspection.conclusion, "running");
  assert.equal(runningInspection.readiness, "in_progress");
  assert.equal(runningInspection.run.completedAt, null);

  const mixedRunning = structuredClone(fixture);
  mixedRunning.checks.push({ id: "reconstruct", status: "running", at: "2026-07-18T08:03:30.000Z" });
  const mixedRunningPath = path.join(temporaryRoot, "mixed-running.json");
  await writeFile(mixedRunningPath, JSON.stringify(mixedRunning));
  const mixedRunningInspection = await inspectCiManifest(mixedRunningPath);
  assert.equal(mixedRunningInspection.conclusion, "running", "a non-terminal check keeps the aggregate run in progress");

  const duplicate = structuredClone(fixture);
  duplicate.checks[1].id = duplicate.checks[0].id;
  const duplicatePath = path.join(temporaryRoot, "duplicate.json");
  await writeFile(duplicatePath, JSON.stringify(duplicate));
  await assert.rejects(inspectCiManifest(duplicatePath), /duplicate CI check id/);

  for (const forbiddenField of ["logs", "command", "url", "env", "body"]) {
    const unsafe = structuredClone(fixture);
    unsafe.checks[0][forbiddenField] = "PRIVATE_SENTINEL";
    const unsafePath = path.join(temporaryRoot, `${forbiddenField}.json`);
    await writeFile(unsafePath, JSON.stringify(unsafe));
    await assert.rejects(inspectCiManifest(unsafePath), new RegExp(`unsupported field ${forbiddenField}`));
  }

  const urlRouting = structuredClone(fixture);
  urlRouting.run.goal = "Inspect https://private.invalid/log";
  const urlPath = path.join(temporaryRoot, "url-routing.json");
  await writeFile(urlPath, JSON.stringify(urlRouting));
  await assert.rejects(inspectCiManifest(urlPath), /without paths, URLs, or control characters/);

  const symlinkPath = path.join(temporaryRoot, "receipt-link.json");
  await symlink(path.resolve(new URL(fixtureUrl).pathname), symlinkPath);
  await assert.rejects(inspectCiManifest(symlinkPath), /regular non-symlink/);

  const oversizedPath = path.join(temporaryRoot, "oversized.json");
  await writeFile(oversizedPath, " ".repeat(ciManifestByteLimit + 1));
  await assert.rejects(inspectCiManifest(oversizedPath), /64 KB limit/);

  console.log("check passed: bounded CI manifest inspection is deterministic, derives check authority, and excludes unsafe source fields");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
