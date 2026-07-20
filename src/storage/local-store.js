import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { chmod, copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { reviewDecisionKey, reviewDecisionStatuses } from "../../public/shared/review-contract.js";
import { validateWorkspace } from "../../public/shared/workspace-contract.js";

export const localStoreSchemaVersion = 3;
export const defaultStateFile = ".halba/halba.sqlite";
export const proofObjectLimits = Object.freeze({ sourceBytes: 4 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 });

export const localStoreMigrations = [{
  version: 1,
  name: "canonical-local-core",
  sql: `
    CREATE TABLE workspace_documents (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      name TEXT NOT NULL,
      document_json TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_ref TEXT,
      source_digest TEXT NOT NULL
    ) STRICT;

    CREATE TABLE runs (
      workspace_id TEXT NOT NULL,
      id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      proof_bundle_id TEXT,
      updated_at TEXT NOT NULL,
      document_json TEXT NOT NULL,
      PRIMARY KEY (workspace_id, id),
      FOREIGN KEY (workspace_id) REFERENCES workspace_documents(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX runs_attention_index ON runs(workspace_id, status, updated_at DESC);
    CREATE INDEX runs_proof_bundle_index ON runs(proof_bundle_id) WHERE proof_bundle_id IS NOT NULL;

    CREATE TABLE proof_bundles (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      document_json TEXT NOT NULL,
      source_root TEXT,
      source_digest TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id, thread_id) REFERENCES runs(workspace_id, id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE proof_sources (
      bundle_id TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      line_count INTEGER NOT NULL,
      byte_count INTEGER NOT NULL,
      PRIMARY KEY (bundle_id, path),
      FOREIGN KEY (bundle_id) REFERENCES proof_bundles(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX proof_source_hash_index ON proof_sources(sha256);

    CREATE TABLE review_decisions (
      decision_key TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      workspace_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      bundle_id TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      evidence_identity TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id, thread_id) REFERENCES runs(workspace_id, id) ON DELETE CASCADE,
      FOREIGN KEY (bundle_id) REFERENCES proof_bundles(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX review_attention_index ON review_decisions(workspace_id, thread_id, bundle_id, status);

    CREATE TABLE import_receipts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      adapter TEXT NOT NULL,
      source_ref TEXT,
      source_digest TEXT NOT NULL,
      status TEXT NOT NULL,
      counts_json TEXT NOT NULL,
      warnings_json TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspace_documents(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX import_receipt_history_index ON import_receipts(workspace_id, imported_at DESC);
  `
}, {
  version: 2,
  name: "immutable-evidence-history",
  sql: `
    CREATE TABLE proof_bundle_revisions (
      revision_digest TEXT PRIMARY KEY,
      bundle_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      document_json TEXT NOT NULL,
      source_root TEXT,
      source_digest TEXT NOT NULL,
      imported_at TEXT NOT NULL
    ) STRICT;

    CREATE UNIQUE INDEX proof_bundle_identity_revision ON proof_bundle_revisions(bundle_id, revision_digest);

    CREATE TABLE proof_source_objects (
      sha256 TEXT PRIMARY KEY,
      bytes BLOB NOT NULL,
      byte_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE proof_revision_sources (
      revision_digest TEXT NOT NULL,
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      PRIMARY KEY (revision_digest, path),
      FOREIGN KEY (revision_digest) REFERENCES proof_bundle_revisions(revision_digest) ON DELETE CASCADE,
      FOREIGN KEY (sha256) REFERENCES proof_source_objects(sha256)
    ) STRICT;

    CREATE INDEX proof_revision_source_hash ON proof_revision_sources(sha256);

    CREATE TABLE workspace_import_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      adapter TEXT NOT NULL,
      source_ref TEXT,
      source_digest TEXT NOT NULL,
      status TEXT NOT NULL,
      counts_json TEXT NOT NULL,
      warnings_json TEXT NOT NULL,
      document_json TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX workspace_import_event_history ON workspace_import_events(workspace_id, imported_at, event_id);

    CREATE TABLE review_decision_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL CHECK (action IN ('set', 'deleted')),
      decision_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      workspace_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      bundle_id TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      evidence_identity TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      origin TEXT NOT NULL
    ) STRICT;

    CREATE INDEX review_decision_event_history ON review_decision_events(decision_key, event_id);
    CREATE INDEX review_decision_event_workspace ON review_decision_events(workspace_id, recorded_at, event_id);
  `,
  after(database) {
    const insertRevision = database.prepare(`
      INSERT OR IGNORE INTO proof_bundle_revisions(
        revision_digest, bundle_id, workspace_id, thread_id, document_json, source_root, source_digest, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of database.prepare("SELECT * FROM proof_bundles").all()) {
      const revisionDigest = documentDigest(row.document_json);
      insertRevision.run(revisionDigest, row.id, row.workspace_id, row.thread_id, row.document_json, row.source_root, row.source_digest, row.imported_at);
      const bundle = JSON.parse(row.document_json);
      for (const source of bundle.sources || []) {
        try {
          const bytes = readVerifiedSourceBytes(row.source_root, source);
          insertProofObject(database, revisionDigest, source, bytes, row.imported_at);
        } catch {
          // Legacy v1 state may outlive its external source root. Keep metadata readable;
          // the record remains non-portable until that evidence is imported again.
        }
      }
    }

    const insertDecisionEvent = database.prepare(`
      INSERT INTO review_decision_events(
        action, decision_key, schema_version, workspace_id, thread_id, bundle_id, claim_id,
        evidence_identity, status, note, updated_at, recorded_at, origin
      ) VALUES ('set', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'migration-v2')
    `);
    for (const row of database.prepare("SELECT * FROM review_decisions").all()) {
      insertDecisionEvent.run(
        row.decision_key, row.schema_version, row.workspace_id, row.thread_id, row.bundle_id,
        row.claim_id, row.evidence_identity, row.status, row.note, row.updated_at, row.updated_at
      );
    }

    const insertImportEvent = database.prepare(`
      INSERT INTO workspace_import_events(
        receipt_id, workspace_id, adapter, source_ref, source_digest, status,
        counts_json, warnings_json, document_json, imported_at, recorded_at
      ) VALUES (?, ?, ?, ?, ?, 'accepted', ?, '[]', ?, ?, ?)
    `);
    for (const row of database.prepare("SELECT * FROM workspace_documents").all()) {
      const workspace = JSON.parse(row.document_json);
      const counts = workspaceCounts(workspace, null);
      insertImportEvent.run(
        `migration-v2:${row.id}`, row.id, row.source_kind, row.source_ref, row.source_digest,
        JSON.stringify(counts), row.document_json, row.imported_at, row.imported_at
      );
    }
  }
}, {
  version: 3,
  name: "hash-linked-trust-ledger",
  sql: `
    CREATE TABLE trust_ledger (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('workspace_import', 'decision_set', 'decision_deleted')),
      event_ref TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      previous_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL UNIQUE,
      recorded_at TEXT NOT NULL,
      UNIQUE(event_type, event_ref)
    ) STRICT;

    CREATE INDEX trust_ledger_workspace_sequence ON trust_ledger(workspace_id, sequence);
  `,
  after(database) {
    const events = [];
    for (const row of database.prepare("SELECT * FROM workspace_import_events").all()) {
      events.push({
        order: row.event_id,
        recordedAt: row.recorded_at,
        workspaceId: row.workspace_id,
        eventType: "workspace_import",
        eventRef: row.receipt_id,
        payload: importLedgerPayload(row)
      });
    }
    for (const row of database.prepare("SELECT * FROM review_decision_events").all()) {
      events.push({
        order: row.event_id,
        recordedAt: row.recorded_at,
        workspaceId: row.workspace_id,
        eventType: row.action === "set" ? "decision_set" : "decision_deleted",
        eventRef: `decision:${row.event_id}`,
        payload: decisionLedgerPayload(row)
      });
    }
    events.sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
      || left.eventType.localeCompare(right.eventType) || left.order - right.order);
    for (const event of events) appendLedgerEntry(database, event);
  }
}];

export async function openLocalStore(file = process.env.HALBA_STATE_FILE || defaultStateFile, { testFaultInjector = null } = {}) {
  if (testFaultInjector !== null && typeof testFaultInjector !== "function") throw new Error("test fault injector must be a function");
  const resolved = file === ":memory:" ? file : path.resolve(file);
  if (resolved !== ":memory:") await preparePrivateDirectory(path.dirname(resolved));
  const database = new DatabaseSync(resolved);
  const store = new LocalStore(database, resolved, { testFaultInjector });
  if (resolved !== ":memory:") await protectSqliteFiles(resolved);
  return store;
}

export async function openLocalStoreReadOnly(file = process.env.HALBA_STATE_FILE || defaultStateFile) {
  const resolved = path.resolve(file);
  const fileStat = await stat(resolved);
  if (!fileStat.isFile()) throw new Error("Halba state is not a regular file");
  const database = new DatabaseSync(resolved, { readOnly: true });
  return new LocalStore(database, resolved, { readOnly: true });
}

export async function restoreLocalStore(backupFile, targetFile, { overwrite = false } = {}) {
  const source = path.resolve(backupFile);
  const target = path.resolve(targetFile);
  await stat(source);
  if (!overwrite) {
    try {
      await stat(target);
      throw new Error("restore target already exists");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  await preparePrivateDirectory(path.dirname(target));
  await Promise.all([
    rm(`${target}-wal`, { force: true }),
    rm(`${target}-shm`, { force: true })
  ]);
  await copyFile(source, target);
  await chmod(target, 0o600);
  const store = await openLocalStore(target);
  store.close();
  return target;
}

export class LocalStore {
  #testFaultInjector;

  constructor(database, file, { readOnly = false, testFaultInjector = null } = {}) {
    this.database = database;
    this.file = file;
    this.readOnly = readOnly;
    this.#testFaultInjector = testFaultInjector;
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (!readOnly && file !== ":memory:") this.database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    if (readOnly) this.#assertCurrentSchema();
    else this.#migrate();
  }

  #assertCurrentSchema() {
    const schemaTable = this.database.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
    if (!schemaTable) throw new Error("Halba state is not initialized");
    const latest = this.database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
    if (latest !== localStoreSchemaVersion) throw new Error(`Halba state schema ${latest} requires migration before read-only preview`);
  }

  #migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const applied = new Set(this.database.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
    for (const migration of localStoreMigrations) {
      if (applied.has(migration.version)) continue;
      this.#transaction(() => {
        this.database.exec(migration.sql);
        migration.after?.(this.database);
        this.database.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, new Date().toISOString());
      });
    }
    const latest = this.database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
    if (latest !== localStoreSchemaVersion) throw new Error(`unsupported Halba state schema ${latest}`);
  }

  #transaction(operation) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  #injectTestFault(stage) {
    this.#testFaultInjector?.(stage);
  }

  importWorkspace(workspaceInput, {
    adapter,
    sourceRef = null,
    sourceDigest,
    importedAt = new Date().toISOString(),
    proofBundle = null,
    sourceRoot = null,
    receiptId = `${workspaceInput?.workspace?.id || "workspace"}-${Date.parse(importedAt)}`,
    status = "accepted",
    warnings = [],
    receiptRetention = 50,
    expectedWorkspaceDigest = null
  }) {
    const workspace = validateWorkspace(structuredClone(workspaceInput));
    requireString(adapter, "adapter");
    requireDigest(sourceDigest, "workspace source digest");
    requireTimestamp(importedAt, "importedAt");
    requireString(receiptId, "receiptId");
    if (sourceRef !== null && typeof sourceRef !== "string") throw new Error("sourceRef must be a string or null");
    if (!["accepted", "degraded"].includes(status)) throw new Error("import status must be accepted or degraded");
    if (!Number.isInteger(receiptRetention) || receiptRetention < 1 || receiptRetention > 1000) throw new Error("receipt retention must be between 1 and 1000");
    if (!Array.isArray(warnings) || warnings.some((warning) => typeof warning !== "string")) throw new Error("import warnings must be strings");
    if (expectedWorkspaceDigest !== null) requireDigest(expectedWorkspaceDigest, "expected workspace digest");
    const proofThread = proofBundle ? workspace.threads.find((thread) => thread.proofBundleId === proofBundle.id) : null;
    if (proofBundle && !proofThread) throw new Error("proof bundle is not referenced by this workspace");
    if (proofBundle) validateProofBundleRecord(proofBundle);

    const counts = workspaceCounts(workspace, proofBundle);
    const receiptValues = [
      receiptId, workspace.workspace.id, adapter, sourceRef, sourceDigest, status,
      JSON.stringify(counts), JSON.stringify(warnings), importedAt
    ];

    return this.#transaction(() => {
      const existingReceipt = this.#existingImportReceipt(receiptId);
      if (existingReceipt) {
        const proposedIdentity = [receiptId, workspace.workspace.id, adapter, sourceRef, sourceDigest, status, JSON.stringify(warnings), importedAt];
        const existingIdentity = [
          existingReceipt.id, existingReceipt.workspace_id, existingReceipt.adapter, existingReceipt.source_ref,
          existingReceipt.source_digest, existingReceipt.status, existingReceipt.warnings_json, existingReceipt.imported_at
        ];
        if (JSON.stringify(proposedIdentity) !== JSON.stringify(existingIdentity)) throw new Error("import receipt id is immutable");
        return { workspaceId: workspace.workspace.id, receiptId, counts: JSON.parse(existingReceipt.counts_json), unchanged: true };
      }
      if (expectedWorkspaceDigest !== null) {
        const currentDocument = this.database.prepare("SELECT document_json AS documentJson FROM workspace_documents WHERE id = ?").get(workspace.workspace.id)?.documentJson || "null";
        if (documentDigest(currentDocument) !== expectedWorkspaceDigest) throw new Error("import plan state precondition changed");
      }
      this.database.prepare(`
        INSERT INTO workspace_documents(id, schema_version, name, document_json, imported_at, source_kind, source_ref, source_digest)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          schema_version = excluded.schema_version,
          name = excluded.name,
          document_json = excluded.document_json,
          imported_at = excluded.imported_at,
          source_kind = excluded.source_kind,
          source_ref = excluded.source_ref,
          source_digest = excluded.source_digest
      `).run(workspace.workspace.id, workspace.schemaVersion, workspace.workspace.name, JSON.stringify(workspace), importedAt, adapter, sourceRef, sourceDigest);

      const upsertRun = this.database.prepare(`
        INSERT INTO runs(workspace_id, id, channel_id, agent_id, status, proof_bundle_id, updated_at, document_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, id) DO UPDATE SET
          channel_id = excluded.channel_id,
          agent_id = excluded.agent_id,
          status = excluded.status,
          proof_bundle_id = excluded.proof_bundle_id,
          updated_at = excluded.updated_at,
          document_json = excluded.document_json
      `);
      for (const thread of workspace.threads) {
        upsertRun.run(workspace.workspace.id, thread.id, thread.channelId, thread.agentId, thread.status, thread.proofBundleId, thread.updatedAt, JSON.stringify(thread));
      }

      const runIds = workspace.threads.map((thread) => thread.id);
      if (runIds.length) {
        this.database.prepare(`DELETE FROM runs WHERE workspace_id = ? AND id NOT IN (${runIds.map(() => "?").join(", ")})`)
          .run(workspace.workspace.id, ...runIds);
      } else {
        this.database.prepare("DELETE FROM runs WHERE workspace_id = ?").run(workspace.workspace.id);
      }

      if (proofBundle) this.#storeProofBundle(proofBundle, workspace.workspace.id, proofThread.id, sourceRoot, sourceDigest, importedAt);
      this.#injectTestFault("import.after_projection");

      this.database.prepare(`
        INSERT INTO import_receipts(id, workspace_id, adapter, source_ref, source_digest, status, counts_json, warnings_json, imported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(...receiptValues);
      this.#injectTestFault("import.after_receipt");
      const recordedAt = new Date().toISOString();
      const importEvent = this.database.prepare(`
        INSERT INTO workspace_import_events(
          receipt_id, workspace_id, adapter, source_ref, source_digest, status,
          counts_json, warnings_json, document_json, imported_at, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(receipt_id) DO NOTHING
      `).run(...receiptValues.slice(0, 8), JSON.stringify(workspace), importedAt, recordedAt);
      if (importEvent.changes !== 1) throw new Error("workspace import event was not recorded");
      this.#injectTestFault("import.after_history");
      appendLedgerEntry(this.database, {
        workspaceId: workspace.workspace.id,
        eventType: "workspace_import",
        eventRef: receiptId,
        recordedAt,
        payload: {
          receiptId,
          workspaceId: workspace.workspace.id,
          adapter,
          sourceRef,
          sourceDigest,
          status,
          counts,
          warnings,
          workspaceDigest: documentDigest(JSON.stringify(workspace)),
          importedAt
        }
      });
      this.#injectTestFault("import.after_ledger");
      this.database.prepare(`
        DELETE FROM import_receipts
        WHERE workspace_id = ? AND id NOT IN (
          SELECT id FROM import_receipts WHERE workspace_id = ? ORDER BY imported_at DESC, id DESC LIMIT ?
        )
      `).run(workspace.workspace.id, workspace.workspace.id, receiptRetention);
      return { workspaceId: workspace.workspace.id, receiptId, counts, unchanged: false };
    });
  }

  #existingImportReceipt(receiptId) {
    return this.database.prepare("SELECT * FROM import_receipts WHERE id = ?").get(receiptId)
      || this.database.prepare(`
        SELECT receipt_id AS id, workspace_id, adapter, source_ref, source_digest, status,
               counts_json, warnings_json, imported_at
        FROM workspace_import_events WHERE receipt_id = ?
      `).get(receiptId);
  }

  #storeProofBundle(proofBundle, workspaceId, threadId, sourceRoot, sourceDigest, importedAt) {
    const documentJson = JSON.stringify(proofBundle);
    const revisionDigest = documentDigest(documentJson);
    const owner = this.database.prepare("SELECT workspace_id, thread_id, document_json, source_root FROM proof_bundles WHERE id = ?").get(proofBundle.id);
    if (owner && (owner.workspace_id !== workspaceId || owner.thread_id !== threadId)) {
      throw new Error("proof bundle id already belongs to another workspace run");
    }
    if (owner && documentDigest(owner.document_json) !== revisionDigest) {
      throw new Error("proof bundle id is immutable; use a new id for changed evidence");
    }
    if (owner) {
      const storedCount = this.database.prepare("SELECT COUNT(*) AS count FROM proof_revision_sources WHERE revision_digest = ?")
        .get(revisionDigest).count;
      if (storedCount === proofBundle.sources.length) return;
    }
    const sourceObjects = proofBundle.sources.map((source) => ({ source, bytes: readVerifiedSourceBytes(sourceRoot, source) }));
    const totalBytes = sourceObjects.reduce((sum, item) => sum + item.bytes.length, 0);
    if (totalBytes > proofObjectLimits.totalBytes) throw new Error(`proof bundle source bytes exceed ${proofObjectLimits.totalBytes}`);
    if (owner) {
      for (const { source, bytes } of sourceObjects) insertProofObject(this.database, revisionDigest, source, bytes, importedAt);
      return;
    }
    this.database.prepare(`
      INSERT INTO proof_bundles(id, workspace_id, thread_id, document_json, source_root, source_digest, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(proofBundle.id, workspaceId, threadId, documentJson, sourceRoot, sourceDigest, importedAt);
    this.database.prepare(`
      INSERT INTO proof_bundle_revisions(
        revision_digest, bundle_id, workspace_id, thread_id, document_json, source_root, source_digest, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(revisionDigest, proofBundle.id, workspaceId, threadId, documentJson, sourceRoot, sourceDigest, importedAt);
    const insertSource = this.database.prepare(`
      INSERT INTO proof_sources(bundle_id, path, kind, label, sha256, line_count, byte_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const source of proofBundle.sources) {
      insertSource.run(proofBundle.id, source.path, source.kind, source.label, source.sha256, source.lineCount, source.byteCount);
    }
    for (const { source, bytes } of sourceObjects) insertProofObject(this.database, revisionDigest, source, bytes, importedAt);
  }

  getWorkspace(workspaceId) {
    const row = this.database.prepare("SELECT document_json FROM workspace_documents WHERE id = ?").get(workspaceId);
    return row ? JSON.parse(row.document_json) : null;
  }

  listWorkspaces() {
    return this.database.prepare("SELECT id, name, imported_at AS importedAt, source_kind AS sourceKind, source_digest AS sourceDigest FROM workspace_documents ORDER BY imported_at DESC, id").all();
  }

  listRuns(workspaceId) {
    return this.database.prepare("SELECT document_json FROM runs WHERE workspace_id = ? ORDER BY updated_at DESC, id").all(workspaceId).map((row) => JSON.parse(row.document_json));
  }

  getProofBundle(bundleId) {
    const row = this.database.prepare("SELECT document_json FROM proof_bundles WHERE id = ?").get(bundleId);
    return row ? JSON.parse(row.document_json) : null;
  }

  getProofBundleRecord(bundleId) {
    const row = this.database.prepare("SELECT * FROM proof_bundles WHERE id = ?").get(bundleId);
    if (!row) return null;
    const portableSourceCount = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM proof_revision_sources
      WHERE revision_digest = ?
    `).get(documentDigest(row.document_json)).count;
    return {
      bundle: JSON.parse(row.document_json),
      workspaceId: row.workspace_id,
      threadId: row.thread_id,
      sourceRoot: row.source_root,
      sourceDigest: row.source_digest,
      importedAt: row.imported_at,
      portableSourceCount,
      sourceObjectProvider: (sourcePath) => this.readProofSourceObject(bundleId, sourcePath)
    };
  }

  listProofBundles(workspaceId) {
    return this.database.prepare("SELECT id, thread_id AS threadId, source_digest AS sourceDigest, imported_at AS importedAt FROM proof_bundles WHERE workspace_id = ? ORDER BY imported_at DESC, id").all(workspaceId);
  }

  listProofBundleRecords(workspaceId) {
    return this.database.prepare("SELECT id FROM proof_bundles WHERE workspace_id = ? ORDER BY imported_at DESC, id").all(workspaceId)
      .map((row) => this.getProofBundleRecord(row.id));
  }

  listProofSources(bundleId) {
    return this.database.prepare("SELECT path, kind, label, sha256, line_count AS lineCount, byte_count AS byteCount FROM proof_sources WHERE bundle_id = ? ORDER BY path").all(bundleId);
  }

  readProofSourceObject(bundleId, sourcePath) {
    const bundle = this.database.prepare("SELECT document_json FROM proof_bundles WHERE id = ?").get(bundleId);
    if (!bundle) return null;
    const object = this.database.prepare(`
      SELECT objects.bytes, objects.sha256, objects.byte_count AS byteCount
      FROM proof_revision_sources AS revision_sources
      JOIN proof_source_objects AS objects ON objects.sha256 = revision_sources.sha256
      WHERE revision_sources.revision_digest = ? AND revision_sources.path = ?
    `).get(documentDigest(bundle.document_json), sourcePath);
    return object ? { ...object, bytes: Buffer.from(object.bytes) } : null;
  }

  listProofBundleRevisions(bundleId) {
    return this.database.prepare(`
      SELECT revision_digest AS revisionDigest, bundle_id AS bundleId, workspace_id AS workspaceId,
             thread_id AS threadId, source_digest AS sourceDigest, imported_at AS importedAt
      FROM proof_bundle_revisions WHERE bundle_id = ? ORDER BY imported_at, revision_digest
    `).all(bundleId);
  }

  saveReviewDecision(decision) {
    const key = reviewDecisionKey(decision);
    if (decision.schemaVersion !== 1) throw new Error("unsupported review decision schema");
    if (!reviewDecisionStatuses.includes(decision.status)) throw new Error("review decision status is invalid");
    requireTimestamp(decision.updatedAt, "review decision timestamp");
    requireString(decision.evidenceIdentity, "review evidence identity");
    const bundleOwner = this.database.prepare("SELECT 1 AS found FROM proof_bundles WHERE id = ? AND workspace_id = ? AND thread_id = ?")
      .get(decision.bundleId, decision.workspaceId, decision.threadId);
    if (!bundleOwner) throw new Error("review decision bundle is not attached to its workspace run");
    const runRow = this.database.prepare("SELECT document_json FROM runs WHERE workspace_id = ? AND id = ?").get(decision.workspaceId, decision.threadId);
    const run = runRow ? JSON.parse(runRow.document_json) : null;
    if (run?.reviewEvidence?.[decision.claimId] !== decision.evidenceIdentity) {
      throw new Error("review decision evidence does not match the current run");
    }
    const values = decisionValues(key, decision);
    const existing = this.database.prepare("SELECT * FROM review_decisions WHERE decision_key = ?").get(key);
    if (existing) {
      if (Date.parse(existing.updated_at) > Date.parse(decision.updatedAt)) throw new Error("review decision timestamp cannot move backwards");
      if (existing.updated_at === decision.updatedAt) {
        const current = [
          existing.decision_key, existing.schema_version, existing.workspace_id, existing.thread_id,
          existing.bundle_id, existing.claim_id, existing.evidence_identity, existing.status, existing.note, existing.updated_at
        ];
        if (JSON.stringify(current) === JSON.stringify(values)) return key;
        throw new Error("review decision timestamp is already used by another state");
      }
    }
    this.#transaction(() => {
      const recordedAt = new Date().toISOString();
      const event = this.database.prepare(`
        INSERT INTO review_decision_events(
          action, decision_key, schema_version, workspace_id, thread_id, bundle_id, claim_id,
          evidence_identity, status, note, updated_at, recorded_at, origin
        ) VALUES ('set', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'operator')
      `).run(...values, recordedAt);
      this.#injectTestFault("decision_set.after_history");
      this.database.prepare(`
        INSERT INTO review_decisions(decision_key, schema_version, workspace_id, thread_id, bundle_id, claim_id, evidence_identity, status, note, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(decision_key) DO UPDATE SET
          schema_version = excluded.schema_version,
          evidence_identity = excluded.evidence_identity,
          status = excluded.status,
          note = excluded.note,
          updated_at = excluded.updated_at
      `).run(...values);
      this.#injectTestFault("decision_set.after_projection");
      appendLedgerEntry(this.database, {
        workspaceId: decision.workspaceId,
        eventType: "decision_set",
        eventRef: `decision:${event.lastInsertRowid}`,
        recordedAt,
        payload: {
          action: "set",
          decisionKey: key,
          schemaVersion: decision.schemaVersion,
          workspaceId: decision.workspaceId,
          threadId: decision.threadId,
          bundleId: decision.bundleId,
          claimId: decision.claimId,
          evidenceIdentity: decision.evidenceIdentity,
          status: decision.status,
          note: String(decision.note || ""),
          updatedAt: decision.updatedAt,
          origin: "operator"
        }
      });
      this.#injectTestFault("decision_set.after_ledger");
    });
    return key;
  }

  getReviewDecision(scope) {
    const row = this.database.prepare("SELECT * FROM review_decisions WHERE decision_key = ?").get(reviewDecisionKey(scope));
    return row ? {
      schemaVersion: row.schema_version,
      workspaceId: row.workspace_id,
      threadId: row.thread_id,
      bundleId: row.bundle_id,
      claimId: row.claim_id,
      evidenceIdentity: row.evidence_identity,
      status: row.status,
      note: row.note,
      updatedAt: row.updated_at
    } : null;
  }

  listReviewDecisions({ workspaceId, threadId, bundleId }) {
    return this.database.prepare(`
      SELECT * FROM review_decisions
      WHERE workspace_id = ? AND thread_id = ? AND bundle_id = ?
      ORDER BY updated_at, claim_id
    `).all(workspaceId, threadId, bundleId).map(decisionFromRow);
  }

  listWorkspaceReviewDecisions(workspaceId) {
    return this.database.prepare("SELECT * FROM review_decisions WHERE workspace_id = ? ORDER BY updated_at DESC, claim_id").all(workspaceId).map(decisionFromRow);
  }

  listReviewDecisionEvents(scope) {
    const key = reviewDecisionKey(scope);
    return this.database.prepare("SELECT * FROM review_decision_events WHERE decision_key = ? ORDER BY event_id")
      .all(key).map(decisionEventFromRow);
  }

  deleteReviewDecision(scope) {
    const key = reviewDecisionKey(scope);
    const existing = this.database.prepare("SELECT * FROM review_decisions WHERE decision_key = ?").get(key);
    if (!existing) return false;
    return this.#transaction(() => {
      const recordedAt = new Date().toISOString();
      const event = this.database.prepare(`
        INSERT INTO review_decision_events(
          action, decision_key, schema_version, workspace_id, thread_id, bundle_id, claim_id,
          evidence_identity, status, note, updated_at, recorded_at, origin
        ) VALUES ('deleted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'operator')
      `).run(
        existing.decision_key, existing.schema_version, existing.workspace_id, existing.thread_id,
        existing.bundle_id, existing.claim_id, existing.evidence_identity, existing.status,
        existing.note, existing.updated_at, recordedAt
      );
      this.#injectTestFault("decision_delete.after_history");
      const deleted = this.database.prepare("DELETE FROM review_decisions WHERE decision_key = ?").run(key).changes > 0;
      if (!deleted) throw new Error("review decision projection changed during delete");
      this.#injectTestFault("decision_delete.after_projection");
      appendLedgerEntry(this.database, {
        workspaceId: existing.workspace_id,
        eventType: "decision_deleted",
        eventRef: `decision:${event.lastInsertRowid}`,
        recordedAt,
        payload: {
          action: "deleted",
          decisionKey: existing.decision_key,
          schemaVersion: existing.schema_version,
          workspaceId: existing.workspace_id,
          threadId: existing.thread_id,
          bundleId: existing.bundle_id,
          claimId: existing.claim_id,
          evidenceIdentity: existing.evidence_identity,
          status: existing.status,
          note: existing.note,
          updatedAt: existing.updated_at,
          origin: "operator"
        }
      });
      this.#injectTestFault("decision_delete.after_ledger");
      return true;
    });
  }

  listWorkspaceImportEvents(workspaceId) {
    return this.database.prepare(`
      SELECT event_id AS eventId, receipt_id AS receiptId, workspace_id AS workspaceId,
             adapter, source_ref AS sourceRef, source_digest AS sourceDigest, status,
             counts_json AS countsJson, warnings_json AS warningsJson, imported_at AS importedAt,
             recorded_at AS recordedAt
      FROM workspace_import_events WHERE workspace_id = ? ORDER BY event_id
    `).all(workspaceId).map(({ countsJson, warningsJson, ...row }) => ({
      ...row,
      counts: JSON.parse(countsJson),
      warnings: JSON.parse(warningsJson)
    }));
  }

  listImportReceipts(workspaceId) {
    return this.database.prepare("SELECT * FROM import_receipts WHERE workspace_id = ? ORDER BY imported_at DESC, id DESC").all(workspaceId).map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      adapter: row.adapter,
      sourceRef: row.source_ref,
      sourceDigest: row.source_digest,
      status: row.status,
      counts: JSON.parse(row.counts_json),
      warnings: JSON.parse(row.warnings_json),
      importedAt: row.imported_at
    }));
  }

  listTrustLedger(workspaceId = null) {
    const rows = workspaceId === null
      ? this.database.prepare("SELECT * FROM trust_ledger ORDER BY sequence").all()
      : this.database.prepare("SELECT * FROM trust_ledger WHERE workspace_id = ? ORDER BY sequence").all(workspaceId);
    return rows.map(ledgerEntryFromRow);
  }

  verifyTrustLedger() {
    let entries;
    try {
      entries = this.listTrustLedger();
    } catch (error) {
      return {
        ok: false,
        algorithm: "sha256-canonical-json-v1",
        signed: false,
        entries: 0,
        headHash: null,
        errors: [`ledger payload is unreadable: ${error.message}`]
      };
    }
    let previousHash = ledgerGenesisHash;
    const errors = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const expectedSequence = index + 1;
      if (entry.sequence !== expectedSequence) errors.push(`sequence ${entry.sequence} should be ${expectedSequence}`);
      if (entry.previousHash !== previousHash) errors.push(`sequence ${entry.sequence} has a broken previous hash`);
      const payloadDigest = documentDigest(canonicalJson(entry.payload));
      if (payloadDigest !== entry.payloadDigest) errors.push(`sequence ${entry.sequence} payload digest changed`);
      const entryHash = ledgerHash(entry);
      if (entryHash !== entry.entryHash) errors.push(`sequence ${entry.sequence} entry hash changed`);
      previousHash = entry.entryHash;
    }
    return {
      ok: errors.length === 0,
      algorithm: "sha256-canonical-json-v1",
      signed: false,
      entries: entries.length,
      headHash: previousHash,
      errors
    };
  }

  exportTrustPackSnapshot(workspaceId) {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) throw new Error("trust pack workspace was not found");
    const ledgerVerification = this.verifyTrustLedger();
    if (!ledgerVerification.ok) throw new Error("trust pack export requires a valid local ledger");
    const decisions = this.database.prepare("SELECT * FROM review_decision_events WHERE workspace_id = ? ORDER BY event_id")
      .all(workspaceId).map(decisionEventFromRow);
    const proofs = this.listProofBundleRecords(workspaceId).map((record) => ({
      bundle: record.bundle,
      workspaceId: record.workspaceId,
      threadId: record.threadId,
      sourceDigest: record.sourceDigest,
      importedAt: record.importedAt,
      sources: record.bundle.sources.map((source) => {
        const object = this.readProofSourceObject(record.bundle.id, source.path);
        if (!object || object.sha256 !== source.sha256 || object.byteCount !== source.byteCount) {
          throw new Error(`trust pack source ${source.path} is not portable`);
        }
        return {
          path: source.path,
          sha256: source.sha256,
          byteCount: source.byteCount,
          encoding: "base64",
          data: object.bytes.toString("base64")
        };
      })
    }));
    return {
      workspace,
      imports: this.listWorkspaceImportEvents(workspaceId),
      decisions,
      proofs,
      ledger: this.listTrustLedger()
    };
  }

  health() {
    const integrity = this.database.prepare("PRAGMA quick_check").get().quick_check;
    const schemaVersion = this.database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
    const ledger = this.verifyTrustLedger();
    return { ok: integrity === "ok" && schemaVersion === localStoreSchemaVersion && ledger.ok, integrity, schemaVersion, ledger, file: this.file };
  }

  async backupTo(targetFile) {
    if (this.file === ":memory:") throw new Error("in-memory state cannot be backed up");
    const target = path.resolve(targetFile);
    if (target === this.file) throw new Error("backup target must differ from the active state file");
    await preparePrivateDirectory(path.dirname(target));
    await backup(this.database, target);
    await chmod(target, 0o600);
    return target;
  }

  close() {
    this.database.close();
  }
}

