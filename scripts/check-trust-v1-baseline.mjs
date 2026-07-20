import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(await readFile(path.join(root, "artifacts", "evals", "trust-operations-v1-baseline.json"), "utf8"));

assert.equal(baseline.schemaVersion, 1);
assert.equal(baseline.baseline, "halba-v1-pre-trust-operations");
assert.equal(baseline.source.commit, "d4a6417c1a562490787e5482191210043e32d71c");
assert.equal(baseline.source.tree, "4500c92e87ab5630d563344c10bb6c9c4b176372");
assert.equal(baseline.source.worktreeChangesIncluded, false);
assert.deepEqual(baseline.commands.map(({ command, exitCode }) => ({ command, exitCode })), [
  { command: "npm run check", exitCode: 0 },
  { command: "npm run smoke", exitCode: 0 },
  { command: "npm run eval", exitCode: 0 }
]);
assert.equal(baseline.checkedInEval.proofReplayDigest, "d93e5aebe74e7e997c62c1c97cbebddb8195a8a562d22c7b77cb11911281f2b9");
assert.equal(baseline.checkedInEval.proofVerdictAccuracy, 1);
assert.equal(baseline.checkedInEval.workspaceUnsafeAcceptanceRate, 0);
assert.equal(Object.values(baseline.capabilityBoundary).every((value) => value === false), true);

console.log(`check passed: exact v1 commit ${baseline.source.commit.slice(0, 8)} and tree ${baseline.source.tree.slice(0, 8)} are frozen outside the v2 worktree`);
