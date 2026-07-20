import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { proofBundleRecord } from "../src/importers/run-manifest.js";
import { loadProofBundle } from "../src/proof/bundle.js";
import { runProof } from "../src/proof/run.js";
import { defaultStateFile, openLocalStore, restoreLocalStore } from "../src/storage/local-store.js";

const [command = "status", argument] = process.argv.slice(2);
const stateFile = path.resolve(process.env.HALBA_STATE_FILE || defaultStateFile);

if (command === "restore") {
  if (!argument) throw new Error("usage: npm run state -- restore <backup.sqlite> [--overwrite]");
  await restoreLocalStore(argument, stateFile, { overwrite: process.argv.includes("--overwrite") });
  console.log(`restored Halba state -> ${stateFile}`);
  process.exit(0);
}

const store = await openLocalStore(stateFile);
try {
  if (command === "init") {
    const workspaceText = await readFile(new URL("../data/demo/workspace.json", import.meta.url), "utf8");
    const workspace = JSON.parse(workspaceText);
    const loadedBundle = await loadProofBundle();
    const proof = await runProof({ mode: "recorded" });
    const proofBundle = proofBundleRecord(loadedBundle, proof);
    const sourceDigest = createHash("sha256").update(workspaceText).update(JSON.stringify(proofBundle)).digest("hex");
    const result = store.importWorkspace(workspace, {
      adapter: "codex-proof-demo",
      sourceRef: "data/demo",
      sourceDigest,
      proofBundle,
      sourceRoot: loadedBundle.bundleRoot,
      receiptId: `demo-${sourceDigest.slice(0, 16)}`
    });
    console.log(`initialized Halba state: ${result.counts.runs} runs, ${result.counts.proofSources} proof sources -> ${stateFile}`);
  } else if (command === "status") {
    const health = store.health();
    const workspaces = store.listWorkspaces();
    console.log(JSON.stringify({ ...health, workspaces }, null, 2));
  } else if (command === "backup") {
    if (!argument) throw new Error("usage: npm run state -- backup <backup.sqlite>");
    const target = await store.backupTo(argument);
    console.log(`backed up Halba state -> ${target}`);
  } else {
    throw new Error("usage: npm run state -- <init|status|backup|restore> [path] [--overwrite]");
  }
} finally {
  store.close();
}
