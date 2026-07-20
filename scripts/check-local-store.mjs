import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

import { createReviewDecision, evidenceIdentity, reviewDecisionKey, reviewDecisionMatches } from "../public/shared/review-contract.js";
import { loadProofBundle } from "../src/proof/bundle.js";
import { runProof } from "../src/proof/run.js";
import { loadStoredSource } from "../src/proof/stored.js";
import { localStoreMigrations, openLocalStore, restoreLocalStore } from "../src/storage/local-store.js";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-store-"));
const stateFile = path.join(temporaryRoot, "state", "halba.sqlite");
const backupFile = path.join(temporaryRoot, "backups", "halba.sqlite");
const restoredFile = path.join(temporaryRoot, "restored", "halba.sqlite");
const legacyFile = path.join(temporaryRoot, "legacy-v1.sqlite");
const tamperedFile = path.join(temporaryRoot, "tampered-halba.sqlite");

try {
  const workspaceText = await readFile(new URL("../data/demo/workspace.json", import.meta.url), "utf8");
  const workspace = JSON.parse(workspaceText);
  const loadedBundle = await loadProofBundle();
  const recordedProof = await runProof({ mode: "recorded" });
  const proofBundle = {
    id: loadedBundle.definition.id,
    title: loadedBundle.definition.title,
    generatedAt: loadedBundle.definition.generatedAt,
    definition: loadedBundle.definition,
    sources: loadedBundle.sources.map((source) => ({
      path: source.path,
      kind: source.kind,
      label: source.label,
      sha256: source.sha256,
      lineCount: source.lineCount,
      byteCount: source.bytes
    }))
  };
  const sourceDigest = createHash("sha256").update(workspaceText).digest("hex");
  const store = await openLocalStore(stateFile);
  assert.equal(store.health().ok, true);
  assert.equal(store.health().schemaVersion, 3);
  assert.equal(store.health().ledger.entries, 0);
  assert.equal(store.health().ledger.signed, false);
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600, "state database must be private to the operator");

  const first = store.importWorkspace(workspace, {
    adapter: "codex-proof",
    sourceRef: "public-safe-fixture",
    sourceDigest,
    importedAt: "2026-07-17T10:00:00.000Z",
    receiptId: "receipt-1",
    proofBundle,
    sourceRoot: "data/demo",
    receiptRetention: 2
  });
  assert.equal(first.counts.runs, 4);
  assert.equal(first.counts.proofSources, 6);
  assert.equal(store.getWorkspace("build-week").threads.length, 4);
  assert.equal(store.listRuns("build-week").length, 4);
  assert.equal(store.getProofBundle(proofBundle.id).sources.length, 6);
  assert.equal(store.listProofSources(proofBundle.id).every((source) => source.sha256.length === 64), true);

  const proofThread = workspace.threads.find((thread) => thread.proofBundleId === proofBundle.id);
  const finding = recordedProof.findings.find((item) => item.claimId === "deployed");
  const citationFinding = recordedProof.findings.find((item) => item.citations.some((citation) => citation.valid));
  const scope = { workspaceId: "build-week", threadId: proofThread.id, bundleId: proofBundle.id, claimId: finding.claimId };
  const decision = createReviewDecision({ ...scope, finding, status: "approved", updatedAt: "2026-07-17T10:05:00.000Z" });
  store.saveReviewDecision(decision);
  const savedDecision = store.getReviewDecision(scope);
  assert.equal(reviewDecisionMatches(savedDecision, scope, evidenceIdentity(finding)), true);
  const changedFinding = structuredClone(finding);
  changedFinding.claim = `${changedFinding.claim} Changed.`;
  assert.equal(reviewDecisionMatches(savedDecision, scope, evidenceIdentity(changedFinding)), false);
  const wrongRunDecision = { ...decision, threadId: workspace.threads[1].id };
  assert.throws(() => store.saveReviewDecision(wrongRunDecision), /bundle is not attached/);
  const revisedDecision = { ...decision, status: "more-proof", note: "The prior approval needs another receipt.", updatedAt: "2026-07-17T10:06:00.000Z" };
  store.saveReviewDecision(revisedDecision);
  assert.deepEqual(store.listReviewDecisionEvents(scope).map((event) => [event.action, event.status]), [
    ["set", "approved"],
    ["set", "more-proof"]
  ]);
  assert.equal(store.getReviewDecision(scope).status, "more-proof");
  assert.throws(() => store.saveReviewDecision({ ...revisedDecision, status: "rejected" }), /timestamp is already used/);
  await checkTransactionFaultAtomicity({ workspace, proofBundle, sourceDigest, decision, revisedDecision });

  for (const [index, importedAt] of ["2026-07-17T10:10:00.000Z", "2026-07-17T10:20:00.000Z"].entries()) {
    store.importWorkspace(workspace, {
      adapter: "codex-proof",
      sourceRef: "public-safe-fixture",
      sourceDigest,
      importedAt,
      receiptId: `receipt-${index + 2}`,
      proofBundle,
      sourceRoot: "data/demo",
      receiptRetention: 2
    });
  }
  assert.deepEqual(store.listImportReceipts("build-week").map((receipt) => receipt.id), ["receipt-3", "receipt-2"]);
  store.importWorkspace(workspace, {
    adapter: "codex-proof",
    sourceRef: "public-safe-fixture",
    sourceDigest,
    importedAt: "2026-07-17T10:20:00.000Z",
    receiptId: "receipt-3",
    proofBundle,
    sourceRoot: "data/demo",
    receiptRetention: 2
  });
  assert.equal(store.listImportReceipts("build-week").length, 2, "repeated imports must be idempotent");
  assert.equal(store.listWorkspaceImportEvents("build-week").length, 3, "idempotent retries must not duplicate import history");
  assert.equal(store.listTrustLedger().length, 5, "idempotent retries must not duplicate the trust ledger");

  const changedBundle = structuredClone(proofBundle);
  changedBundle.title = `${changedBundle.title} changed`;
  assert.throws(() => store.importWorkspace(workspace, {
    adapter: "codex-proof",
    sourceRef: "public-safe-fixture",
    sourceDigest,
    importedAt: "2026-07-17T10:30:00.000Z",
    receiptId: "mutable-bundle",
    proofBundle: changedBundle,
    sourceRoot: "data/demo"
  }), /proof bundle id is immutable/);
  assert.equal(store.getProofBundle(proofBundle.id).title, proofBundle.title);
  assert.equal(store.listProofBundleRevisions(proofBundle.id).length, 1);

  const reducedWorkspace = structuredClone(workspace);
  reducedWorkspace.threads = reducedWorkspace.threads.slice(0, 3);
  store.importWorkspace(reducedWorkspace, {
    adapter: "run-manifest-v1",
    sourceRef: "reduced-workspace",
    sourceDigest,
    importedAt: "2026-07-17T10:40:00.000Z",
    receiptId: "receipt-reduced",
    receiptRetention: 2
  });
  assert.equal(store.getWorkspace("build-week").threads.length, 3);
  assert.equal(store.listRuns("build-week").length, 3, "run projection must exactly match the canonical workspace document");
  assert.equal(store.verifyTrustLedger().ok, true);
  assert.equal(store.listTrustLedger("build-week").length, 6);
  assert.throws(() => store.importWorkspace(reducedWorkspace, {
    adapter: "changed-adapter",
    sourceRef: "reused-retained-history",
    sourceDigest,
    importedAt: "2026-07-17T10:50:00.000Z",
    receiptId: "receipt-2",
    receiptRetention: 2
  }), /import receipt id is immutable/, "retention must not make historical receipt ids reusable");

  await checkStaleReceiptReplay({ workspace, sourceDigest });

  const unsafeBundle = structuredClone(proofBundle);
  unsafeBundle.id = "unsafe-bundle";
  unsafeBundle.sources[0].path = "../private.txt";
  const unsafeWorkspace = structuredClone(workspace);
  unsafeWorkspace.threads[0].proofBundleId = unsafeBundle.id;
  assert.throws(() => store.importWorkspace(unsafeWorkspace, {
    adapter: "fixture",
    sourceDigest,
    receiptId: "unsafe-source",
    proofBundle: unsafeBundle
  }), /safe relative path/);

  const invalid = structuredClone(workspace);
  invalid.threads[0].agentId = "missing-agent";
  assert.throws(() => store.importWorkspace(invalid, { adapter: "codex-proof", sourceDigest, receiptId: "rejected" }), /unknown agent/);
  assert.equal(store.listImportReceipts("build-week").length, 2, "rejected imports must not partially write state");
  const trustPackSnapshot = store.exportTrustPackSnapshot("build-week");
  assert.equal(trustPackSnapshot.ledger.length, 6);
  assert.equal(trustPackSnapshot.proofs.length, 1);
  assert.equal(trustPackSnapshot.proofs[0].sources.length, 6);
  assert.equal(Buffer.from(trustPackSnapshot.proofs[0].sources[0].data, "base64").length, trustPackSnapshot.proofs[0].sources[0].byteCount);

  await store.backupTo(backupFile);
  assert.equal((await stat(backupFile)).mode & 0o777, 0o600, "state backup must be private to the operator");
  store.close();
  await restoreLocalStore(backupFile, restoredFile);
  const restored = await openLocalStore(restoredFile);
  assert.equal(restored.health().ok, true);
  assert.equal(restored.verifyTrustLedger().ok, true);
  assert.equal(restored.listTrustLedger("build-week").length, 6, "backup and restore must preserve the complete ledger");
  assert.equal((await stat(restoredFile)).mode & 0o777, 0o600, "restored state must be private to the operator");
  assert.equal(restored.getWorkspace("build-week").threads.length, 3);
  assert.equal(restored.listRuns("build-week").length, 3);
  assert.equal(reviewDecisionMatches(restored.getReviewDecision(scope), scope, evidenceIdentity(finding)), true);
  assert.deepEqual(restored.listImportReceipts("build-week").map((receipt) => receipt.id), ["receipt-reduced", "receipt-3"]);
  assert.deepEqual(restored.listReviewDecisionEvents(scope).map((event) => event.status), ["approved", "more-proof"]);
  const citation = citationFinding.citations.find((item) => item.valid);
  const restoredRecord = restored.getProofBundleRecord(proofBundle.id);
  const restoredSource = await loadStoredSource(
    { ...restoredRecord, sourceRoot: path.join(temporaryRoot, "deleted-original-root") },
    citation.path,
    { startLine: citation.startLine, endLine: citation.endLine }
  );
  assert.equal(restoredSource.sha256, citation.sourceSha256, "restored SQLite backup must carry exact source bytes without the original root");
  restored.close();

  await copyFile(backupFile, tamperedFile);
  const tamperedDatabase = new DatabaseSync(tamperedFile);
  tamperedDatabase.prepare("UPDATE trust_ledger SET payload_json = ? WHERE sequence = 1").run('{"tampered":true}');
  tamperedDatabase.close();
  const tamperedStore = await openLocalStore(tamperedFile);
  assert.equal(tamperedStore.verifyTrustLedger().ok, false, "changed ledger payload must be detected");
  assert.equal(tamperedStore.health().ok, false, "ledger tampering must make local health fail closed");
  tamperedStore.close();

  await checkLegacyMigration({ legacyFile, workspace, proofBundle, decision, sourceDigest });

  console.log("check passed: SQLite v1 migrates to immutable evidence and append-only history; canonical imports, private backups, and restore remain atomic");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function checkStaleReceiptReplay({ workspace, sourceDigest }) {
  const replayStore = await openLocalStore(":memory:");
  try {
    const newerWorkspace = structuredClone(workspace);
    newerWorkspace.threads = newerWorkspace.threads.slice(0, 3);
    const newerSourceDigest = createHash("sha256").update(JSON.stringify(newerWorkspace)).digest("hex");
    const oldImport = {
      adapter: "stale-replay-fixture",
      sourceRef: "old-workspace.json",
      sourceDigest,
      importedAt: "2026-07-17T11:00:00.000Z",
      receiptId: "stale-replay-old"
    };

    const oldResult = replayStore.importWorkspace(workspace, oldImport);
    assert.equal(oldResult.unchanged, false);
    const newerResult = replayStore.importWorkspace(newerWorkspace, {
      adapter: "stale-replay-fixture",
      sourceRef: "newer-workspace.json",
      sourceDigest: newerSourceDigest,
      importedAt: "2026-07-17T11:10:00.000Z",
      receiptId: "stale-replay-newer"
    });
    assert.equal(newerResult.unchanged, false);
    assert.equal(replayStore.getWorkspace("build-week").threads.length, 3);
    assert.equal(replayStore.listRuns("build-week").length, 3);

    const workspaceBeforeReplay = replayStore.getWorkspace("build-week");
    const runsBeforeReplay = replayStore.listRuns("build-week");
    const eventsBeforeReplay = replayStore.listWorkspaceImportEvents("build-week");
    const receiptsBeforeReplay = replayStore.listImportReceipts("build-week");
    const replay = replayStore.importWorkspace(workspace, oldImport);

    assert.equal(replay.unchanged, true, "an exact old receipt replay must report unchanged");
    assert.equal(replay.receiptId, oldResult.receiptId);
    assert.deepEqual(replay.counts, oldResult.counts);
    assert.deepEqual(replayStore.getWorkspace("build-week"), workspaceBeforeReplay, "an old receipt replay must not regress the canonical workspace");
    assert.deepEqual(replayStore.listRuns("build-week"), runsBeforeReplay, "an old receipt replay must not regress the run projection");
    assert.deepEqual(replayStore.listWorkspaceImportEvents("build-week"), eventsBeforeReplay, "an old receipt replay must not append duplicate import history");
    assert.deepEqual(replayStore.listImportReceipts("build-week"), receiptsBeforeReplay, "an old receipt replay must not change retained receipts");
    assert.equal(eventsBeforeReplay.length, 2);
    assert.equal(receiptsBeforeReplay.length, 2);
  } finally {
    replayStore.close();
  }
}

