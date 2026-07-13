import assert from "node:assert/strict";
import path from "node:path";

export const evidenceKinds = new Set(["handoff", "metric", "review", "status"]);
export const evidenceStatuses = new Set(["AMBER", "GRAY", "GREEN", "IMPORTED", "VERIFIED"]);
export const focusKinds = new Set(["contradiction", "stop"]);
export const healthStates = new Set(["AMBER", "GRAY", "GREEN", "RED", "UNKNOWN"]);
export const lanes = new Set(["AUTOMATED_VALIDATE", "EXECUTE", "MAINTAIN", "PARK"]);
export const qaSeverities = new Set(["amber", "red"]);
export const requiredProjectIds = [];

export function assertUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `duplicate ${label}`);
}

export function assertSafeSourcePath(value, label) {
  const [filePath] = String(value || "").split("#");
  const parts = filePath.split(/[\\/]+/);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(filePath);
  assert.ok(
    filePath
      && !path.isAbsolute(filePath)
      && !path.win32.isAbsolute(filePath)
      && !hasScheme
      && !parts.includes(".."),
    `unsafe source path for ${label}`
  );
}

export function validFeedDate(value) {
  return Boolean(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

export function assertSourcePathGuard() {
  for (const unsafePath of ["/tmp/proof.md", "C:\\tmp\\proof.md", "../proof.md", "https://example.test/proof.md", "file:proof.md"]) {
    assert.throws(() => assertSafeSourcePath(unsafePath, "self-check"), /unsafe source path/);
  }
}

export function assertFeedContract(feed, { expectedSource, requiredProjectIds: expectedProjectIds = requiredProjectIds } = {}) {
  assertSourcePathGuard();

  assert.ok(feed.generatedAt, "missing generatedAt");
  if (expectedSource) {
    assert.equal(feed.source, expectedSource, "invalid feed source");
  } else {
    assert.ok(feed.source, "missing source");
  }
  assert.ok(validFeedDate(feed.generatedAt), "invalid generatedAt date");
  assert.ok(feed.projects.length >= 1, "missing projects");
  assert.ok(feed.posts.length >= 1, "missing posts");
  assert.ok(Array.isArray(feed.focus), "missing focus items");
  assert.ok(Array.isArray(feed.qa), "missing qa items");
  assert.ok(feed.projects.every((project) => project.id && project.name && project.lane && project.health && project.claim));
  assert.ok(feed.projects.every((project) => lanes.has(project.lane)), "unknown project lane");
  assert.ok(feed.projects.every((project) => healthStates.has(project.health)), "unknown project health");
  assert.ok(feed.projects.every((project) => project.lastProofDate && Number.isFinite(Number(project.proofWindowDays))));
  assert.ok(feed.projects.every((project) => validFeedDate(project.lastProofDate)), "invalid project proof date");
  assert.ok(feed.projects.every((project) => Number(project.proofWindowDays) > 0), "invalid project proof window");
  assert.ok(feed.posts.every((post) => post.id && post.projectId && post.title && post.author && post.createdAt && post.body), "malformed post");
  assert.ok(feed.posts.every((post) => !Number.isNaN(new Date(post.createdAt).getTime())), "invalid post date");
  assert.ok(feed.posts.every((post) => post.evidence?.length >= 1), "post is missing evidence");
  assert.ok(feed.posts.every((post) => post.evidence.every((evidence) => evidence.kind && evidence.label && evidence.path && evidence.status)), "malformed evidence");
  assert.ok(feed.posts.every((post) => post.evidence.every((evidence) => evidenceKinds.has(evidence.kind))), "unknown evidence kind");
  assert.ok(feed.posts.every((post) => post.evidence.every((evidence) => evidenceStatuses.has(evidence.status))), "unknown evidence status");
  assert.ok(feed.posts.every((post) => Array.isArray(post.replies)), "missing replies array");
  assert.ok(feed.posts.every((post) => post.replies.every((reply) => reply.id && reply.author && reply.createdAt && reply.body)), "malformed reply");
  assert.ok(feed.posts.every((post) => post.replies.every((reply) => !Number.isNaN(new Date(reply.createdAt).getTime()))), "invalid reply date");
  assert.ok(feed.posts.some((post) => post.replies.length >= 1), "missing nested replies");

  const projectIds = new Set(feed.projects.map((project) => project.id));
  const postProjectIds = new Set(feed.posts.map((post) => post.projectId));
  assertUnique(feed.projects.map((project) => project.id), "project id");
  assertUnique(feed.posts.map((post) => post.id), "post id");
  for (const post of feed.posts) {
    assertUnique(post.replies.map((reply) => reply.id), `reply id in ${post.id}`);
  }
  assert.ok(expectedProjectIds.every((id) => projectIds.has(id)), "missing required project");
  assert.ok(feed.posts.every((post) => projectIds.has(post.projectId)));
  assert.ok(feed.projects.every((project) => postProjectIds.has(project.id)), "project missing evidence posts");
  assert.ok(feed.focus.every((item) => projectIds.has(item.projectId) && item.kind && item.text && item.path), "malformed focus item");
  assert.ok(feed.focus.every((item) => focusKinds.has(item.kind)), "unknown focus kind");
  assert.ok(feed.qa.every((item) => projectIds.has(item.projectId) && item.severity && item.kind && item.text), "malformed QA item");
  assert.ok(feed.qa.every((item) => qaSeverities.has(item.severity)), "unknown QA severity");
  assert.equal(feed.qa.filter((item) => item.severity === "red").length, 0, "red QA issues must be resolved before the feed is healthy");
  assert.ok(feed.projects.every((project) => project.statusFile || project.review?.sourcePath), "project is missing a source path");

  for (const project of feed.projects) {
    if (project.statusFile) assertSafeSourcePath(project.statusFile, `project ${project.id}`);
    if (project.review?.sourcePath) assertSafeSourcePath(project.review.sourcePath, `review ${project.id}`);
  }
  for (const post of feed.posts) {
    for (const evidence of post.evidence) {
      assertSafeSourcePath(evidence.path, `evidence ${post.id}`);
    }
  }
  for (const item of feed.focus) {
    assertSafeSourcePath(item.path, `focus ${item.projectId}`);
  }
  for (const item of feed.qa) {
    if (item.path) assertSafeSourcePath(item.path, `qa ${item.projectId}`);
  }
}
