import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { readPublicManifest, root } from "./public-manifest.mjs";

const distRoot = path.join(root, "dist");
const packageRoot = path.join(distRoot, "halba-public");
const archivePath = path.join(distRoot, "halba-public.tar.gz");
const evidencePath = path.join(distRoot, "release-evidence.json");
const archiveVerificationRoot = path.join(distRoot, "archive-verification");
const manifest = await readPublicManifest();

await rm(packageRoot, { recursive: true, force: true });
await rm(archivePath, { force: true });
await rm(archiveVerificationRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });

for (const item of manifest.include) {
  await copyAllowlistedPath(path.join(root, item.replace(/\/$/, "")), path.join(packageRoot, item.replace(/\/$/, "")));
}

for (const item of manifest.exclude) {
  assert.equal(await exists(path.join(packageRoot, item.replace(/\/$/, ""))), false, `private path copied: ${item}`);
}

const suites = [
  ["check", "npm run check"],
  ["smoke", "npm run smoke"],
  ["eval", "npm run eval"],
];

const startedAt = new Date().toISOString();
for (const [name, command] of suites) {
  console.log(`\n[release] ${name}`);
  await run(command, packageRoot);
}

await run(`tar -czf ${shellQuote(archivePath)} -C ${shellQuote(distRoot)} halba-public`, root);
await mkdir(archiveVerificationRoot, { recursive: true });
await run(`tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(archiveVerificationRoot)}`, root);

const extractedRoot = path.join(archiveVerificationRoot, "halba-public");
console.log("\n[release] extracted archive verification");
for (const [name, command] of suites) {
  console.log(`[archive] ${name}`);
  await run(command, extractedRoot);
}

const packageFileCount = await countFiles(packageRoot);
const extractedFileCount = await countFiles(extractedRoot);
assert.equal(extractedFileCount, packageFileCount, "archive file count differs from reconstructed package");

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
  archiveVerification: "extracted_and_suites_passed",
  liveOpenAIEval: "not_run_without_explicit_credentials",
  publication: "not_performed",
};

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`\n[release] clean package passed (${evidence.fileCount} files)`);
console.log(`[release] archive sha256 ${evidence.archiveSha256}`);
console.log(`[release] evidence ${path.relative(root, evidencePath)}`);

async function copyAllowlistedPath(source, destination) {
  const stat = await lstat(source);
  assert.equal(stat.isSymbolicLink(), false, `symlink is not releasable: ${path.relative(root, source)}`);

  if (stat.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "node_modules", ".playwright-cli", "dist"].includes(entry.name)) continue;
      await copyAllowlistedPath(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return;
  }

  assert.ok(stat.isFile(), `unsupported public package entry: ${path.relative(root, source)}`);
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
  return lstat(target).then(() => true, () => false);
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