async function checkTransactionFaultAtomicity({ workspace, proofBundle, sourceDigest, decision, revisedDecision }) {
  const importOptions = {
    adapter: "fault-injection-fixture",
    sourceRef: "fault-injection-workspace.json",
    sourceDigest,
    importedAt: "2026-07-17T12:00:00.000Z",
    receiptId: "fault-injection-import",
    proofBundle,
    sourceRoot: "data/demo"
  };
  const scope = {
    workspaceId: decision.workspaceId,
    threadId: decision.threadId,
    bundleId: decision.bundleId,
    claimId: decision.claimId
  };
  const stages = {
    import: ["import.after_projection", "import.after_receipt", "import.after_history", "import.after_ledger"],
    decisionSet: ["decision_set.after_history", "decision_set.after_projection", "decision_set.after_ledger"],
    decisionUpdate: ["decision_set.after_history", "decision_set.after_projection", "decision_set.after_ledger"],
    decisionDelete: ["decision_delete.after_history", "decision_delete.after_projection", "decision_delete.after_ledger"]
  };

  for (const stage of stages.import) {
    await assertAtomicRollback(stage, {
      setup() {},
      mutate: (store) => store.importWorkspace(workspace, importOptions),
      workspaceId: workspace.workspace.id,
      bundleId: proofBundle.id,
      scope
    });
  }
  for (const stage of stages.decisionSet) {
    await assertAtomicRollback(stage, {
      setup: (store) => store.importWorkspace(workspace, importOptions),
      mutate: (store) => store.saveReviewDecision(decision),
      workspaceId: workspace.workspace.id,
      bundleId: proofBundle.id,
      scope
    });
  }
  for (const stage of stages.decisionUpdate) {
    await assertAtomicRollback(stage, {
      setup: (store) => {
        store.importWorkspace(workspace, importOptions);
        store.saveReviewDecision(decision);
      },
      mutate: (store) => store.saveReviewDecision(revisedDecision),
      workspaceId: workspace.workspace.id,
      bundleId: proofBundle.id,
      scope
    });
  }
  for (const stage of stages.decisionDelete) {
    await assertAtomicRollback(stage, {
      setup: (store) => {
        store.importWorkspace(workspace, importOptions);
        store.saveReviewDecision(revisedDecision);
      },
      mutate: (store) => store.deleteReviewDecision(scope),
      workspaceId: workspace.workspace.id,
      bundleId: proofBundle.id,
      scope
    });
  }
}

