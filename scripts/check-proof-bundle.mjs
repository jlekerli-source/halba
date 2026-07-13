import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertSafeBundlePath,
  loadProofBundle,
  publicBundleSummary
} from "../src/proof/bundle.js";

const bundle = await loadProofBundle();
const summary = publicBundleSummary(bundle);

assert.equal(bundle.definition.id, "halba-build-week-demo");
assert.equal(bundle.sources.length, 6);
assert.equal(bundle.sourceByPath.get(bundle.definition.reportPath).kind, "report");
assert.equal(bundle.sourceByPath.get("diffs/stale-review-clock.patch").kind, "diff");
assert.ok(bundle.sources.every((source) => source.sha256.length === 64));
assert.ok(bundle.sources.every((source) => source.lineCount > 0));
assert.ok(summary.sources.every((source) => !Object.hasOwn(source, "text")), "public summary leaked source text");

for (const unsafePath of ["/tmp/proof.md", "../proof.md", "file:proof.md", "C:\\proof.md"]) {
  assert.throws(() => assertSafeBundlePath(unsafePath), /unsafe bundle path/);
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-proof-bundle-"));
try {
  await writeFile(path.join(temporaryRoot, "source.md"), "proof\n");
  await writeFile(path.join(temporaryRoot, "bundle.json"), JSON.stringify({
    schemaVersion: 1,
    id: "duplicate-source",
    title: "Duplicate source fixture",
    generatedAt: "2026-07-13T00:00:00.000Z",
    evaluationDate: "2026-07-13",
    agent: "fixture",
    reportPath: "source.md",
    sources: [
      { path: "source.md", label: "one", kind: "report" },
      { path: "source.md", label: "two", kind: "source" }
    ],
    guards: []
  }));
  await assert.rejects(loadProofBundle(path.join(temporaryRoot, "bundle.json")), /duplicate proof bundle source/);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(`check passed: proof bundle indexed ${bundle.sources.length} sources and ${bundle.totalBytes} bytes`);
