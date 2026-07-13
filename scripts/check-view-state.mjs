import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evidenceSelection, findSavedEvidence, findSavedNotice, normalizeSavedView, noticeSelection, snapshotView } from "../src/domain/view-state.js";

const feed = JSON.parse(await readFile(new URL("../data/seed.json", import.meta.url), "utf8"));
const post = feed.posts.find((item) => item.evidence.length >= 2);
const row = { post, evidence: post.evidence[1], evidenceIndex: 1 };
const qa = feed.qa[0];

assert.deepEqual(evidenceSelection(post.id, 1), { type: "evidence", postId: post.id, evidenceIndex: 1 });
assert.equal(findSavedEvidence([row], evidenceSelection(post.id, 1)), row);
assert.equal(findSavedEvidence([row], evidenceSelection(post.id, 0)), null);
assert.equal(findSavedNotice(feed, noticeSelection("Import QA", qa)), qa);
assert.deepEqual(snapshotView({
  lane: "EXECUTE",
  kind: "metric",
  query: "release",
  selectedProjectId: null,
  selectedEvidence: { post, evidence: post.evidence[1], evidenceIndex: 1 }
}).selection, evidenceSelection(post.id, 1));

const normalized = normalizeSavedView(feed, {
  lane: "MISSING",
  kind: "bad",
  query: "x".repeat(250),
  selectedProjectId: "missing",
  selection: { type: "evidence", postId: "missing", evidenceIndex: 0 }
});

assert.equal(normalized.lane, "all");
assert.equal(normalized.kind, "all");
assert.equal(normalized.query.length, 200);
assert.equal(normalized.selectedProjectId, null);
assert.equal(normalized.selection, null);

console.log("check passed: view state restore helpers work");
