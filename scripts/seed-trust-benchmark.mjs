import { createHash } from "node:crypto";
import path from "node:path";

import { openLocalStore } from "../src/storage/local-store.js";
import { buildTrustBenchmark } from "./trust-benchmark-fixture.mjs";

const stateIndex = process.argv.indexOf("--state");
const stateFile = stateIndex >= 0 ? process.argv[stateIndex + 1] : null;
if (!stateFile) throw new Error("Usage: npm run state:seed-trust -- --state path/to/halba.sqlite");

const benchmark = buildTrustBenchmark();
const store = await openLocalStore(path.resolve(stateFile));
try {
  for (const context of benchmark.contexts) {
    for (const record of context.proofRecords) {
      store.importWorkspace(context.workspace, {
        adapter: "trust-benchmark-v1",
        sourceRef: `synthetic:${record.bundle.id}`,
        sourceDigest: digest(record.bundle),
        importedAt: record.importedAt,
        proofBundle: record.bundle,
        receiptId: `trust-benchmark-${record.bundle.id}`
      });
    }
    for (const receipt of context.receipts) {
      store.importWorkspace(context.workspace, {
        adapter: receipt.adapter,
        sourceRef: receipt.sourceRef,
        sourceDigest: digest(receipt),
        importedAt: receipt.importedAt,
        receiptId: receipt.id,
        status: receipt.status,
        warnings: receipt.warnings
      });
    }
    for (const decision of context.decisions) store.saveReviewDecision(decision);
  }
} finally {
  store.close();
}

console.log(`seeded Trust Operations benchmark v${benchmark.version}: ${benchmark.contexts.length} workspaces, ${benchmark.runCount} runs, ${benchmark.expectedAttentionIds.length} gold attention items`);

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
