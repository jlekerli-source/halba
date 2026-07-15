import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { workspaceFromCodexProof } from "../src/importers/codex-proof.js";
import { loadProofBundle } from "../src/proof/bundle.js";
import { runProof } from "../src/proof/run.js";

const bundle = await loadProofBundle();
const proof = await runProof({ mode: "recorded" });
const imported = workspaceFromCodexProof(bundle, proof);
const checkedIn = JSON.parse(await readFile(new URL("../data/demo/workspace.json", import.meta.url), "utf8"));

assert.deepEqual(imported, checkedIn, "checked-in workspace must be reproducible from the public Codex proof run");
assert.equal(imported.threads[0].proofBundleId, bundle.definition.id);
assert.equal(imported.threads[0].claimCount, proof.findings.length);
assert.equal(imported.threads[0].reviewGateCount, proof.reviewRequiredCount);
assert.equal(imported.channels.length, 3);
assert.equal(imported.threads.length, 4);
assert.equal(imported.threads.filter((thread) => thread.proofState === "ready").length, 1);

assert.throws(() => workspaceFromCodexProof(bundle, { ...proof, bundle: { id: "wrong" } }), /does not match/);

console.log(`check passed: public Codex run deterministically imports ${imported.threads[0].events.length} proof events into a ${imported.threads.length}-run workspace`);
