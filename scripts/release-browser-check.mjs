import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-release-browser-"));
const stateFile = path.join(temporaryRoot, "trust.sqlite");
const screenshots = path.join(temporaryRoot, "screenshots");
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
let server;

try {
  await run(process.execPath, ["--disable-warning=ExperimentalWarning", "scripts/seed-trust-benchmark.mjs", "--state", stateFile]);
  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    cwd: root,
    env: { ...process.env, HALBA_STATE_FILE: stateFile, HALBA_HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => { serverError = `${serverError}${chunk}`.slice(-8_000); });
  await waitForServer(`${origin}/api/workspaces`, server, () => serverError);
  await run(process.execPath, ["scripts/browser-trust-inbox.mjs", "--origin", origin, "--out", screenshots]);
  await run(process.execPath, ["--disable-warning=ExperimentalWarning", "scripts/browser-workspace-scale.mjs"]);
  console.log("release browser check passed: Trust Inbox workflow and bounded 2,000-run surface");
} finally {
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), delay(2_000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${args.join(" ")} failed (${code ?? signal})`)));
  });
}

async function waitForServer(target, child, errorText) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(errorText() || `Halba server exited ${child.exitCode}`);
    try {
      const response = await fetch(target);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${target}: ${errorText()}`);
}

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port: value } = server.address();
      server.close((error) => error ? reject(error) : resolve(value));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
