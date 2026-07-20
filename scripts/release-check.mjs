import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  access,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  buildHumanTrustTrial,
  humanTrustPublicReceipt,
  verifyHumanTrustPublicReceipt,
  verifyHumanTrustSessionRecord,
} from "../src/domain/human-trust-eval.js";
import { buildTrustOperations } from "../src/domain/trust-operations.js";
import { readPublicManifest, root } from "./public-manifest.mjs";
import { buildTrustBenchmark } from "./trust-benchmark-fixture.mjs";

const distRoot = path.join(root, "dist");
const packageRoot = path.join(distRoot, "halba-public");
const archivePath = path.join(distRoot, "halba-public.tar.gz");
const evidencePath = path.join(distRoot, "release-evidence.json");
const lockPath = path.join(distRoot, ".release-check.lock");
const requireHuman = process.argv.includes("--require-human");

await mkdir(distRoot, { recursive: true });
const releaseLock = await acquireReleaseLock();
let archiveVerificationRoot;

try {
  if (requireHuman) {
    console.log("\n[release] private goal evaluation");
    await run("npm run eval:goal", root);
  }
  const humanGate = await readHumanGateReceipt({ requireHuman });

  archiveVerificationRoot = await mkdtemp(
    path.join(os.tmpdir(), "halba-archive-verification-"),
  );
  const manifest = await readPublicManifest();

  await rm(packageRoot, { recursive: true, force: true });
  await rm(archivePath, { force: true });
  await mkdir(packageRoot, { recursive: true });

  for (const item of manifest.include) {
    await copyAllowlistedPath(
      path.join(root, item.replace(/\/$/, "")),
      path.join(packageRoot, item.replace(/\/$/, "")),
    );
  }

  for (const item of manifest.exclude) {
    assert.equal(
      await exists(path.join(packageRoot, item.replace(/\/$/, ""))),
      false,
      `private path copied: ${item}`,
    );
  }

  const suites = [
    ["check", "npm run check"],
    ["smoke", "npm run smoke"],
    ["eval", "npm run eval"],
  ];
  const chrome =
    process.env.CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browserAvailable = await access(chrome).then(
    () => true,
    () => false,
  );

  const startedAt = new Date().toISOString();
  for (const [name, command] of suites) {
    console.log(`\n[release] ${name}`);
    await run(command, packageRoot);
  }
  if (browserAvailable) {
    console.log("\n[release] browser");
    await run("npm run release:browser", packageRoot);
  }

  await run(
    `tar -czf ${shellQuote(archivePath)} -C ${shellQuote(distRoot)} halba-public`,
    root,
  );
  await mkdir(archiveVerificationRoot, { recursive: true });
  await run(
    `tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(archiveVerificationRoot)}`,
    root,
  );

  const extractedRoot = path.join(archiveVerificationRoot, "halba-public");
  console.log("\n[release] extracted archive verification");
  for (const [name, command] of suites) {
    console.log(`[archive] ${name}`);
    await run(command, extractedRoot);
  }
  if (browserAvailable) {
    console.log("[archive] browser");
    await run("npm run release:browser", extractedRoot);
  }

  const packageFileCount = await countFiles(packageRoot);
  const extractedFileCount = await countFiles(extractedRoot);
  assert.equal(
    extractedFileCount,
    packageFileCount,
    "archive file count differs from reconstructed package",
  );
  const evidence = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    startedAt,
    packagePath: path.relative(root, packageRoot),
    archivePath: path.relative(root, archivePath),
    archiveSha256: await sha256(archivePath),
    fileCount: packageFileCount,
    extractedFileCount,
    includeCount: manifest.include.length,
    excludedPathCount: manifest.exclude.length,
    suites: suites.map(([name]) => ({ name, status: "passed" })),
    browser: browserAvailable
      ? {
          status: "passed",
          reconstructedPackage: true,
          extractedArchive: true,
          chrome,
        }
      : {
          status: "not_run_chrome_unavailable",
          reconstructedPackage: false,
          extractedArchive: false,
          chrome,
        },
    archiveVerification: "extracted_and_suites_passed",
    humanGate,
    liveOpenAIEval: "not_run_without_explicit_credentials",
    publication: "not_performed",
  };

  await writeFile(
    evidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(`\n[release] clean package passed (${evidence.fileCount} files)`);
  console.log(`[release] archive sha256 ${evidence.archiveSha256}`);
  console.log(`[release] evidence ${path.relative(root, evidencePath)}`);
} finally {
  if (archiveVerificationRoot)
    await rm(archiveVerificationRoot, { recursive: true, force: true });
  await releaseLock.close();
  await unlink(lockPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function acquireReleaseLock() {
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
    );
    return handle;
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `another release check owns ${path.relative(root, lockPath)}; wait for it to finish`,
      );
    }
    throw error;
  }
}

async function copyAllowlistedPath(source, destination) {
  const stat = await lstat(source);
  assert.equal(
    stat.isSymbolicLink(),
    false,
    `symlink is not releasable: ${path.relative(root, source)}`,
  );

  if (stat.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (
        [".git", "node_modules", ".playwright-cli", "dist"].includes(entry.name)
      )
        continue;
      await copyAllowlistedPath(
        path.join(source, entry.name),
        path.join(destination, entry.name),
      );
    }
    return;
  }

  assert.ok(
    stat.isFile(),
    `unsupported public package entry: ${path.relative(root, source)}`,
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, stat.mode & 0o777);
}

async function run(command, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ""}`,
        OPENAI_API_KEY: "",
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`command failed (${code ?? signal}): ${command}`));
    });
  });
}

async function exists(target) {
  return lstat(target).then(
    () => true,
    () => false,
  );
}

async function readHumanGateReceipt({ requireHuman: required }) {
  const target = path.join(
    root,
    "artifacts",
    "evals",
    "human-trust-inbox-result.json",
  );
  try {
    const receipt = JSON.parse(await readFile(target, "utf8"));
    const trial = currentHumanTrustTrial();
    const verification = verifyHumanTrustPublicReceipt(receipt, trial);

    if (required) {
      const privateTarget = path.join(
        root,
        ".halba",
        "evals",
        "human-trust-inbox",
        "passing.json",
      );
      const privateRecord = JSON.parse(await readFile(privateTarget, "utf8"));
      const privateVerification = verifyHumanTrustSessionRecord(privateRecord, trial);
      assert.equal(privateVerification.passed, true, "goal release requires a passing private human session");
      assert.deepEqual(receipt, humanTrustPublicReceipt(privateRecord), "goal release public receipt does not match the verified private human session");
      assert.equal(verification.passed, true, "goal release requires a passing public human receipt");
    }

    return {
      status: verification.passed ? "passed" : "failed",
      durationMs: receipt.durationMs,
      receiptDigest: receipt.receiptDigest,
      evidence: path.relative(root, target),
      authority: "facilitator_attestation_not_identity_proof",
    };
  } catch (error) {
    if (error?.code === "ENOENT" && !required) return { status: "not_run", evidence: null };
    if (error?.code === "ENOENT") throw new Error("goal release requires matching private and public human Trust Inbox evidence");
    throw error;
  }
}

function currentHumanTrustTrial() {
  const benchmark = buildTrustBenchmark();
  const report = buildTrustOperations({
    contexts: benchmark.contexts,
    evaluatedAt: benchmark.evaluatedAt,
  });
  return buildHumanTrustTrial({ benchmark, report });
}

async function countFiles(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await countFiles(target);
    if (entry.isFile()) total += 1;
  }
  return total;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}
