import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-trust-pack-cli-"));
const state = path.join(temporaryRoot, "state.sqlite");
const pack = path.join(temporaryRoot, "operator-lab.trust-pack.json");
const tampered = path.join(temporaryRoot, "tampered.trust-pack.json");

try {
  run("scripts/import-run.mjs", [
    "--adapter", "codex",
    "--manifest", "data/import-fixtures/codex-run.json",
    "--source", "data/import-fixtures/codex-session-clean.jsonl",
    "--bundle", "data/import-fixtures/codex-proof/bundle.json",
    "--proof-output", "data/import-fixtures/codex-proof/proof-output.json",
    "--state", state
  ]);
  const exported = run("scripts/trust-pack.mjs", ["export", "--state", state, "--workspace", "operator-lab", "--output", pack]);
  assert.equal(exported.ok, true);
  assert.equal(exported.identityAuthenticity, false);
  assert.equal(exported.proofSources, 3);
  assert.equal((await stat(pack)).mode & 0o777, 0o600, "exported trust packs must be private operator files");
  const verified = run("scripts/trust-pack.mjs", ["verify", "--input", pack]);
  assert.equal(verified.packDigest, exported.packDigest);
  assert.equal(verified.ledgerHeadHash, exported.ledgerHeadHash);

  const existing = runFailure("scripts/trust-pack.mjs", ["export", "--state", state, "--workspace", "operator-lab", "--output", pack]);
  assert.match(existing.stderr, /already exists/);
  const overwritten = run("scripts/trust-pack.mjs", ["export", "--state", state, "--workspace", "operator-lab", "--output", pack, "--overwrite"]);
  assert.equal(overwritten.packDigest, exported.packDigest, "unchanged state must export the same canonical pack");

  const changed = JSON.parse(await readFile(pack, "utf8"));
  changed.proofRecords[0].sources[0].bytesBase64 = `${changed.proofRecords[0].sources[0].bytesBase64.slice(0, -4)}AAAA`;
  await writeFile(tampered, `${JSON.stringify(changed)}\n`, { mode: 0o600 });
  const rejected = runFailure("scripts/trust-pack.mjs", ["verify", "--input", tampered]);
  assert.match(rejected.stderr, /source byte count mismatch|source hash mismatch|section digest mismatch|full pack digest mismatch/);

  console.log("check passed: local state exports a private portable trust pack whose ledger and exact proof bytes verify independently and reject mutation");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(script, args) {
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runFailure(script, args) {
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });
  assert.notEqual(result.status, 0, "command unexpectedly succeeded");
  return result;
}
