import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadProofBundle, publicBundleSummary } from "../src/proof/bundle.js";
import { runProof } from "../src/proof/run.js";
import { loadWorkspace } from "../src/domain/workspace.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const defaultPagesRoot = path.join(root, "dist", "pages");

export async function buildPages(outputRoot = defaultPagesRoot) {
  const publicRoot = path.join(root, "public");
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const file of ["app.js", "halba-icon.svg", "styles.css", "workspace-import.js", "workspace-state.js"]) {
    await copyFile(path.join(publicRoot, file), path.join(outputRoot, file));
  }

  const demoRoot = path.join(outputRoot, "demo");
  await mkdir(demoRoot, { recursive: true });
  for (const file of ["halba-demo.mp4", "halba-demo-still.png", "devpost-thumbnail.png"]) {
    await copyFile(path.join(root, "artifacts", "demo", file), path.join(demoRoot, file));
  }

  const sourceHtml = await readFile(path.join(publicRoot, "index.html"), "utf8");
  const staticHtml = sourceHtml.replace('<html lang="en">', '<html lang="en" data-static-demo="true">');
  await writeFile(path.join(outputRoot, "index.html"), staticHtml, "utf8");
  await writeFile(path.join(outputRoot, "404.html"), staticHtml, "utf8");
  await writeFile(path.join(outputRoot, ".nojekyll"), "", "utf8");

  const bundle = await loadProofBundle();
  const workspace = await loadWorkspace(undefined, { proofBundleId: bundle.id });
  const proof = await runProof({ mode: "recorded" });
  const sources = Object.fromEntries(bundle.sources.map((source) => [source.path, {
    path: source.path,
    label: source.label,
    kind: source.kind,
    sha256: source.sha256,
    lineCount: source.lineCount,
    lines: source.lines
  }]));
  const staticDemo = {
    schemaVersion: 1,
    generatedBy: "npm run build:pages",
    workspace,
    bundle: publicBundleSummary(bundle),
    proof,
    sources
  };
  await writeFile(path.join(outputRoot, "static-demo.json"), `${JSON.stringify(staticDemo)}\n`, "utf8");

  return {
    outputRoot,
    bundleId: staticDemo.bundle.id,
    sourceCount: staticDemo.bundle.sourceCount,
    findingCount: staticDemo.proof.findings.length,
    demoVideoPath: path.join(outputRoot, "demo", "halba-demo.mp4"),
    devpostThumbnailPath: path.join(outputRoot, "demo", "devpost-thumbnail.png")
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildPages();
  console.log(`built Pages demo: ${result.sourceCount} sources, ${result.findingCount} findings`);
}
