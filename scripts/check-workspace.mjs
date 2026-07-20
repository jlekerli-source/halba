import assert from "node:assert/strict";

import { loadWorkspace, validateWorkspace } from "../src/domain/workspace.js";
import { runProof } from "../src/proof/run.js";
import { evidenceIdentity } from "../public/shared/review-contract.js";

const proof = await runProof({ mode: "recorded" });
const workspace = await loadWorkspace(undefined, { proofBundleId: proof.bundle.id });
const thread = workspace.threads[0];

assert.equal(thread.claimCount, proof.findings.length);
assert.equal(thread.reviewGateCount, proof.reviewRequiredCount);
assert.equal(thread.verdictCounts.supported, proof.counts.supported);
assert.equal(thread.verdictCounts.contradictory, proof.counts.contradictory);
assert.deepEqual(
  thread.reviewEvidence,
  Object.fromEntries(proof.findings.filter((finding) => finding.reviewRequired).map((finding) => [finding.claimId, evidenceIdentity(finding)]))
);
assert.equal(workspace.channels.length, 3);
assert.equal(workspace.agents.length, 3);
assert.equal(workspace.threads.length, 4);
assert.equal(workspace.threads.filter((item) => item.proofState === "ready").length, 1);
assert.equal(workspace.threads.filter((item) => item.proofState === "not_required").length, 3);

const invalid = structuredClone(workspace);
invalid.threads[0].events[0].type = "chat_message";
assert.throws(() => validateWorkspace(invalid), /unknown type/);

const duplicate = structuredClone(workspace);
duplicate.threads[0].events[1].id = duplicate.threads[0].events[0].id;
assert.throws(() => validateWorkspace(duplicate), /must be unique/);

console.log(`check passed: workspace routes ${workspace.threads.length} runs across ${workspace.channels.length} channels; ${thread.events.length} proof events feed ${thread.reviewGateCount} gates`);
