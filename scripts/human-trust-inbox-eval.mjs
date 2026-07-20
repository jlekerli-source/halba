import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, appendFile, chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  buildHumanTrustSessionRecord,
  buildHumanTrustTrial,
  humanTrustPublicReceipt,
  humanTrustPublicReceiptMarkdown,
  humanTrustSessionMarkdown,
  resolveHumanTrustPrivateRoot,
  validateHumanTrustAliases,
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
const privateRoot = resolveHumanTrustPrivateRoot(
  root,
  argument("--private-root") || path.join(root, ".halba", "evals", "human-trust-inbox")
);
const passingOutput = path.join(privateRoot, "passing.json");
const passingMarkdownOutput = path.join(privateRoot, "passing.md");
const attemptRoot = path.join(privateRoot, "attempts");
const ledgerOutput = path.join(privateRoot, "attempts.jsonl");
const publicOutput = path.join(root, "artifacts", "evals", "human-trust-inbox-result.json");
const publicMarkdownOutput = path.join(root, "artifacts", "evals", "human-trust-inbox-result.md");
const launchBrowser = process.argv.includes("--launch-browser");

if (!participantAlias || !facilitatorAlias) {
  throw new Error("Usage: npm run eval:human-trust -- --participant participant-01 --facilitator facilitator-01 [--launch-browser] [--private-root path]");
}
validateHumanTrustAliases(participantAlias, facilitatorAlias);
if (argument("--output")) throw new Error("--output is no longer accepted. Raw attempts are append-only under --private-root so failed evidence cannot be replaced.");
await preparePrivateRoot(privateRoot);
await refuseExisting(passingOutput, "A passing private session already exists");
await refuseExisting(passingMarkdownOutput, "A passing private session summary already exists");
await refuseExisting(publicOutput, "A public judge receipt already exists");
await refuseExisting(publicMarkdownOutput, "A public judge receipt summary already exists");

