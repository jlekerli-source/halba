import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectCiManifest } from "../src/importers/ci-manifest.js";
import { inspectCodexSession } from "../src/importers/codex-session.js";
import { inspectReleaseManifest } from "../src/importers/release-manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "data", "import-fixtures");
const importCli = path.join(root, "scripts", "import-run.mjs");
const ciFixture = path.join(fixtures, "ci-receipt.json");
const codexManifest = path.join(fixtures, "codex-run.json");
const codexClean = path.join(fixtures, "codex-session-clean.jsonl");
const codexMalformed = path.join(fixtures, "codex-session.jsonl");
const proofBundle = path.join(fixtures, "codex-proof", "bundle.json");
const proofOutput = path.join(fixtures, "codex-proof", "proof-output.json");
const releaseFixture = path.join(fixtures, "release-manifest.json");
const releaseRouting = path.join(fixtures, "release-run.json");
const privacySentinels = [
  "TRANSCRIPT_BODY_SENTINEL",
  "COMMAND_BODY_SENTINEL",
  "EVENT_TYPE_SENTINEL",
  "TOP_LEVEL_TYPE_SENTINEL"
];

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-adapter-conformance-"));
try {
  const absentState = path.join(temporaryRoot, "absent", "halba.sqlite");
  const ciArgs = ["--adapter", "ci", "--source", ciFixture, "--state", absentState];
  const absentPreview = runImport([...ciArgs, "--dry-run"]);
  assert.equal(absentPreview.type, "halba.import.preview");
  assert.equal(absentPreview.writesState, false);
  assert.equal(absentPreview.action, "create");
  assert.equal(await pathExists(absentState), false, "dry-run with absent state must not create a database");
  assert.equal(await pathExists(path.dirname(absentState)), false, "dry-run with absent state must not create parent directories");

  const ciInspections = await Promise.all(Array.from({ length: 100 }, () => inspectCiManifest(ciFixture)));
  for (const inspection of ciInspections) assert.deepEqual(inspection, ciInspections[0], "CI inspection must replay deterministically");
  for (let iteration = 0; iteration < 100; iteration += 1) {
    assert.deepEqual(runImport([...ciArgs, "--dry-run"]), absentPreview, "fixed dry-run preview must replay deterministically");
  }

  await checkCliCommitReplayMatrix();

  const firstCommit = runImport(ciArgs);
  assert.equal(firstCommit.type, "halba.import.receipt");
  assert.equal(firstCommit.outcome, "committed");
  assert.equal(firstCommit.transaction.stateCommitted, true);

  const existingDryRunBefore = await stateFootprint(absentState);
  const existingDryRunLogicalBefore = sqliteSnapshot(absentState);
  const releasePreview = runImport([
    "--adapter", "release",
    "--manifest", releaseRouting,
    "--source", releaseFixture,
    "--root", fixtures,
    "--state", absentState,
    "--dry-run"
  ]);
  assert.equal(releasePreview.writesState, false);
  const existingDryRunAfter = await stateFootprint(absentState);
  assert.deepEqual(sqliteSnapshot(absentState), existingDryRunLogicalBefore, "existing-state dry-run must not change logical state");
  assert.deepEqual(existingDryRunAfter[path.basename(absentState)], existingDryRunBefore[path.basename(absentState)], "existing-state dry-run must not change database bytes");
  if (existingDryRunAfter[`${path.basename(absentState)}-wal`]) {
    assert.equal(existingDryRunAfter[`${path.basename(absentState)}-wal`].bytes, 0, "read-only preview may open WAL metadata but must not append WAL bytes");
  }

  const codexCommit = runImport([
    "--adapter", "codex",
    "--manifest", codexManifest,
    "--source", codexClean,
    "--state", absentState
  ]);
  assert.equal(codexCommit.outcome, "committed");
  const staleCommitBefore = await stateFootprint(absentState);
  const stalePlan = runImport([
    "--adapter", "release",
    "--manifest", releaseRouting,
    "--source", releaseFixture,
    "--root", fixtures,
    "--state", absentState,
    "--expect-plan-digest", releasePreview.planDigest
  ], { expectFailure: true });
  assert.match(stalePlan.stderr, /expected import plan digest does not match|plan_changed|plan changed/i);
  assert.deepEqual(await stateFootprint(absentState), staleCommitBefore, "stale expected plan rejection must not mutate state");

  const malformedProofState = path.join(temporaryRoot, "malformed-proof", "halba.sqlite");
  const malformedProof = runImport([
    "--adapter", "codex",
    "--manifest", codexManifest,
    "--source", codexMalformed,
    "--bundle", proofBundle,
    "--proof-output", proofOutput,
    "--state", malformedProofState,
    "--dry-run"
  ], { expectFailure: true });
  assert.match(malformedProof.stderr, /cannot attach proof while the Codex source is incomplete or malformed/i);
  assert.equal(await pathExists(malformedProofState), false, "rejected malformed proof input must not create state");

  const privacyPreview = runImport([
    "--adapter", "codex",
    "--manifest", codexManifest,
    "--source", codexMalformed,
    "--state", path.join(temporaryRoot, "privacy-preview.sqlite"),
    "--dry-run"
  ]);
  assert.equal(privacyPreview.writesState, false);
  assertPrivacySentinelsAbsent(JSON.stringify(privacyPreview), "preview JSON");

  const privacyState = path.join(temporaryRoot, "privacy", "halba.sqlite");
  const privacyCommit = runImport([
    "--adapter", "codex",
    "--manifest", codexManifest,
    "--source", codexMalformed,
    "--state", privacyState,
    "--allow-degraded"
  ]);
  assert.equal(privacyCommit.outcome, "committed");
  assertPrivacySentinelsAbsent(JSON.stringify(privacyCommit), "commit receipt");
  assertPrivacySentinelsAbsent(await stateBytes(privacyState), "SQLite state");

  await checkCanonicalReordering();
  await checkDuplicateIds();
  await checkReleaseRevalidation();
  await checkReleaseMutationAtCliCommit();
  await checkTraversalAndSymlinks();

  const codexDeterministic = await Promise.all(Array.from({ length: 100 }, () => inspectCodexSession(codexClean)));
  for (const inspection of codexDeterministic) assert.deepEqual(inspection, codexDeterministic[0], "Codex inspection must replay deterministically");
  const releaseDeterministic = await Promise.all(Array.from({ length: 100 }, () => inspectReleaseManifest(releaseFixture, { root: fixtures })));
  for (const inspection of releaseDeterministic) {
    assert.equal(inspection.semanticDigest, releaseDeterministic[0].semanticDigest);
    assert.deepEqual(inspection.manifest, releaseDeterministic[0].manifest);
    assert.deepEqual(inspection.artifacts, releaseDeterministic[0].artifacts);
  }

  console.log("check passed: three adapters preview without writes, replay idempotently, reject stale or unsafe inputs, preserve privacy, and canonicalize bounded unordered sources");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function checkCliCommitReplayMatrix() {
  const cases = [
    {
      name: "codex",
      args: [
        "--adapter", "codex",
        "--manifest", codexManifest,
        "--source", codexClean,
        "--bundle", proofBundle,
        "--proof-output", proofOutput
      ]
    },
    { name: "ci", args: ["--adapter", "ci", "--source", ciFixture] },
    {
      name: "release",
      args: [
        "--adapter", "release",
        "--manifest", releaseRouting,
        "--source", releaseFixture,
        "--root", fixtures
      ]
    }
  ];

  for (const testCase of cases) {
    const stateFile = path.join(temporaryRoot, "cli-matrix", testCase.name, "halba.sqlite");
    const args = [...testCase.args, "--state", stateFile];
    const preview = runImport([...args, "--dry-run"]);
    assert.equal(preview.type, "halba.import.preview", `${testCase.name} CLI must emit a preview`);
    assert.equal(preview.writesState, false, `${testCase.name} preview must declare no state writes`);
    assert.equal(await pathExists(stateFile), false, `${testCase.name} preview must not create a database`);

    const commit = runImport(args);
    assert.equal(commit.type, "halba.import.receipt", `${testCase.name} CLI must emit a receipt`);
    assert.equal(commit.outcome, "committed", `${testCase.name} first import must commit`);
    assert.equal(commit.transaction.stateCommitted, true, `${testCase.name} first import must commit state`);

    const logicalBeforeReplay = sqliteSnapshot(stateFile);
    const filesBeforeReplay = await stateFootprint(stateFile);
    const replay = runImport(args);
    assert.equal(replay.outcome, "idempotent", `${testCase.name} exact replay must be idempotent`);
    assert.equal(replay.receiptId, commit.receiptId, `${testCase.name} exact replay must return the original receipt`);
    assert.equal(replay.transaction.stateCommitted, false, `${testCase.name} exact replay must not commit state`);
    assert.equal(replay.transaction.receiptProjectionStored, false, `${testCase.name} exact replay must not rewrite its receipt projection`);
    assert.equal(replay.transaction.appendOnlyEventStored, false, `${testCase.name} exact replay must not append import history`);
    assert.deepEqual(sqliteSnapshot(stateFile), logicalBeforeReplay, `${testCase.name} exact replay must make zero logical database changes`);
    assert.deepEqual(await stateFootprint(stateFile), filesBeforeReplay, `${testCase.name} exact replay must make zero database or sidecar byte changes`);
  }
}

async function checkCanonicalReordering() {
  const ciOriginal = JSON.parse(await readFile(ciFixture, "utf8"));
  const ciReorderedFile = path.join(temporaryRoot, "ci-reordered.json");
  await writeJson(ciReorderedFile, { ...ciOriginal, checks: [...ciOriginal.checks].reverse() });
  const [ciLeft, ciRight] = await Promise.all([inspectCiManifest(ciFixture), inspectCiManifest(ciReorderedFile)]);
  assert.notEqual(ciLeft.sourceDigest, ciRight.sourceDigest, "reordered CI bytes should prove the semantic digest is not a raw byte digest");
  assert.equal(ciLeft.semanticDigest, ciRight.semanticDigest, "CI check order must not change semantic identity");
  assert.deepEqual(ciLeft.checks, ciRight.checks);
  assert.deepEqual(ciLeft.events, ciRight.events);

  const releaseOriginal = JSON.parse(await readFile(releaseFixture, "utf8"));
  const releaseReorderedFile = path.join(temporaryRoot, "release-reordered.json");
  await writeJson(releaseReorderedFile, { ...releaseOriginal, checks: [...releaseOriginal.checks].reverse() });
  const [releaseLeft, releaseRight] = await Promise.all([
    inspectReleaseManifest(releaseFixture, { root: fixtures }),
    inspectReleaseManifest(releaseReorderedFile, { root: fixtures })
  ]);
  assert.notEqual(releaseLeft.sourceDigest, releaseRight.sourceDigest, "reordered release bytes should differ at the raw source boundary");
  assert.equal(releaseLeft.semanticDigest, releaseRight.semanticDigest, "release check order must not change semantic identity");
  assert.deepEqual(releaseLeft.manifest, releaseRight.manifest);
}

async function checkDuplicateIds() {
  const ci = JSON.parse(await readFile(ciFixture, "utf8"));
  const duplicateCiFile = path.join(temporaryRoot, "ci-duplicate.json");
  await writeJson(duplicateCiFile, { ...ci, checks: [...ci.checks, structuredClone(ci.checks[0])] });
  await assert.rejects(inspectCiManifest(duplicateCiFile), /duplicate CI check id/i);

  const release = JSON.parse(await readFile(releaseFixture, "utf8"));
  const duplicateReleaseFile = path.join(temporaryRoot, "release-duplicate.json");
  await writeJson(duplicateReleaseFile, { ...release, checks: [...release.checks, structuredClone(release.checks[0])] });
  await assert.rejects(inspectReleaseManifest(duplicateReleaseFile, { root: fixtures }), /check id .* duplicated/i);
}

async function checkReleaseRevalidation() {
  const mutationRoot = path.join(temporaryRoot, "release-mutation");
  await mkdir(mutationRoot, { recursive: true });
  const mutationManifest = path.join(mutationRoot, "release-manifest.json");
  const mutationArtifact = path.join(mutationRoot, "release-artifact.txt");
  await cp(releaseFixture, mutationManifest);
  await cp(path.join(fixtures, "release-artifact.txt"), mutationArtifact);
  const inspection = await inspectReleaseManifest(mutationManifest, { root: mutationRoot });
  await writeFile(mutationArtifact, "mutated after bounded inspection\n", "utf8");
  await assert.rejects(inspection.revalidate(), /byteCount does not match|sha256 does not match/i, "release artifact mutation must fail commit-time revalidation");
}

async function checkReleaseMutationAtCliCommit() {
  const mutationRoot = path.join(temporaryRoot, "release-cli-mutation");
  await mkdir(mutationRoot, { recursive: true });
  const mutationManifest = path.join(mutationRoot, "release-manifest.json");
  const mutationArtifact = path.join(mutationRoot, "release-artifact.txt");
  const stateFile = path.join(mutationRoot, "state", "halba.sqlite");
  await cp(releaseFixture, mutationManifest);
  await cp(path.join(fixtures, "release-artifact.txt"), mutationArtifact);

  const result = await runImportAtCommitBarrier([
    "--adapter", "release",
    "--manifest", releaseRouting,
    "--source", mutationManifest,
    "--root", mutationRoot,
    "--state", stateFile
  ], async () => {
    await writeFile(mutationArtifact, "mutated between CLI plan and commit\n", "utf8");
  });

  assert.equal(result.barrierSeen, true, "release mutation proof must cross the real CLI plan-to-commit boundary");
  assert.notEqual(result.code, 0, `mutated release CLI unexpectedly succeeded:\n${result.stdout}`);
  assert.match(result.stderr, /byteCount does not match|sha256 does not match/i);
  const snapshot = sqliteSnapshot(stateFile);
  assert.equal(snapshot.workspace_documents.length, 0, "rejected release mutation must not commit workspace state");
  assert.equal(snapshot.import_receipts.length, 0, "rejected release mutation must not store a receipt");
  assert.equal(snapshot.workspace_import_events.length, 0, "rejected release mutation must not append import history");
  assert.equal(snapshot.trust_ledger.length, 0, "rejected release mutation must not append the verified ledger");
}

async function checkTraversalAndSymlinks() {
  const release = JSON.parse(await readFile(releaseFixture, "utf8"));
  const traversalFile = path.join(temporaryRoot, "release-traversal.json");
  const traversal = structuredClone(release);
  traversal.artifacts[0].path = "../outside.txt";
  await writeJson(traversalFile, traversal);
  await assert.rejects(inspectReleaseManifest(traversalFile, { root: fixtures }), /safe relative path/i);

  const symlinkRoot = path.join(temporaryRoot, "release-symlink");
  await mkdir(symlinkRoot, { recursive: true });
  const outsideFile = path.join(temporaryRoot, "outside-release-artifact.txt");
  const outsideBytes = Buffer.from("outside symlink target\n", "utf8");
  await writeFile(outsideFile, outsideBytes);
  await symlink(outsideFile, path.join(symlinkRoot, "linked-artifact.txt"));
  const symlinkManifest = structuredClone(release);
  symlinkManifest.artifacts = [{
    id: "linked-artifact",
    path: "linked-artifact.txt",
    sha256: sha256(outsideBytes),
    byteCount: outsideBytes.length
  }];
  const symlinkManifestFile = path.join(symlinkRoot, "release-manifest.json");
  await writeJson(symlinkManifestFile, symlinkManifest);
  await assert.rejects(inspectReleaseManifest(symlinkManifestFile, { root: symlinkRoot }), /regular non-symlink file/i);

  const ciLink = path.join(temporaryRoot, "ci-link.json");
  await symlink(ciFixture, ciLink);
  await assert.rejects(inspectCiManifest(ciLink), /regular non-symlink JSON file/i);
}

function runImport(args, { expectFailure = false } = {}) {
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", importCli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 8 * 1024 * 1024
  });
  if (expectFailure) {
    assert.notEqual(result.status, 0, `import unexpectedly succeeded:\n${result.stdout}`);
    return result;
  }
  assert.equal(result.status, 0, `import failed:\n${result.stderr || result.stdout}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    assert.fail(`import did not emit JSON:\n${result.stdout}\n${result.stderr}`);
  }
}

function runImportAtCommitBarrier(args, mutate) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", importCli, ...args], {
      cwd: root,
      env: { ...process.env, HALBA_TEST_IMPORT_COMMIT_BARRIER: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    let stdout = "";
    let stderr = "";
    let barrierSeen = false;
    let settled = false;
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", finishReject);
    child.on("message", async (message) => {
      if (message?.type !== "halba.test.import-plan-ready" || barrierSeen) return;
      barrierSeen = true;
      try {
        await mutate();
        child.send({ type: "halba.test.continue-import" });
      } catch (error) {
        child.kill();
        finishReject(error);
      }
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal, stdout, stderr, barrierSeen });
    });

    function finishReject(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }
  });
}

function sqliteSnapshot(stateFile) {
  const database = new DatabaseSync(stateFile, { readOnly: true });
  try {
    const tables = [
      "workspace_documents",
      "runs",
      "proof_bundles",
      "proof_bundle_revisions",
      "proof_sources",
      "proof_revision_sources",
      "import_receipts",
      "workspace_import_events",
      "trust_ledger",
      "review_decisions",
      "review_decision_events"
    ];
    return Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  } finally {
    database.close();
  }
}

async function stateFootprint(stateFile) {
  const result = {};
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${stateFile}${suffix}`;
    try {
      const bytes = await readFile(file);
      result[path.basename(file)] = { bytes: bytes.length, sha256: sha256(bytes) };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return result;
}

async function stateBytes(stateFile) {
  const chunks = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      chunks.push(await readFile(`${stateFile}${suffix}`));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertPrivacySentinelsAbsent(value, label) {
  for (const sentinel of privacySentinels) assert.equal(value.includes(sentinel), false, `${label} leaked ${sentinel}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