async function assertAtomicRollback(stage, { setup, mutate, workspaceId, bundleId, scope }) {
  let armed = false;
  let hits = 0;
  const store = await openLocalStore(":memory:", {
    testFaultInjector(point) {
      if (!armed || point !== stage) return;
      armed = false;
      hits += 1;
      throw new Error(`forced test fault at ${stage}`);
    }
  });
  try {
    setup(store);
    const before = atomicStateSnapshot(store, { workspaceId, bundleId, scope });
    armed = true;
    assert.throws(() => mutate(store), new RegExp(`forced test fault at ${stage.replace(".", "\\.")}`));
    assert.equal(hits, 1, `${stage} must be reached exactly once`);
    assert.deepEqual(
      atomicStateSnapshot(store, { workspaceId, bundleId, scope }),
      before,
      `${stage} must roll back projections, histories, proof records, receipts, and ledger together`
    );
  } finally {
    store.close();
  }
}

function atomicStateSnapshot(store, { workspaceId, bundleId, scope }) {
  return {
    workspace: store.getWorkspace(workspaceId),
    runs: store.listRuns(workspaceId),
    proofBundle: store.getProofBundle(bundleId),
    proofSources: store.listProofSources(bundleId),
    proofRevisions: store.listProofBundleRevisions(bundleId),
    receipts: store.listImportReceipts(workspaceId),
    importHistory: store.listWorkspaceImportEvents(workspaceId),
    decision: store.getReviewDecision(scope),
    decisionHistory: store.listReviewDecisionEvents(scope),
    ledger: store.listTrustLedger(),
    ledgerVerification: store.verifyTrustLedger()
  };
}

