import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  buildHumanTrustSessionRecord,
  buildHumanTrustTrial,
  humanTrustSessionMarkdown,
  verifyHumanTrustSessionRecord
} from "../src/domain/human-trust-eval.js";
import { buildTrustOperations } from "../src/domain/trust-operations.js";
import { buildTrustBenchmark } from "./trust-benchmark-fixture.mjs";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error("The human Trust Inbox evaluation requires an interactive terminal; automation cannot submit a human result.");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const participantAlias = argument("--participant");
const facilitatorAlias = argument("--facilitator");
const output = path.resolve(argument("--output") || path.join(root, "artifacts", "evals", "human-trust-inbox-session.json"));
const markdownOutput = output.replace(/\.json$/i, ".md");
const launchBrowser = process.argv.includes("--launch-browser");

if (!participantAlias || !facilitatorAlias) {
  throw new Error("Usage: npm run eval:human-trust -- --participant participant-01 --facilitator facilitator-01 [--launch-browser] [--output path.json]");
}
await refuseExisting(output);
await refuseExisting(markdownOutput);

const benchmark = buildTrustBenchmark();
const report = buildTrustOperations({ contexts: benchmark.contexts, evaluatedAt: benchmark.evaluatedAt });
const trial = buildHumanTrustTrial({ benchmark, report });
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-human-trust-"));
const stateFile = path.join(temporaryRoot, "halba.sqlite");
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/?view=trust&at=${encodeURIComponent(benchmark.evaluatedAt)}`;
let server;
const terminal = createInterface({ input: process.stdin, output: process.stdout });

try {
  await run(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "scripts", "seed-trust-benchmark.mjs"), "--state", stateFile]);
  server = spawn(process.execPath, [path.join(root, "src", "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      HALBA_STATE_FILE: stateFile,
      HALBA_HOST: "127.0.0.1",
      PORT: String(port)
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => { serverError = `${serverError}${chunk}`.slice(-8_000); });
  await waitForServer(`${origin}/api/workspaces`, server, () => serverError);

  process.stdout.write(`\nHuman Trust Inbox comprehension protocol\n\n`);
  process.stdout.write(`Participant URL: ${url}\n\n`);
  process.stdout.write("Keep this terminal hidden from the participant. Load the URL in a fresh browser profile, but do not reveal the page yet.\n");
  process.stdout.write("Read only this prompt: “Imagine you are starting an operations review. Use this application to decide what you would investigate first and why. Tell me when you have enough information to begin work.”\n");
  process.stdout.write("Do not explain criticality, deterministic authority, expected ordering, Proof Mode, or checkpoints. If asked for help, say only: “Please use the application as you understand it.”\n\n");

  if (launchBrowser) await openBrowser(url);
  await terminal.question("Facilitator: press Enter at the exact moment the participant can first see the page. ");
  const startedAt = new Date();
  const startedMonotonic = performance.now();
  await terminal.question("Press Enter immediately when the participant states the first item, why it is risky, and the required next action. ");
  const endedMonotonic = performance.now();
  const endedAt = new Date();
  const durationMs = endedMonotonic - startedMonotonic;

  process.stdout.write("\nTimer stopped. Record what the participant said; these choices were intentionally hidden until now.\n\n");
  report.items.forEach((item, index) => {
    process.stdout.write(`${index + 1}. ${item.workspaceId} · ${item.stableKey || item.id} · ${item.reasons.map((reason) => reason.code).join(", ")}\n`);
  });
  const selection = await askInteger(terminal, "Which item did the participant identify first? ", 1, report.items.length);
  const observation = {
    selectedItemId: report.items[selection - 1].id,
    contradictionIdentified: await askYesNo(terminal, "Did the participant identify that the claim is contradicted? [y/n] "),
    deterministicAuthorityIdentified: await askYesNo(terminal, "Did the participant attribute the risk to deterministic evidence/policy rather than model or free text? [y/n] "),
    humanDecisionIdentified: await askYesNo(terminal, "Did the participant identify that a current evidence-scoped human decision is required? [y/n] "),
    uninterrupted: await askYesNo(terminal, "Was the timed attempt uninterrupted? [y/n] "),
    unprompted: await askYesNo(terminal, "Was the attempt completed without hints or corrective prompts? [y/n] "),
    facilitatorNote: await terminal.question("Optional privacy-safe facilitator note (no names or personal data): ")
  };

  const record = buildHumanTrustSessionRecord({
    trial,
    participantAlias,
    facilitatorAlias,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs,
    observation,
    sessionId: randomUUID()
  });
  verifyHumanTrustSessionRecord(record, trial);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(markdownOutput, humanTrustSessionMarkdown(record), { mode: 0o600, flag: "wx" });

  process.stdout.write(`\n${record.scoring.passed ? "PASS" : "FAIL"}: ${(record.durationMs / 1_000).toFixed(3)} seconds.\n`);
  process.stdout.write(`Record: ${output}\nDigest: ${record.recordDigest}\n`);
  process.stdout.write("This is facilitator-attested local evidence, not an identity signature. Do not delete failed attempts.\n");
} finally {
  terminal.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), delay(2_000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function refuseExisting(file) {
  try {
    await access(file);
    throw new Error(`Refusing to overwrite existing human evidence: ${file}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function askInteger(reader, prompt, minimum, maximum) {
  while (true) {
    const value = Number(await reader.question(prompt));
    if (Number.isInteger(value) && value >= minimum && value <= maximum) return value;
    process.stdout.write(`Enter an integer from ${minimum} to ${maximum}.\n`);
  }
}

async function askYesNo(reader, prompt) {
  while (true) {
    const value = String(await reader.question(prompt)).trim().toLowerCase();
    if (value === "y" || value === "yes") return true;
    if (value === "n" || value === "no") return false;
    process.stdout.write("Enter y or n.\n");
  }
}

async function openBrowser(target) {
  if (process.platform !== "darwin") {
    process.stdout.write("Automatic browser launch is currently macOS-only; open the printed URL manually.\n");
    return;
  }
  const child = spawn("open", ["-na", "Google Chrome", "--args", "--incognito", target], { detached: true, stdio: "ignore" });
  child.unref();
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText = `${errorText}${chunk}`.slice(-8_000); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(errorText || `${command} exited ${code}`)));
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

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
