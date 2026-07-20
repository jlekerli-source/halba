import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { openLocalStore } from "../src/storage/local-store.js";
import { buildScaleWorkspace } from "./scale-workspace-fixture.mjs";

const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-browser-scale-"));
const stateFile = path.join(temporaryRoot, "state.sqlite");
const profile = path.join(temporaryRoot, "chrome-profile");
const port = await availablePort();
let server;
let chromeProcess;

try {
  const store = await openLocalStore(stateFile);
  store.importWorkspace(buildScaleWorkspace(2000), {
    adapter: "browser-scale-v1",
    sourceRef: "synthetic-scale",
    sourceDigest: "b".repeat(64),
    importedAt: "2026-07-18T12:00:00.000Z",
    receiptId: "browser-scale-2000"
  });
  store.close();

  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    env: { ...process.env, HALBA_STATE_FILE: stateFile, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer(port, server);
  const debugPort = await availablePort();
  chromeProcess = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const browserWebSocket = await waitForDebugger(debugPort, chromeProcess);
  const cdp = await connectCdp(browserWebSocket);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  cdp.sessionId = sessionId;
  await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable")]);
  const startedAt = performance.now();
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/?view=run&workspaceId=scale-check` });
  await waitForSelector(cdp, ".workspace-limit");
  const elapsedMs = performance.now() - startedAt;
  const browserState = await evaluate(cdp, `({
    limit: document.querySelector('.workspace-limit')?.textContent || '',
    runButtons: document.querySelectorAll('[data-thread-id]').length,
    mainId: document.querySelector('main')?.id || '',
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  })`);
  assert.match(browserState.limit, /Showing the newest 100 of 2000 matching runs/);
  assert.equal(browserState.runButtons, 100, "browser DOM must remain bounded to 100 run index buttons");
  assert.equal(browserState.mainId, "main-content");
  assert.equal(browserState.overflow, false);
  assert.ok(elapsedMs < 5_000, `2,000-run browser render exceeded 5 seconds: ${elapsedMs.toFixed(1)}ms`);
  await cdp.send("Browser.close", {}, null);
  console.log(`browser check passed: 2,000-run state rendered a bounded 100-run DOM in ${elapsedMs.toFixed(1)}ms`);
} finally {
  if (chromeProcess?.exitCode === null) chromeProcess.kill("SIGTERM");
  if (server?.exitCode === null) server.kill("SIGTERM");
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function waitForDebugger(debugPort, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chrome DevTools did not start");
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (!message.id) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request?.reject(new Error(`${request.method}: ${message.error.message}`));
    else request?.resolve(message.result || {});
  });
  return {
    sessionId: null,
    send(method, params = {}, sessionOverride = undefined) {
      const id = ++sequence;
      const message = { id, method, params };
      const sessionId = sessionOverride === undefined ? this.sessionId : sessionOverride;
      if (sessionId) message.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        socket.send(JSON.stringify(message));
      });
    }
  };
}

async function waitForSelector(cdp, selector) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`browser did not render ${selector}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser evaluation failed");
  return result.result?.value;
}

async function availablePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Halba scale server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/workspaces`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Halba scale server did not start");
}