async function checkLegacyMigration({ legacyFile, workspace, proofBundle, decision, sourceDigest }) {
  const database = new DatabaseSync(legacyFile);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  database.exec(localStoreMigrations[0].sql);
  database.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (1, ?, ?)")
    .run(localStoreMigrations[0].name, "2026-07-17T09:00:00.000Z");
  database.prepare(`
    INSERT INTO workspace_documents(id, schema_version, name, document_json, imported_at, source_kind, source_ref, source_digest)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(workspace.workspace.id, workspace.schemaVersion, workspace.workspace.name, JSON.stringify(workspace), "2026-07-17T09:00:00.000Z", "legacy-v1", "legacy-fixture", sourceDigest);
  const proofThread = workspace.threads.find((thread) => thread.proofBundleId === proofBundle.id);
  database.prepare(`
    INSERT INTO runs(workspace_id, id, channel_id, agent_id, status, proof_bundle_id, updated_at, document_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(workspace.workspace.id, proofThread.id, proofThread.channelId, proofThread.agentId, proofThread.status, proofThread.proofBundleId, proofThread.updatedAt, JSON.stringify(proofThread));
  database.prepare(`
    INSERT INTO proof_bundles(id, workspace_id, thread_id, document_json, source_root, source_digest, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(proofBundle.id, workspace.workspace.id, proofThread.id, JSON.stringify(proofBundle), "data/demo", sourceDigest, "2026-07-17T09:00:00.000Z");
  const insertSource = database.prepare(`
    INSERT INTO proof_sources(bundle_id, path, kind, label, sha256, line_count, byte_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const source of proofBundle.sources) {
    insertSource.run(proofBundle.id, source.path, source.kind, source.label, source.sha256, source.lineCount, source.byteCount);
  }
  const key = reviewDecisionKey(decision);
  database.prepare(`
    INSERT INTO review_decisions(decision_key, schema_version, workspace_id, thread_id, bundle_id, claim_id, evidence_identity, status, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key, decision.schemaVersion, decision.workspaceId, decision.threadId, decision.bundleId, decision.claimId, decision.evidenceIdentity, decision.status, decision.note, decision.updatedAt);
  database.close();

  const migrated = await openLocalStore(legacyFile);
  assert.equal(migrated.health().schemaVersion, 3);
  assert.equal(migrated.verifyTrustLedger().ok, true);
  assert.equal(migrated.listTrustLedger(workspace.workspace.id).length, 2, "v1 history must backfill into the v3 trust ledger");
  assert.equal(migrated.listProofBundleRevisions(proofBundle.id).length, 1);
  assert.deepEqual(migrated.listReviewDecisionEvents(decision).map((event) => [event.status, event.origin]), [["approved", "migration-v2"]]);
  assert.deepEqual(migrated.listWorkspaceImportEvents(workspace.workspace.id).map((event) => event.receiptId), [`migration-v2:${workspace.workspace.id}`]);
  assert.equal(reviewDecisionMatches(migrated.getReviewDecision(decision), decision, decision.evidenceIdentity), true);
  migrated.close();
}
