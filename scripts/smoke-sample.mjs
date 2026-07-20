import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { assertFeedContract } from "./feed-validation.mjs";

const port = 4278;
const origin = `http://127.0.0.1:${port}`;
const sampleProjectIds = ["sample-research", "sample-build"];
const server = spawn(process.execPath, ["src/server.js"], {
  env: { ...process.env, HALBA_ENABLE_LEGACY_FEED: "1", HALBA_FEED: "sample", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});
const stderr = [];

server.stderr.on("data", (chunk) => stderr.push(String(chunk)));

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(stderr.join("") || `server exited with ${server.exitCode}`);
    }
    try {
      const response = await fetch(`${origin}/api/feed`, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(stderr.join("") || "sample server did not become ready");
}

try {
  await waitForServer();
  const feed = await fetch(`${origin}/api/feed`).then((response) => response.json());
  const importDelta = await fetch(`${origin}/api/import-delta`).then((response) => response.json());
  const research = await fetch(`${origin}/api/source?path=sample/research.md`).then((response) => response.json());
  const stop = await fetch(`${origin}/api/source?path=${encodeURIComponent("sample/build.md#stop")}`).then((response) => response.json());
  const forbidden = await fetch(`${origin}/api/source?path=../seed.json`);

  assertFeedContract(feed, { expectedSource: "Sample", requiredProjectIds: sampleProjectIds });
  assert.equal(importDelta.delta.status, "no runs");
  assert.ok(!importDelta.text.includes("le-brain"));
  assert.ok(research.text.includes("# Sample Research"));
  assert.ok(research.lineCount > 0);
  assert.ok(stop.text.startsWith("## Stop"));
  assert.ok(stop.lineCount > 0);
  assert.equal(forbidden.status, 403);
  console.log("check passed: sample server smoke works");
} finally {
  const exited = server.exitCode === null ? new Promise((resolve) => server.once("exit", resolve)) : Promise.resolve();
  server.kill();
  await exited;
}
