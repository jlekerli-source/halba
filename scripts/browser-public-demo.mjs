import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const origin = argument("--origin") || "http://127.0.0.1:4177";
const outputRoot = path.resolve(argument("--out") || "artifacts/screenshots");
const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(path.join(os.tmpdir(), "halba-public-chrome-"));
const port = await availablePort();
let chromeProcess;
let cdp;

try {
  await mkdir(outputRoot, { recursive: true });
  chromeProcess = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeError = "";
  chromeProcess.stderr.on("data", (chunk) => { chromeError = `${chromeError}${chunk}`.slice(-12_000); });

  const browserWebSocket = await waitForDebugger(port, chromeProcess, () => chromeError);
  cdp = await connectCdp(browserWebSocket);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  cdp.sessionId = sessionId;
  const failures = [];
  const consoleProblems = [];
  cdp.on("Network.loadingFailed", (params) => failures.push(params.errorText));
  cdp.on("Runtime.exceptionThrown", (params) => consoleProblems.push(params.exceptionDetails?.text || "runtime exception"));
  cdp.on("Runtime.consoleAPICalled", (params) => {
    if (["error", "warning"].includes(params.type)) consoleProblems.push(`${params.type}: ${params.args.map((value) => value.value || value.description || "").join(" ")}`);
  });
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (["error", "warning"].includes(entry.level)) consoleProblems.push(`${entry.level}: ${entry.text}`);
  });
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Network.enable"),
    cdp.send("Log.enable"),
    cdp.send("Accessibility.enable")
  ]);

  await setViewport(cdp, 1440, 1000, false);
  await navigate(cdp, `${origin}/`, ".workspace-shell");
  const workspace = await evaluate(cdp, `({
    brand: document.querySelector('.brand small')?.textContent.trim() || '',
    process: [...document.querySelectorAll('[data-process-step]')].map((node) => node.textContent.trim()),
    runs: document.querySelectorAll('[data-thread-id]').length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  })`);
  assert.equal(workspace.brand, "Trust operations");
  assert.deepEqual(workspace.process, ["1Claim", "2Evidence + guard", "3Human decision"]);
  assert.equal(workspace.overflow, false);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await screenshot(cdp, path.join(outputRoot, "onboarding-desktop.png"));
  await screenshot(cdp, path.join(outputRoot, "workspace-desktop.jpg"));

  await setViewport(cdp, 390, 844, true);
  await navigate(cdp, `${origin}/`, ".workspace-shell");
  assert.equal(await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`), false);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await screenshot(cdp, path.join(outputRoot, "workspace-mobile.jpg"));

  await setViewport(cdp, 1440, 1000, false);
  await navigate(cdp, `${origin}/`, ".workspace-shell");
  const beforeExpectedLiveFailure = consoleProblems.length;
  await evaluate(cdp, `document.querySelector('[data-run-mode="live"]').click()`);
  await waitFor(cdp, `Boolean(document.querySelector('.error-state'))`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const liveProblems = consoleProblems.splice(beforeExpectedLiveFailure);
  assert.ok(liveProblems.length <= 1 && liveProblems.every((problem) => /Failed to load resource/.test(problem)), `unexpected live-error console output: ${liveProblems.join("; ")}`);
  assert.match(await evaluate(cdp, `document.querySelector('.error-state')?.textContent || ''`), /not configured/i);
  await screenshot(cdp, path.join(outputRoot, "live-unavailable-desktop.png"));

  await navigate(cdp, `${origin}/`, ".workspace-shell");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 800, downloadThroughput: -1, uploadThroughput: -1 });
  await evaluate(cdp, `document.querySelector('[data-run-mode="recorded"]').click()`);
  await waitFor(cdp, `Boolean(document.querySelector('.analysis-state'))`);
  await screenshot(cdp, path.join(outputRoot, "loading-desktop.png"));
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await waitFor(cdp, `Boolean(document.querySelector('.proof-shell'))`);
  assert.match(await evaluate(cdp, `document.querySelector('#execution-badge')?.textContent || ''`), /Recorded replay/);
  assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-claim-id]').length`), 4, "the public packet must open with four review-required claims");
  await evaluate(cdp, `document.querySelector('[data-claim-id="deployed"]').click()`);
  await waitFor(cdp, `document.querySelector('[data-claim-id="deployed"]')?.getAttribute('aria-pressed') === 'true'`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await screenshot(cdp, path.join(outputRoot, "proof-desktop.png"));

  await evaluate(cdp, `document.querySelector('[data-claim-id="live-gpt"]').click()`);
  await waitFor(cdp, `document.querySelector('[data-claim-id="live-gpt"]')?.getAttribute('aria-pressed') === 'true'`);
  await waitFor(cdp, `document.querySelector('#proof-panel-source')?.textContent.includes('mode')`);
  assert.match(await evaluate(cdp, `document.querySelector('#proof-panel-source')?.textContent || ''`), /recorded/i);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await screenshot(cdp, path.join(outputRoot, "proof-diff-desktop.png"));
  await screenshot(cdp, path.join(outputRoot, "workspace-proof-desktop.jpg"));

  await setViewport(cdp, 390, 844, true);
  await evaluate(cdp, `document.querySelector('#proof-tab-source').click()`);
  await waitFor(cdp, `document.querySelector('#proof-tab-source')?.getAttribute('aria-selected') === 'true'`);
  assert.equal(await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`), false);
  await screenshot(cdp, path.join(outputRoot, "proof-mobile-source.png"));

  await setViewport(cdp, 1440, 1000, false);
  await evaluate(cdp, `document.querySelector('#proof-tab-claims').click()`);
  for (let remaining = await openClaimCount(cdp); remaining > 0; remaining = await openClaimCount(cdp)) {
    await evaluate(cdp, `document.querySelector('[data-claim-id]')?.click()`);
    await waitFor(cdp, `Boolean(document.querySelector('[data-decision="resolved"]'))`);
    await evaluate(cdp, `document.querySelector('[data-decision="resolved"]').click()`);
    await waitFor(cdp, `document.querySelectorAll('[data-claim-id]').length < ${remaining}`);
  }
  assert.match(await evaluate(cdp, `document.querySelector('#proof-panel-claims')?.textContent || ''`), /Every review-required claim has a human decision/);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await screenshot(cdp, path.join(outputRoot, "review-resolved-desktop.png"));

  const accessibility = await cdp.send("Accessibility.getFullAXTree");
  const exposed = accessibility.nodes.filter((node) => !node.ignored);
  assert.ok(exposed.some((node) => node.role?.value === "main"), "public demo must expose a main landmark");
  assert.deepEqual(failures, [], `browser network failures: ${failures.join("; ")}`);
  assert.deepEqual(consoleProblems, [], `browser console problems: ${consoleProblems.join("; ")}`);
  await cdp.send("Browser.close", {}, null);
  console.log("public browser check passed: current workspace, loading, recoverable live error, source-backed Proof Mode, mobile source, resolved review, and clean runtime");
} finally {
  cdp?.close();
  if (chromeProcess?.exitCode === null) {
    chromeProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => chromeProcess.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_000))
    ]);
    if (chromeProcess.exitCode === null) {
      chromeProcess.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => chromeProcess.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 1_000))
      ]);
    }
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

process.exit(0);

async function openClaimCount(cdp) {
  return await evaluate(cdp, `document.querySelectorAll('[data-claim-id]').length`);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const selected = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return selected;
}

async function waitForDebugger(debugPort, child, errorText) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited with ${child.exitCode}: ${errorText()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome DevTools did not start: ${errorText()}`);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result || {});
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  return {
    sessionId: null,
    close() {
      socket.close();
    },
    send(method, params = {}, sessionId = undefined) {
      const id = ++nextId;
      const payload = { id, method, params };
      const effectiveSession = sessionId === null ? null : (sessionId || this.sessionId);
      if (effectiveSession) payload.sessionId = effectiveSession;
      socket.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on(method, listener) {
      listeners.set(method, [...(listeners.get(method) || []), listener]);
    }
  };
}

async function setViewport(cdp, width, height, mobile) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
}

async function navigate(cdp, url, selector) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
}

async function waitFor(cdp, expression, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `Boolean(${expression})`).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser evaluation failed");
  return result.result?.value;
}

async function screenshot(cdp, target) {
  const jpeg = /\.jpe?g$/i.test(target);
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: jpeg ? "jpeg" : "png",
    ...(jpeg ? { quality: 92 } : {}),
    captureBeyondViewport: false
  });
  await writeFile(target, Buffer.from(data, "base64"));
}