const benchmark = buildTrustBenchmark();
const report = buildTrustOperations({ contexts: benchmark.contexts, evaluatedAt: benchmark.evaluatedAt });
const trial = buildHumanTrustTrial({ benchmark, report });
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-human-trust-"));
const stateFile = path.join(temporaryRoot, "halba.sqlite");
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/?view=trust&at=${encodeURIComponent(benchmark.evaluatedAt)}`;
const sessionId = randomUUID();
let server;
let browser;
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
  process.stdout.write("Preflight answers are part of the private facilitator attestation. The session starts only if every condition is true.\n\n");
  const protocol = {
    freshParticipant: await askYesNo(terminal, "Is this a fresh participant who has not previously used this Halba trial? [y/n] "),
    facilitatorIndependent: await askYesNo(terminal, "Are you a facilitator distinct from both the participant and Halba's product author? [y/n] "),
    noPriorExposure: await askYesNo(terminal, "Has the participant received no rubric, expected answer, screenshot, or rehearsal? [y/n] "),
    informedConsent: await askYesNo(terminal, "Did the participant consent to an anonymous timed usability observation? [y/n] "),
    freshBrowserProfile: await askYesNo(terminal, "Will the participant use a fresh browser profile with no retained Halba state? [y/n] ")
  };
  if (!Object.values(protocol).every(Boolean)) {
    throw new Error("The independent human-comprehension protocol is not eligible. No timed attempt was started or recorded.");
  }

  process.stdout.write(`Participant URL: ${url}\n\n`);
  process.stdout.write("Keep this terminal hidden from the participant. Load the URL in a fresh browser profile, but do not reveal the page yet.\n");
  process.stdout.write("Read only this prompt: “Imagine you are starting an operations review. Use this application to decide what you would investigate first and why. Tell me when you have enough information to begin work.”\n");
  process.stdout.write("Do not explain criticality, deterministic authority, expected ordering, Proof Mode, or checkpoints. If asked for help, say only: “Please use the application as you understand it.”\n\n");

  if (launchBrowser) browser = await openBrowser(url, path.join(temporaryRoot, "chrome-user-data"));
  await terminal.question("Facilitator: press Enter at the exact moment the participant can first see the page. ");
  const startedAt = new Date();
  const startedMonotonic = performance.now();
  await terminal.question("Press Enter immediately when the participant states the first item, why it is risky, and the required next action. ");
  const endedMonotonic = performance.now();
  const endedAt = new Date();
  const durationMs = endedMonotonic - startedMonotonic;

  process.stdout.write("\nTimer stopped. Capture the participant response before the rubric is revealed.\n\n");
  const participantResponseParaphrase = await terminal.question("Required concise privacy-safe paraphrase of the participant's response (no names or personal data): ");
  process.stdout.write("\nRubric revealed only after the response paraphrase was captured.\n\n");
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
    participantResponseParaphrase,
    facilitatorNote: await terminal.question("Optional privacy-safe facilitator note (no names or personal data): ")
  };

  const record = buildHumanTrustSessionRecord({
    trial,
    participantAlias,
    facilitatorAlias,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs,
    protocol,
    observation,
    sessionId
  });
  verifyHumanTrustSessionRecord(record, trial);
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });
  const attemptOutput = path.join(attemptRoot, `${record.sessionId}.json`);
  const attemptMarkdownOutput = path.join(attemptRoot, `${record.sessionId}.md`);
  await writeFile(attemptOutput, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(attemptMarkdownOutput, humanTrustSessionMarkdown(record), { mode: 0o600, flag: "wx" });
  await appendFile(ledgerOutput, `${JSON.stringify({
    schemaVersion: 1,
    sessionId: record.sessionId,
    result: record.scoring.passed ? "passed" : "failed",
    durationMs: record.durationMs,
    trialDigest: record.trial.trialDigest,
    recordDigest: record.recordDigest,
    attemptPath: path.relative(privateRoot, attemptOutput),
    recordedAt: record.recordedAt
  })}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(ledgerOutput, 0o600);

  if (record.scoring.passed) {
    const receipt = humanTrustPublicReceipt(record);
    await mkdir(path.dirname(publicOutput), { recursive: true });
    await writeFile(passingOutput, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await writeFile(passingMarkdownOutput, humanTrustSessionMarkdown(record), { mode: 0o600, flag: "wx" });
    await writeFile(publicOutput, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644, flag: "wx" });
    await writeFile(publicMarkdownOutput, humanTrustPublicReceiptMarkdown(receipt), { mode: 0o644, flag: "wx" });
  }

  process.stdout.write(`\n${record.scoring.passed ? "PASS" : "FAIL"}: ${(record.durationMs / 1_000).toFixed(3)} seconds.\n`);
  process.stdout.write(`Private attempt: ${attemptOutput}\nDigest: ${record.recordDigest}\n`);
  if (record.scoring.passed) process.stdout.write(`Redacted judge receipt: ${publicOutput}\n`);
  process.stdout.write("Every timed attempt is retained privately. Public evidence excludes aliases and notes. This remains facilitator attestation, not identity proof.\n");
} finally {
  terminal.close();
  await terminate(browser, { processGroup: true });
  await terminate(server);
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function preparePrivateRoot(target) {
  const allowedRoot = path.join(root, ".halba");
  await mkdir(allowedRoot, { recursive: true, mode: 0o700 });
  const realRepoRoot = await realpath(root);
  const realAllowedRoot = await realpath(allowedRoot);
  if (realAllowedRoot !== path.join(realRepoRoot, ".halba")) {
    throw new Error("human trust private root must not escape through a .halba symlink");
  }

  let current = allowedRoot;
  for (const component of path.relative(allowedRoot, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const realCurrent = await realpath(current);
    resolveHumanTrustPrivateRoot(realRepoRoot, realCurrent);
  }
  await chmod(target, 0o700);
}

async function refuseExisting(file, prefix) {
  try {
    await access(file);
    throw new Error(`${prefix}: ${file}`);
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

async function openBrowser(target, profileRoot) {
  if (process.platform !== "darwin") {
    throw new Error("--launch-browser currently requires macOS Google Chrome; omit it and use a separately created fresh profile on this platform.");
  }
  const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  await access(chrome);
  await mkdir(profileRoot, { recursive: true, mode: 0o700 });
  const child = spawn(chrome, [
    `--user-data-dir=${profileRoot}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    "--window-position=0,0",
    "--window-size=1440,1000",
    "--force-device-scale-factor=1",
    "--new-window",
    target
  ], { detached: true, stdio: "ignore" });
  child.once("error", (error) => {
    process.stderr.write(`Isolated Chrome failed: ${error.message}\n`);
  });
  return child;
}

async function terminate(child, { processGroup = false } = {}) {
  if (!child || child.exitCode !== null) return;
  signal(child, "SIGTERM", processGroup);
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
  if (child.exitCode === null) {
    signal(child, "SIGKILL", processGroup);
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(1_000)]);
  }
}

function signal(child, signalName, processGroup) {
  try {
    if (processGroup && child.pid) process.kill(-child.pid, signalName);
    else child.kill(signalName);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
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