function decisionFromRow(row) {
  return {
    schemaVersion: row.schema_version,
    workspaceId: row.workspace_id,
    threadId: row.thread_id,
    bundleId: row.bundle_id,
    claimId: row.claim_id,
    evidenceIdentity: row.evidence_identity,
    status: row.status,
    note: row.note,
    updatedAt: row.updated_at
  };
}

function decisionEventFromRow(row) {
  return {
    eventId: row.event_id,
    action: row.action,
    ...decisionFromRow(row),
    recordedAt: row.recorded_at,
    origin: row.origin
  };
}

function decisionValues(key, decision) {
  return [
    key, decision.schemaVersion, decision.workspaceId, decision.threadId, decision.bundleId,
    decision.claimId, decision.evidenceIdentity, decision.status, String(decision.note || ""), decision.updatedAt
  ];
}

function workspaceCounts(workspace, proofBundle) {
  return {
    channels: workspace.channels.length,
    agents: workspace.agents.length,
    runs: workspace.threads.length,
    proofSources: proofBundle?.sources?.length || 0,
    reviewGates: workspace.threads.reduce((sum, thread) => sum + thread.reviewGateCount, 0)
  };
}

const ledgerGenesisHash = "0".repeat(64);

function appendLedgerEntry(database, { workspaceId, eventType, eventRef, payload, recordedAt }) {
  requireString(workspaceId, "ledger workspace id");
  requireString(eventRef, "ledger event ref");
  requireTimestamp(recordedAt, "ledger recordedAt");
  if (!["workspace_import", "decision_set", "decision_deleted"].includes(eventType)) throw new Error("ledger event type is invalid");
  const payloadJson = canonicalJson(payload);
  const payloadDigest = documentDigest(payloadJson);
  const head = database.prepare("SELECT sequence, entry_hash AS entryHash FROM trust_ledger ORDER BY sequence DESC LIMIT 1").get();
  const sequence = (head?.sequence || 0) + 1;
  const previousHash = head?.entryHash || ledgerGenesisHash;
  const entryHash = ledgerHash({ sequence, workspaceId, eventType, eventRef, payloadDigest, previousHash, recordedAt });
  database.prepare(`
    INSERT INTO trust_ledger(
      sequence, workspace_id, event_type, event_ref, payload_json, payload_digest,
      previous_hash, entry_hash, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sequence, workspaceId, eventType, eventRef, payloadJson, payloadDigest, previousHash, entryHash, recordedAt);
  return entryHash;
}

function ledgerHash({ sequence, workspaceId, eventType, eventRef, payloadDigest, previousHash, recordedAt }) {
  return documentDigest(canonicalJson({ sequence, workspaceId, eventType, eventRef, payloadDigest, previousHash, recordedAt }));
}

function ledgerEntryFromRow(row) {
  return {
    sequence: row.sequence,
    workspaceId: row.workspace_id,
    eventType: row.event_type,
    eventRef: row.event_ref,
    payload: JSON.parse(row.payload_json),
    payloadDigest: row.payload_digest,
    previousHash: row.previous_hash,
    entryHash: row.entry_hash,
    recordedAt: row.recorded_at
  };
}

function importLedgerPayload(row) {
  return {
    receiptId: row.receipt_id,
    workspaceId: row.workspace_id,
    adapter: row.adapter,
    sourceRef: row.source_ref,
    sourceDigest: row.source_digest,
    status: row.status,
    counts: JSON.parse(row.counts_json),
    warnings: JSON.parse(row.warnings_json),
    workspaceDigest: documentDigest(row.document_json),
    importedAt: row.imported_at
  };
}

function decisionLedgerPayload(row) {
  return {
    action: row.action,
    decisionKey: row.decision_key,
    schemaVersion: row.schema_version,
    workspaceId: row.workspace_id,
    threadId: row.thread_id,
    bundleId: row.bundle_id,
    claimId: row.claim_id,
    evidenceIdentity: row.evidence_identity,
    status: row.status,
    note: row.note,
    updatedAt: row.updated_at,
    origin: row.origin
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function documentDigest(documentJson) {
  return createHash("sha256").update(documentJson).digest("hex");
}

function readVerifiedSourceBytes(sourceRoot, source) {
  if (!sourceRoot) throw new Error("proof source root is required for portable evidence");
  if (source.byteCount > proofObjectLimits.sourceBytes) throw new Error(`proof source exceeds ${proofObjectLimits.sourceBytes} bytes`);
  const root = realpathSync(path.resolve(sourceRoot));
  const unresolvedTarget = path.resolve(root, source.path);
  if (lstatSync(unresolvedTarget).isSymbolicLink()) throw new Error("proof source symlinks are not allowed");
  const target = realpathSync(unresolvedTarget);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("proof source escapes its bounded root");
  const fileStat = statSync(target);
  if (!fileStat.isFile() || fileStat.size !== source.byteCount) throw new Error("proof source size does not match its declaration");
  const bytes = readFileSync(target);
  if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) throw new Error("proof source hash does not match its declaration");
  const normalizedText = bytes.toString("utf8").replace(/\r\n?/g, "\n");
  const lines = normalizedText.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== source.lineCount) throw new Error("proof source line map does not match its declaration");
  return bytes;
}

function insertProofObject(database, revisionDigest, source, bytes, importedAt) {
  const existing = database.prepare("SELECT bytes, byte_count AS byteCount FROM proof_source_objects WHERE sha256 = ?").get(source.sha256);
  if (existing && (existing.byteCount !== bytes.length || !Buffer.from(existing.bytes).equals(bytes))) {
    throw new Error("proof source object digest collision");
  }
  database.prepare(`
    INSERT INTO proof_source_objects(sha256, bytes, byte_count, imported_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(sha256) DO NOTHING
  `).run(source.sha256, bytes, bytes.length, importedAt);
  database.prepare(`
    INSERT INTO proof_revision_sources(revision_digest, path, sha256)
    VALUES (?, ?, ?)
    ON CONFLICT(revision_digest, path) DO NOTHING
  `).run(revisionDigest, source.path, source.sha256);
}

async function preparePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

async function protectSqliteFiles(file) {
  for (const target of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      await chmod(target, 0o600);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function validateProofBundleRecord(bundle) {
  requireString(bundle.id, "proof bundle id");
  if (bundle.adjudication !== null && bundle.adjudication !== undefined) {
    if (bundle.adjudication?.bundle?.id !== bundle.id) throw new Error("proof adjudication does not match the bundle");
    if (!Array.isArray(bundle.adjudication.findings)) throw new Error("proof adjudication findings are required");
  }
  if (!Array.isArray(bundle.sources)) throw new Error("proof bundle sources are required");
  const paths = new Set();
  for (const source of bundle.sources) {
    requireString(source.path, "proof source path");
    if (!safeRelativeSourcePath(source.path)) throw new Error("proof source path must be a safe relative path");
    requireString(source.kind, "proof source kind");
    requireString(source.label, "proof source label");
    requireDigest(source.sha256, "proof source hash");
    if (!Number.isInteger(source.lineCount) || source.lineCount < 0) throw new Error("proof source line count is invalid");
    if (!Number.isInteger(source.byteCount) || source.byteCount < 0) throw new Error("proof source byte count is invalid");
    if (paths.has(source.path)) throw new Error("proof source paths must be unique");
    paths.add(source.path);
  }
}

function safeRelativeSourcePath(value) {
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[a-z]:/i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}

function requireString(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required`);
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function requireTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a timestamp`);
}
