import { constants } from "node:fs";
import { lstat, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildTrustPack, trustPackLimits, verifyTrustPack } from "../src/domain/trust-pack.js";
import { defaultStateFile, openLocalStoreReadOnly } from "../src/storage/local-store.js";

const [command, ...rawArgs] = process.argv.slice(2);
if (!["export", "verify"].includes(command)) fail("command must be export or verify");
const options = parseOptions(rawArgs);

if (command === "export") await exportPack(options);
else await verifyPack(options);

async function exportPack(options) {
  if (!options.workspace) fail("--workspace is required for export");
  if (!options.output) fail("--output is required for export");
  if (options.input) fail("--input is not valid for export");
  const stateFile = path.resolve(options.state || process.env.HALBA_STATE_FILE || defaultStateFile);
  const outputFile = path.resolve(options.output);
  if (stateFile === outputFile) fail("trust pack output must differ from local state");
  const parent = await stat(path.dirname(outputFile));
  if (!parent.isDirectory()) fail("trust pack output parent must be a directory");
  if (!options.overwrite && await exists(outputFile)) fail("trust pack output already exists; use --overwrite explicitly");

  const store = await openLocalStoreReadOnly(stateFile);
  let pack;
  try {
    pack = buildTrustPack(store.exportTrustPackSnapshot(options.workspace));
    verifyTrustPack(pack);
  } finally {
    store.close();
  }
  const temporary = `${outputFile}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(pack, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    if (!options.overwrite && await exists(outputFile)) fail("trust pack output appeared during export");
    await rename(temporary, outputFile);
  } finally {
    await rm(temporary, { force: true });
  }
  printResult({ ...verifyTrustPack(pack), output: outputFile }, options.format);
}

async function verifyPack(options) {
  if (!options.input) fail("--input is required for verify");
  if (options.output || options.workspace || options.state || options.overwrite) fail("verify accepts only --input and --format");
  const record = await readPack(options.input);
  printResult({ ...verifyTrustPack(record), input: path.resolve(options.input) }, options.format);
}

async function readPack(file) {
  const target = path.resolve(file);
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const metadata = await handle.stat();
    const maximumBytes = trustPackLimits.totalSourceBytes + 16 * 1024 * 1024;
    if (!metadata.isFile()) fail("trust pack input must be a regular non-symlink file");
    if (metadata.size > maximumBytes) fail("trust pack input exceeds the byte limit");
    const bytes = await handle.readFile();
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("trust pack input must contain valid JSON");
    }
  } catch (error) {
    if (error?.code === "ELOOP") fail("trust pack input must be a regular non-symlink file");
    throw error;
  } finally {
    await handle?.close();
  }
}

function parseOptions(args) {
  const options = { format: "json", overwrite: false };
  const flags = new Set(["overwrite"]);
  const values = new Set(["state", "workspace", "output", "input", "format"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) fail(`unexpected positional argument ${argument}`);
    const key = argument.slice(2);
    if (flags.has(key)) {
      if (options[key]) fail(`${argument} was provided more than once`);
      options[key] = true;
      continue;
    }
    if (!values.has(key)) fail(`unknown option ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    if (key !== "format" && options[key]) fail(`${argument} was provided more than once`);
    options[key] = value;
    index += 1;
  }
  if (!["json", "text"].includes(options.format)) fail("--format must be json or text");
  return options;
}

function printResult(result, format) {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`verified unsigned local trust pack ${result.packDigest}`);
  console.log(`${result.workspaceId}: ${result.importEvents} imports, ${result.decisionEvents} decisions, ${result.proofSources} proof sources, ${result.ledgerEntries} ledger entries`);
}

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function fail(message) {
  const error = new Error(`trust pack failed: ${message}`);
  error.code = "trust_pack_failed";
  throw error;
}
