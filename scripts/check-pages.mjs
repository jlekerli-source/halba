import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildPages } from "./build-pages.mjs";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-pages-"));

try {
  const result = await buildPages(temporaryRoot);
  const html = await readFile(path.join(temporaryRoot, "index.html"), "utf8");
  const packet = JSON.parse(await readFile(path.join(temporaryRoot, "static-demo.json"), "utf8"));
  const video = await readFile(path.join(temporaryRoot, "demo", "halba-demo.mp4"));
  const poster = await stat(path.join(temporaryRoot, "demo", "halba-demo-still.png"));

  assert.ok(html.includes('data-static-demo="true"'));
  assert.ok(html.includes('href="styles.css"'));
  assert.ok(html.includes('src="app.js"'));
  assert.equal(result.bundleId, "halba-build-week-demo");
  assert.equal(packet.bundle.sourceCount, 6);
  assert.equal(packet.proof.execution.mode, "recorded");
  assert.equal(packet.proof.findings.length, 6);
  assert.equal(Object.keys(packet.sources).length, 6);
  assert.ok(packet.sources["diffs/stale-review-clock.patch"].lines.includes("+  now = new Date()"));
  assert.ok(!JSON.stringify(packet).includes("/Users/"));
  assert.ok(video.length > 5_000_000, "demo video is unexpectedly small");
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  assert.ok(poster.size > 150_000, "demo poster is unexpectedly small");

  console.log("check passed: Pages preserves the six-source proof workflow and demo film");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
