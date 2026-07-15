import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { validateImportedWorkspace } from "../public/workspace-import.js";
import { decisionClosesGate, shouldAdvanceReviewSelection } from "../public/workspace-state.js";

const workspace = JSON.parse(await readFile(new URL("../data/demo/workspace.json", import.meta.url), "utf8"));
assert.equal(validateImportedWorkspace(structuredClone(workspace)).threads.length, 4);

const unknownAgent = structuredClone(workspace);
unknownAgent.threads[0].agentId = "missing-agent";
assert.throws(() => validateImportedWorkspace(unknownAgent), /unknown channel or agent/);

const mismatchedClaims = structuredClone(workspace);
mismatchedClaims.threads[0].claimCount += 1;
assert.throws(() => validateImportedWorkspace(mismatchedClaims), /verdicts do not match/);

const unsafeEvent = structuredClone(workspace);
unsafeEvent.threads[0].events[0].id = "../../private";
assert.throws(() => validateImportedWorkspace(unsafeEvent), /safe slugs/);

assert.equal(decisionClosesGate({ status: "approved" }), true);
assert.equal(decisionClosesGate({ status: "rejected" }), true);
assert.equal(decisionClosesGate({ status: "resolved" }), true);
assert.equal(decisionClosesGate({ status: "more-proof" }), false);
assert.equal(shouldAdvanceReviewSelection("more-proof"), false, "requesting proof must keep the current gate selected");
assert.equal(shouldAdvanceReviewSelection("approved"), true, "closing a gate should advance the review queue");

console.log("check passed: browser-local workspace import rejects unsafe boundaries and preserves open request-proof gates");
