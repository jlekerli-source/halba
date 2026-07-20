import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 4279;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["src/server.js"], {
  env: { ...process.env, OPENAI_API_KEY: "", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});
const stderr = [];
server.stderr.on("data", (chunk) => stderr.push(String(chunk)));

try {
  await waitForServer();

  const htmlResponse = await fetch(`${origin}/`);
  const html = await htmlResponse.text();
  const css = await fetch(`${origin}/styles.css`).then((response) => response.text());
  const app = await fetch(`${origin}/app.js`).then((response) => response.text());
  for (const marker of [
    "Halba — Trust Operations",
    'id="status-region"',
    'data-run-mode="live"',
    'data-run-mode="recorded"',
    'id="mobile-tabs"',
    'data-mobile-view="summary"'
  ]) assert.ok(html.includes(marker), `missing Proof Mode shell marker ${marker}`);
  assert.ok(css.includes(".proof-shell"));
  assert.ok(css.includes(".workspace-shell"));
  assert.ok(css.includes('body[data-mobile-view="source"]'));
  assert.ok(css.includes("prefers-reduced-motion: reduce"));
  assert.ok(!css.includes("transition: all"));
  assert.ok(app.includes('fetch("/api/proof/run"'));
  assert.ok(app.includes('fetch("static-demo.json")'));
  assert.ok(app.includes('document.documentElement.dataset.staticDemo === "true"'));
  assert.ok(app.includes("Agent says “done.”"));
  assert.ok(app.includes("Halba asks for proof."));
  assert.ok(app.includes("Open Proof Mode"));
  assert.ok(app.includes('data-decision="more-proof"'));
  assert.ok(app.includes("Decision time:"));
  assert.ok(app.includes("halba:proof-decisions:v2"));
  assert.ok(app.includes("reviewDecisionMatches"));
  assert.ok(app.includes("halba:workspace-ui:v1"));
  assert.ok(app.includes("validateImportedWorkspace"));
  assert.ok(app.includes('data-workspace-filter="'));
  assert.ok(app.includes("function escapeHtml"));

  const bundleResponse = await fetch(`${origin}/api/proof/bundle`);
  const bundle = await bundleResponse.json();
  assert.equal(bundleResponse.status, 200);
  assert.equal(bundle.id, "halba-build-week-demo");
  assert.equal(bundle.sourceCount, 6);
  assert.ok(bundle.sources.some((source) => source.kind === "diff" && source.path === "diffs/stale-review-clock.patch"));
  assert.ok(bundle.sources.every((source) => source.sha256.length === 64));

  const workspaceResponse = await fetch(`${origin}/api/workspace`);
  const workspace = await workspaceResponse.json();
  assert.equal(workspaceResponse.status, 200);
  assert.equal(workspace.channels[0].id, "halba-build-week");
  assert.equal(workspace.threads[0].proofBundleId, bundle.id);
  assert.equal(workspace.threads[0].events.length, 4);
  assert.equal(workspace.channels.length, 3);
  assert.equal(workspace.threads.length, 4);

  const proofResponse = await postJson("/api/proof/run", { mode: "recorded" });
  const proof = await proofResponse.json();
  assert.equal(proofResponse.status, 200);
  assert.equal(proof.execution.mode, "recorded");
  assert.equal(proof.execution.model, "gpt-5.6-sol");
  assert.equal(proof.findings.length, 6);
  assert.equal(proof.reviewRequiredCount, 4);

  const citation = proof.findings.find((finding) => finding.claimId === "stale-gate").citations[0];
  const sourceResponse = await fetch(`${origin}/api/proof/source?path=${encodeURIComponent(citation.path)}&startLine=${citation.startLine}&endLine=${citation.endLine}`);
  const source = await sourceResponse.json();
  assert.equal(sourceResponse.status, 200);
  assert.equal(source.startLine, 7);
  assert.equal(source.endLine, 16);
  assert.ok(source.text.startsWith("-export function reviewGateSummary"));

  assert.equal((await fetch(`${origin}/api/proof/source?path=../bundle.json`)).status, 404);
  assert.equal((await fetch(`${origin}/api/proof/source?path=${encodeURIComponent(citation.path)}&startLine=0&endLine=4`)).status, 400);
  assert.equal((await fetch(`${origin}/api/feed`)).status, 404, "legacy proof-feed API must be opt-in");
  assert.equal((await fetch(`${origin}/domain/feed.js`)).status, 404, "legacy proof-feed modules must be opt-in");

  const invalidMode = await postJson("/api/proof/run", { mode: "unknown" });
  assert.equal(invalidMode.status, 400);
  assert.equal((await invalidMode.json()).error, "invalid_mode");

  const liveUnavailable = await postJson("/api/proof/run", { mode: "live" });
  assert.equal(liveUnavailable.status, 503);
  assert.equal((await liveUnavailable.json()).error, "live_unavailable");

  const wrongType = await fetch(`${origin}/api/proof/run`, { method: "POST", body: "{}" });
  assert.equal(wrongType.status, 415);

  console.log("check passed: agent workspace routes a typed run into Proof Mode, exact source, and guarded errors");
} finally {
  const exited = server.exitCode === null ? new Promise((resolve) => server.once("exit", resolve)) : Promise.resolve();
  server.kill();
  await exited;
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(stderr.join("") || `server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/proof/bundle`, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(stderr.join("") || "proof server did not become ready");
}

function postJson(pathname, body) {
  return fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
