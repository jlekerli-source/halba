import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const origin = argument("--origin") || "http://127.0.0.1:4178";
const outputRoot = path.resolve(argument("--out") || "artifacts/screenshots");
const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(path.join(os.tmpdir(), "halba-trust-chrome-"));
const port = await availablePort();
let chromeProcess;

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
  const cdp = await connectCdp(browserWebSocket);
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

  const inboxUrl = `${origin}/?view=trust&item=${encodeURIComponent("claim:alpha:alpha-contradiction")}&at=${encodeURIComponent("2026-08-01T12:00:00.000Z")}`;
  await setViewport(cdp, 1440, 1000, false);
  const desktopLoadMs = await navigate(cdp, inboxUrl, ".trust-item");
  const desktop = await evaluate(cdp, `(() => {
    const items = [...document.querySelectorAll('[data-trust-item]')];
    const links = [...document.querySelectorAll('[data-trust-link]')];
    return {
      title: document.querySelector('.trust-head h1')?.textContent,
      itemIds: items.map((item) => item.dataset.trustItem),
      activeItem: document.activeElement?.closest?.('[data-trust-item]')?.dataset?.trustItem || null,
      topText: items[0]?.textContent || '',
      topHref: links[0]?.href || '',
      workspaceSummary: document.querySelector('.trust-summary h2')?.textContent || '',
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      mainCount: document.querySelectorAll('main').length,
      unnamedLinks: links.filter((link) => !link.getAttribute('aria-label') && !link.textContent.trim()).length,
      shortTargets: links.filter((link) => { const box = link.getBoundingClientRect(); return box.width < 40 || box.height < 40; }).length,
      duplicateIds: [...document.querySelectorAll('[id]')].filter((node, index, all) => all.findIndex((item) => item.id === node.id) !== index).length,
      positiveTabindex: document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])').length,
      unnamedControls: [...document.querySelectorAll('button, a[href], input, select, summary')].filter((node) => getComputedStyle(node).display !== 'none' && !(node.getAttribute('aria-label') || node.textContent.trim() || node.getAttribute('title'))).map((node) => node.outerHTML.slice(0, 240)),
      nestedInteractive: [...document.querySelectorAll('a[href], button, input, select, summary')].filter((node) => node.querySelector('a[href], button, input, select, summary')).length,
      mainId: document.querySelector('main')?.id || '',
      skipTarget: document.querySelector('.skip-link')?.getAttribute('href') || '',
      headingLevels: [...document.querySelectorAll('main h1, main h2, main h3')].map((node) => Number(node.tagName.slice(1)))
    };
  })()`);
  assert.equal(desktop.title, "Trust Inbox");
  assert.equal(desktop.itemIds.length, 11);
  assert.deepEqual(desktop.itemIds.slice(0, 3), [
    "claim:alpha:alpha-contradiction",
    "claim:gamma:gamma-release-new",
    "claim:beta:beta-unsupported"
  ]);
  assert.equal(desktop.activeItem, "claim:alpha:alpha-contradiction");
  assert.match(desktop.topText, /critical/i);
  assert.match(desktop.topText, /Contradiction/);
  assert.match(desktop.topText, /deterministic/);
  assert.match(desktop.workspaceSummary, /3 local workspaces/);
  assert.equal(desktop.overflow, false);
  assert.equal(desktop.mainCount, 1);
  assert.equal(desktop.unnamedLinks, 0);
  assert.equal(desktop.shortTargets, 0);
  assert.equal(desktop.duplicateIds, 0);
  assert.equal(desktop.positiveTabindex, 0);
  assert.deepEqual(desktop.unnamedControls, [], `unnamed controls: ${desktop.unnamedControls.join("; ")}`);
  assert.equal(desktop.nestedInteractive, 0);
  assert.equal(desktop.mainId, "main-content");
  assert.equal(desktop.skipTarget, "#main-content");
  assert.equal(desktop.headingLevels[0], 1);
  assert.ok(desktopLoadMs < 5_000, `Trust Inbox rendered too slowly: ${desktopLoadMs}ms`);
  assert.equal(await evaluate(cdp, `document.querySelector('#status-region')?.getAttribute('aria-live')`), "polite", "dynamic Trust Inbox changes need a polite live region");
  const accessibility = await cdp.send("Accessibility.getFullAXTree");
  const exposed = accessibility.nodes.filter((node) => !node.ignored);
  const interactiveWithoutName = exposed.filter((node) => ["button", "link"].includes(node.role?.value) && !node.name?.value);
  assert.equal(interactiveWithoutName.length, 0, "all exposed buttons and links need accessible names");
  assert.ok(exposed.some((node) => node.role?.value === "main"), "accessibility tree must expose the main landmark");
  assert.ok(exposed.some((node) => node.role?.value === "heading" && node.name?.value === "Trust Inbox"), "accessibility tree must expose the Trust Inbox heading");
  await screenshot(cdp, path.join(outputRoot, "trust-inbox-desktop.png"));

  const keyboardEntryUrl = `${origin}/?view=trust&at=${encodeURIComponent("2026-08-01T12:00:00.000Z")}`;
  await navigate(cdp, keyboardEntryUrl, ".trust-item");
  await pressTab(cdp);
  assert.equal(await evaluate(cdp, `document.activeElement?.classList.contains('skip-link')`), true, "the skip link must be the first keyboard stop");
  await pressEnter(cdp);
  await waitFor(cdp, `document.activeElement?.id === 'main-content'`);
  assert.equal(await evaluate(cdp, `document.activeElement?.id`), "main-content", "skip navigation must move focus to the main landmark");

  await navigate(cdp, inboxUrl, ".trust-item");

  await evaluate(cdp, `document.querySelectorAll('[data-trust-link]')[0].focus()`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown" });
  assert.equal(await evaluate(cdp, `[...document.querySelectorAll('[data-trust-link]')].indexOf(document.activeElement)`), 1, "ArrowDown must advance through ranked trust links");

  await evaluate(cdp, `document.querySelector('[data-mark-trust-reviewed]').focus()`);
  await pressEnter(cdp);
  await waitFor(cdp, `document.querySelector('.trust-head-score small')?.textContent.includes('0 subject')`);
  assert.equal(await evaluate(cdp, `localStorage.getItem('halba:trust-checkpoint:v1')`), "2026-08-01T12:00:00.000Z", "checkpoint must persist the evaluated inbox time");
  await evaluate(cdp, `document.querySelector('[data-trust-filter="new"]').click()`);
  await waitFor(cdp, `document.querySelectorAll('[data-trust-item]').length === 0`);
  assert.match(await evaluate(cdp, `document.querySelector('.trust-empty')?.textContent || ''`), /No items match this view/);

  await navigate(cdp, inboxUrl, ".trust-item");
  const checkpointReload = await evaluate(cdp, `({
    changed: document.querySelector('.trust-head-score small')?.textContent || '',
    checkpoint: document.querySelector('.trust-checkpoint p')?.textContent || ''
  })`);
  assert.match(checkpointReload.changed, /0 subject changes/);
  assert.match(checkpointReload.checkpoint, /Subjects updated after/);

  const staleUrl = new URL(desktop.topHref);
  staleUrl.searchParams.set("item", "claim:missing:stale-route");
  await navigate(cdp, staleUrl.href, ".error-state");
  assert.match(await evaluate(cdp, `document.querySelector('.error-state')?.textContent || ''`), /no longer present in the current Trust Inbox/i, "stale deep links must fail closed");
  assert.equal(await evaluate(cdp, `document.querySelector('.error-state')?.getAttribute('role')`), "alert", "stale-target errors must be announced assertively");

  await navigate(cdp, inboxUrl, ".trust-item");
  const receiptHref = await evaluate(cdp, `document.querySelector('[data-trust-item="import:alpha:codex-session-v1"] [data-trust-link]')?.href || ''`);
  assert.ok(receiptHref, "degraded import item must expose an exact receipt route");
  await evaluate(cdp, `document.querySelector('[data-trust-item="import:alpha:codex-session-v1"] [data-trust-link]').focus()`);
  await pressEnter(cdp);
  await waitFor(cdp, `Boolean(document.querySelector('.receipt-panel'))`);
  const receipt = await evaluate(cdp, `({
    id: document.querySelector('[data-import-receipt]')?.dataset.importReceipt || '',
    text: document.querySelector('main')?.textContent || '',
    privacy: document.querySelector('.operator-boundary')?.textContent || '',
    back: document.querySelector('.workspace-back')?.textContent.trim() || '',
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  })`);
  assert.equal(receipt.id, "alpha-import");
  assert.match(receipt.text, /codex-session-v1/);
  assert.match(receipt.text, /degraded/i);
  assert.match(receipt.text, /synthetic degraded import/);
  assert.match(receipt.text, /Source digest/);
  assert.match(receipt.text, /Source observed/);
  assert.match(receipt.text, /Committed locally/);
  assert.match(receipt.privacy, /basenames/i);
  assert.match(receipt.privacy, /raw transcripts/i);
  assert.match(receipt.back, /Back to Trust Inbox/);
  assert.equal(receipt.overflow, false);
  await screenshot(cdp, path.join(outputRoot, "trust-inbox-receipt.png"));

  await evaluate(cdp, `document.querySelector('.workspace-back').focus()`);
  await pressEnter(cdp);
  await waitFor(cdp, `Boolean(document.querySelector('[data-trust-item="claim:alpha:alpha-contradiction"]'))`);
  await evaluate(cdp, `document.querySelector('[data-trust-item="claim:alpha:alpha-contradiction"] [data-trust-link]').focus()`);
  await pressEnter(cdp);
  await waitFor(cdp, `Boolean(document.querySelector('.proof-shell'))`);
  const proof = await evaluate(cdp, `({
    phase: document.body.dataset.phase,
    selectedClaim: document.querySelector('[data-claim-id][aria-pressed="true"]')?.dataset.claimId || null,
    backLabel: document.querySelector('.workspace-back')?.textContent.trim() || '',
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  })`);
  assert.equal(proof.phase, "proof");
  assert.equal(proof.selectedClaim, "claim");
  assert.match(proof.backLabel, /Back to Trust Inbox/);
  assert.equal(proof.overflow, false);
  await screenshot(cdp, path.join(outputRoot, "trust-inbox-proof.png"));

  await evaluate(cdp, `(() => {
    const note = document.querySelector('#review-note');
    note.value = 'Browser proof: request exact follow-up evidence.';
    document.querySelector('[data-decision="more-proof"][data-claim="claim"]').focus();
  })()`);
  await pressEnter(cdp);
  await waitFor(cdp, `fetch('/api/recent-decisions?limit=100').then((response) => response.json()).then((body) => body.items.some((item) => item.threadId === 'alpha-contradiction' && item.status === 'more-proof' && item.current))`);
  await waitFor(cdp, `document.querySelector('#status-region')?.textContent.includes('11 ranked')`);
  await evaluate(cdp, `(() => {
    const note = document.querySelector('#review-note');
    note.value = 'Browser proof: contradiction resolved after exact evidence review.';
    document.querySelector('[data-decision="resolved"][data-claim="claim"]').focus();
  })()`);
  await pressEnter(cdp);
  await waitFor(cdp, `fetch('/api/recent-decisions?limit=100').then((response) => response.json()).then((body) => body.items.some((item) => item.threadId === 'alpha-contradiction' && item.status === 'resolved' && item.current))`);
  await waitFor(cdp, `document.querySelector('#status-region')?.textContent.includes('10 ranked')`);
  await evaluate(cdp, `document.querySelector('.workspace-back').focus()`);
  await pressEnter(cdp);
  await waitFor(cdp, `document.querySelectorAll('[data-trust-item]').length === 10`);
  await waitFor(cdp, `document.activeElement?.closest?.('[data-trust-item]')?.dataset?.trustItem === 'claim:gamma:gamma-release-new'`);
  const afterDecision = await evaluate(cdp, `({
    count: document.querySelectorAll('[data-trust-item]').length,
    alphaPresent: Boolean(document.querySelector('[data-trust-item="claim:alpha:alpha-contradiction"]')),
    first: document.querySelector('[data-trust-item]')?.dataset.trustItem || '',
    active: document.activeElement?.closest?.('[data-trust-item]')?.dataset?.trustItem || ''
  })`);
  assert.equal(afterDecision.count, 10);
  assert.equal(afterDecision.alphaPresent, false, "resolved claim must leave the current attention queue");
  assert.equal(afterDecision.first, "claim:gamma:gamma-release-new");
  assert.equal(afterDecision.active, "claim:gamma:gamma-release-new", "return focus must fall forward when the routed item closes");

  await evaluate(cdp, `document.querySelector('[data-workspace-scope="decisions"]').focus()`);
  await pressEnter(cdp);
  await waitFor(cdp, `Boolean(document.querySelector('.decision-history'))`);
  const recent = await evaluate(cdp, `(() => {
    const events = [...document.querySelectorAll('[data-recent-decision]')];
    const alpha = events.filter((event) => event.textContent.includes('alpha-contradiction'));
    const current = alpha.find((event) => event.classList.contains('is-current'));
    const history = alpha.find((event) => !event.classList.contains('is-current'));
    return { count: events.length, alphaCount: alpha.length, current: current?.textContent || '', history: history?.textContent || '', overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  })()`);
  assert.ok(recent.count > 0);
  assert.equal(recent.alphaCount, 2, "decision view must preserve the prior transition beside the current projection");
  assert.match(recent.current, /resolved/i);
  assert.match(recent.current, /Browser proof: contradiction resolved/);
  assert.match(recent.history, /more-proof/i);
  assert.match(recent.history, /request exact follow-up evidence/i);
  assert.equal(recent.overflow, false);
  await screenshot(cdp, path.join(outputRoot, "trust-inbox-recent-decisions.png"));

  await setViewport(cdp, 390, 844, true);
  await navigate(cdp, inboxUrl, ".trust-item");
  const mobile = await evaluate(cdp, `({
    itemIds: [...document.querySelectorAll('[data-trust-item]')].slice(0, 3).map((item) => item.dataset.trustItem),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    firstActionVisible: (() => { const box = document.querySelector('[data-trust-link]')?.getBoundingClientRect(); return Boolean(box && box.width >= 40 && box.height >= 40); })()
  })`);
  assert.deepEqual(mobile.itemIds, desktop.itemIds.slice(1, 4));
  assert.equal(mobile.overflow, false);
  assert.equal(mobile.firstActionVisible, true);
  await screenshot(cdp, path.join(outputRoot, "trust-inbox-mobile.png"));

  await setViewport(cdp, 320, 800, true);
  await navigate(cdp, inboxUrl, ".trust-item");
  const narrow = await evaluate(cdp, `({
    cssWidth: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    mainVisible: document.querySelector('main')?.getBoundingClientRect().width > 0,
    actions: [...document.querySelectorAll('[data-trust-link]')].slice(0, 3).every((link) => { const box = link.getBoundingClientRect(); return box.width >= 40 && box.height >= 40; })
  })`);
  assert.equal(narrow.cssWidth, 320);
  assert.equal(narrow.overflow, false, "Trust Inbox must reflow without page-level overflow at 320 CSS pixels (400% desktop zoom equivalent)");
  assert.equal(narrow.mainVisible, true);
  assert.equal(narrow.actions, true);

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(cdp, inboxUrl, ".trust-item");
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const zoomed = await evaluate(cdp, `({
    scale: window.visualViewport?.scale || 1,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    mainWidth: document.querySelector('main')?.getBoundingClientRect().width || 0
  })`);
  assert.ok(zoomed.scale >= 2, `expected 200% page scale, received ${zoomed.scale}`);
  assert.equal(zoomed.overflow, false, "Trust Inbox must not create page-level overflow at 200% page scale");
  assert.ok(zoomed.mainWidth > 0);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });

  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
  await evaluate(cdp, `document.querySelector('[data-trust-link]').focus()`);
  const forcedColors = await evaluate(cdp, `(() => {
    const query = matchMedia('(forced-colors: active)').matches;
    const style = getComputedStyle(document.querySelector('[data-trust-link]'));
    const card = getComputedStyle(document.querySelector('[data-trust-item]'));
    return { query, outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), borderStyle: card.borderStyle };
  })()`);
  assert.equal(forcedColors.query, true, "forced-colors emulation must be active");
  assert.notEqual(forcedColors.outlineStyle, "none", "focused Trust controls need a forced-colors outline");
  assert.ok(forcedColors.outlineWidth >= 2);
  assert.notEqual(forcedColors.borderStyle, "none", "Trust cards need a forced-colors boundary");
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });

  assert.deepEqual(failures, [], `browser network failures: ${failures.join("; ")}`);
  assert.deepEqual(consoleProblems, [], `browser console problems: ${consoleProblems.join("; ")}`);
  await cdp.send("Browser.close", {}, null);
  console.log(`browser check passed: checkpoint persistence, changed filter, stale-link refusal, exact degraded receipt, keyboard activation and return focus, queue update, recent decision history, responsive overflow, and clean console/network`);
} finally {
  if (chromeProcess?.exitCode === null) {
    chromeProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => chromeProcess.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_000))
    ]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(`${request.method}: ${message.error.message}`));
      else request?.resolve(message.result || {});
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  return {
    sessionId: null,
    on(method, listener) {
      const entries = listeners.get(method) || [];
      entries.push(listener);
      listeners.set(method, entries);
    },
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

async function setViewport(cdp, width, height, mobile) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
}

async function navigate(cdp, url, selector) {
  const startedAt = Date.now();
  await cdp.send("Page.navigate", { url });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, `document.readyState === 'complete' && Boolean(document.querySelector(${JSON.stringify(selector)}))`).catch(() => false);
    if (ready) return Date.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Browser did not render ${selector} at ${url}`);
}

async function waitFor(cdp, expression, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `Boolean(${expression})`).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}

async function pressEnter(cdp) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
}

async function pressTab(cdp, { shift = false } = {}) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: shift ? 8 : 0, windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", modifiers: shift ? 8 : 0, windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser evaluation failed");
  return result.result?.value;
}

async function screenshot(cdp, target) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(target, Buffer.from(data, "base64"));
}
