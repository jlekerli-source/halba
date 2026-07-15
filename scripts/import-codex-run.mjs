import { writeFile } from "node:fs/promises";
import path from "node:path";

import { workspaceFromCodexProof } from "../src/importers/codex-proof.js";
import { loadProofBundle } from "../src/proof/bundle.js";
import { runProof } from "../src/proof/run.js";
import { root } from "./public-manifest.mjs";

const relativeOutput = process.argv[2] || "data/demo/workspace.json";
const output = path.resolve(root, relativeOutput);
const relative = path.relative(root, output);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("output must stay inside the Halba repository");

const bundle = await loadProofBundle();
const proof = await runProof({ mode: "recorded" });
const workspace = workspaceFromCodexProof(bundle, proof);
await writeFile(output, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");

console.log(`imported Codex proof run: ${workspace.threads[0].events.length} events, ${workspace.threads[0].reviewGateCount} review gates -> ${relative}`);
