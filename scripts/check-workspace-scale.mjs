import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { validateWorkspace } from "../public/shared/workspace-contract.js";
import { openLocalStore } from "../src/storage/local-store.js";
import { buildScaleWorkspace } from "./scale-workspace-fixture.mjs";

const threadCount = 2000;
const workspace = buildScaleWorkspace(threadCount);

const started = performance.now();
validateWorkspace(workspace);
const store = await openLocalStore(":memory:");
store.importWorkspace(workspace, { adapter: "scale-fixture", sourceDigest: "a".repeat(64), receiptId: "scale-receipt" });
const elapsedMs = performance.now() - started;
assert.equal(store.listRuns("scale-check").length, threadCount);
assert.equal(store.health().ok, true);
assert.ok(elapsedMs < 5000, `bounded 2,000-run validation/import exceeded 5 seconds: ${elapsedMs.toFixed(1)}ms`);
store.close();

const oversized = structuredClone(workspace);
oversized.threads.push({ ...workspace.threads[0], id: "oversized-2001", events: [{ ...workspace.threads[0].events[0], id: "oversized-event-2001" }] });
assert.throws(() => validateWorkspace(oversized), /exceeds 2000 threads/);

console.log(`check passed: 2,000-run workspace validated and imported in ${elapsedMs.toFixed(1)}ms; oversized state fails closed`);
