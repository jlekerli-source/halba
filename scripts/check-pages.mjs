import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildPages } from "./build-pages.mjs";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-pages-"));

try {
  const result = await buildPages(temporaryRoot);
  const html = await readFile(path.join(temporaryRoot, "index.html"), "utf8");
  const app = await readFile(path.join(temporaryRoot, "app.js"), "utf8");
  const workspaceImport = await readFile(path.join(temporaryRoot, "workspace-import.js"), "utf8");
  const workspaceState = await readFile(path.join(temporaryRoot, "workspace-state.js"), "utf8");
  const packet = JSON.parse(await readFile(path.join(temporaryRoot, "static-demo.json"), "utf8"));
  const video = await readFile(path.join(temporaryRoot, "demo", "halba-demo.mp4"));
  const poster = await stat(path.join(temporaryRoot, "demo", "halba-demo-still.png"));
  const thumbnail = await readFile(path.join(temporaryRoot, "demo", "devpost-thumbnail.png"));

  assert.ok(html.includes('data-static-demo="true"'));
  assert.ok(html.includes('href="styles.css"'));
  assert.ok(html.includes('src="app.js"'));
  assert.ok(app.includes('download="halba-proof-review.md"'));
  assert.ok(app.includes("citation.sourceSha256"));
  assert.ok(app.includes("encodeURIComponent(proofReceipt())"));
  assert.ok(app.includes('class="workspace-shell"'));
  assert.ok(app.includes("Open Proof Mode"));
  assert.ok(app.includes("Back to #"));
  assert.ok(app.includes('data-decision="more-proof"'));
  assert.ok(app.includes("Decision time:"));
  assert.ok(app.includes("workspaceAttentionCount"));
  assert.ok(app.includes('data-workspace-scope="'));
  assert.ok(app.includes('data-workspace-search'));
  assert.ok(app.includes('data-import-workspace'));
  assert.ok(workspaceImport.includes("export function validateImportedWorkspace"));
  assert.ok(workspaceState.includes("export function decisionClosesGate"));
  assert.equal(result.bundleId, "halba-build-week-demo");
  assert.equal(packet.workspace.channels.length, 3);
  assert.equal(packet.workspace.agents.length, 3);
  assert.equal(packet.workspace.threads.length, 4);
  const proofThread = packet.workspace.threads.find((thread) => thread.proofBundleId === packet.bundle.id);
  assert.equal(proofThread.proofState, "ready");
  assert.equal(proofThread.reviewGateCount, packet.proof.reviewRequiredCount);
  assert.equal(proofThread.reviewClaimIds.length, packet.proof.reviewRequiredCount);
  assert.equal(proofThread.events.length, 4);
  assert.ok(packet.workspace.threads.some((thread) => thread.channelId === "release-readiness"));
  assert.ok(packet.workspace.threads.some((thread) => thread.channelId === "agent-adapters"));
  assert.equal(packet.bundle.sourceCount, 6);
  assert.equal(packet.proof.execution.mode, "recorded");
  assert.equal(packet.proof.findings.length, 6);
  assert.equal(Object.keys(packet.sources).length, 6);
  assert.ok(packet.sources["diffs/stale-review-clock.patch"].lines.includes("+  now = new Date()"));
  assert.ok(!JSON.stringify(packet).includes("/Users/"));
  assert.ok(video.length > 5_000_000, "demo video is unexpectedly small");
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  assert.ok(poster.size > 150_000, "demo poster is unexpectedly small");
  assert.ok(thumbnail.length > 150_000, "Devpost thumbnail is unexpectedly small");
  assert.equal(thumbnail.subarray(1, 4).toString("ascii"), "PNG");

  console.log("check passed: Pages preserves the six-source proof workflow, film, and Devpost thumbnail");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
