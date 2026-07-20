import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  buildTrustPack,
  canonicalJson,
  canonicalSha256,
  trustLedgerEntryHash,
  trustLedgerGenesisHash,
  trustPackIntegrity,
  verifyTrustLedger,
  verifyTrustPack
} from "../src/domain/trust-pack.js";
import { loadProofBundle } from "../src/proof/bundle.js";
import { openLocalStore } from "../src/storage/local-store.js";

const at = "2026-07-18T00:00:00.000Z";
const workspace = {
  schemaVersion: 1,
  workspace: { id: "trust-pack-check", name: "Trust Pack Check" },
  channels: [{ id: "proof", name: "Proof", topic: "Portable local evidence" }],
  agents: [{ id: "operator", name: "Operator", role: "Reviews local evidence", initial: "O" }],
  threads: [{
    id: "integrity", channelId: "proof", agentId: "operator", title: "Verify trust pack",
    status: "completed", proofState: "ready", startedAt: at, updatedAt: at, completedAt: at,
    goal: "Detect mutations", summary: "Pack verified", proofBundleId: "proof-1", claimCount: 1,
    claimIds: ["claim-1"], reviewGateCount: 1, reviewClaimIds: ["claim-1"],
    verdictCounts: { supported: 1, unsupported: 0, contradictory: 0, stale: 0, uncertain: 0 },
    reviewEvidence: { "claim-1": "evidence-v1" },
    events: [{ id: "complete", type: "proof_completed", at, title: "Proof complete", detail: "Local proof captured" }]
  }]
};

const counts = { channels: 1, agents: 1, runs: 1, proofSources: 1, reviewGates: 1 };
const imports = [{
  eventId: 1,
  receiptId: "receipt-1",
  workspaceId: workspace.workspace.id,
  adapter: "check",
  sourceRef: "fixture.json",
  sourceDigest: canonicalSha256({ fixture: 1 }),
  status: "imported",
  counts,
  warnings: [],
  importedAt: at,
  recordedAt: at
}];
const decisions = [{
  eventId: 1,
  action: "set",
  schemaVersion: 1,
  workspaceId: workspace.workspace.id,
  threadId: "integrity",
  bundleId: "proof-1",
  claimId: "claim-1",
  evidenceIdentity: "evidence-v1",
  status: "accepted",
  note: "checked",
  updatedAt: at,
  recordedAt: "2026-07-18T00:00:01.000Z",
  origin: "operator"
}];

function ledgerEntry(sequence, previousHash, eventType, eventRef, payload, recordedAt) {
  const entry = {
    sequence,
    workspaceId: workspace.workspace.id,
    eventType,
    eventRef,
    payload,
    payloadDigest: canonicalSha256(payload),
    previousHash,
    recordedAt
  };
  return { ...entry, entryHash: trustLedgerEntryHash(entry) };
}

const importPayload = {
  receiptId: imports[0].receiptId,
  workspaceId: workspace.workspace.id,
  adapter: imports[0].adapter,
  sourceRef: imports[0].sourceRef,
  sourceDigest: imports[0].sourceDigest,
  status: imports[0].status,
  counts,
  warnings: [],
  workspaceDigest: canonicalSha256(workspace),
  importedAt: at
};
const decisionPayload = Object.fromEntries(
  ["action", "schemaVersion", "workspaceId", "threadId", "bundleId", "claimId", "evidenceIdentity", "status", "note", "updatedAt", "origin"]
    .map((field) => [field, decisions[0][field]])
);
decisionPayload.decisionKey = "trust-pack-check/integrity/proof-1/claim-1";

const first = ledgerEntry(1, trustLedgerGenesisHash, "workspace_import", imports[0].receiptId, importPayload, imports[0].recordedAt);
const second = ledgerEntry(2, first.entryHash, "decision_set", "decision:1", decisionPayload, decisions[0].recordedAt);
const sourceBytes = Buffer.from("proof bytes\n", "utf8");
const source = {
  path: "proof.txt",
  kind: "text",
  label: "Proof text",
  sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  lineCount: 1,
  byteCount: sourceBytes.length
};
const proofs = [{
  bundle: { id: "proof-1", title: "Proof one", generatedAt: at, sources: [source] },
  workspaceId: workspace.workspace.id,
  threadId: "integrity",
  sourceDigest: canonicalSha256([source]),
  importedAt: at,
  sources: [{
    path: source.path,
    sha256: source.sha256,
    byteCount: source.byteCount,
    encoding: "base64",
    data: sourceBytes.toString("base64")
  }]
}];

const snapshot = { workspace, imports, decisions, proofs, ledger: [first, second] };
const pack = buildTrustPack(snapshot);
const replay = buildTrustPack(snapshot);
assert.deepEqual(replay, pack, "trust pack build must be deterministic");
assert.equal(pack.integrity.mode, "unsigned-local");
assert.equal(pack.integrity.assurance, "integrity-only-no-identity-authenticity");
assert.equal(pack.integrity.privacyScope, "full-local-ledger-payloads");
assert.equal(pack.integrity.algorithm, trustPackIntegrity.algorithm);
assert.equal(pack.proofRecords[0].sources[0].bytesBase64, sourceBytes.toString("base64"));
assert.equal(Object.hasOwn(pack.ledger[0], "payload"), false);
assert.equal(pack.ledger[0].payloadJson, canonicalJson(importPayload));

const result = verifyTrustPack(pack);
assert.equal(result.ok, true);
assert.equal(result.identityAuthenticity, false);
assert.equal(result.ledgerEntries, 2);
assert.equal(result.proofSourceBytes, sourceBytes.length);
assert.deepEqual(verifyTrustLedger(pack.ledger).ledger, pack.ledger);

function mutated(change) {
  const copy = structuredClone(pack);
  change(copy);
  return copy;
}

function rejects(label, change, pattern) {
  assert.throws(() => verifyTrustPack(mutated(change)), pattern, label);
}

rejects("ledger reordering", (copy) => copy.ledger.reverse(), /reordered, missing, or duplicated/);
rejects("missing ledger sequence", (copy) => copy.ledger.shift(), /reordered, missing, or duplicated/);
rejects("duplicated ledger sequence", (copy) => copy.ledger.push(copy.ledger[1]), /reordered, missing, or duplicated|duplicates an event identity/);
rejects("broken previous hash", (copy) => { copy.ledger[1].previousHash = trustLedgerGenesisHash; }, /broken previous hash/);
rejects("payload mutation", (copy) => { copy.ledger[0].payloadJson = canonicalJson({ changed: true }); }, /payload digest mismatch/);
rejects("source byte mutation", (copy) => { copy.proofRecords[0].sources[0].bytesBase64 = Buffer.from("proof bytez\n").toString("base64"); }, /source hash mismatch/);
rejects("source count mutation", (copy) => { copy.proofRecords[0].sources[0].byteCount += 1; }, /source byte count mismatch/);
rejects("section mutation", (copy) => { copy.workspace.workspace.name = "Mutated"; }, /workspace section digest mismatch/);
rejects("full pack digest mutation", (copy) => { copy.integrity.packDigest = "f".repeat(64); }, /full pack digest mismatch/);
rejects("unknown root field", (copy) => { copy.command = "run"; }, /unknown, missing, or unsafe schema fields/);
rejects("unknown integrity field", (copy) => { copy.integrity.signer = "nobody"; }, /unknown, missing, or unsafe schema fields/);
rejects("unknown ledger field", (copy) => { copy.ledger[0].signature = "fake"; }, /unknown, missing, or unsafe schema fields/);
rejects("unknown proof field", (copy) => { copy.proofRecords[0].identity = "fake"; }, /unknown, missing, or unsafe schema fields/);
rejects("unknown source field", (copy) => { copy.proofRecords[0].sources[0].url = "https://example.test"; }, /unknown, missing, or unsafe schema fields/);

const lifecycle = await checkTwoWorkspaceLifecycle();

console.log(`check passed: trust pack v${pack.schemaVersion}, ${result.ledgerEntries} mutation-fixture ledger entries, plus ${lifecycle.ledgerEntries} two-workspace lifecycle entries and ${lifecycle.proofRecords} independently verified proof revisions`);

async function checkTwoWorkspaceLifecycle() {
  const sourceRoot = fileURLToPath(new URL("../data/demo/", import.meta.url));
  const baseWorkspace = JSON.parse(await readFile(new URL("../data/demo/workspace.json", import.meta.url), "utf8"));
  const loadedBundle = await loadProofBundle();
  const proofThread = baseWorkspace.threads.find((thread) => thread.proofBundleId);
  const firstBundle = lifecycleBundle(loadedBundle, "lineage-proof-v1", "Lineage proof v1");
  const secondBundle = lifecycleBundle(loadedBundle, "lineage-proof-v2", "Lineage proof v2");
  const recoveryBundle = lifecycleBundle(loadedBundle, "recovery-proof-v1", "Recovery proof v1");

  const firstThread = structuredClone(proofThread);
  firstThread.id = "lineage-proof-v1";
  firstThread.proofBundleId = firstBundle.id;
  const secondThread = structuredClone(proofThread);
  secondThread.id = "lineage-proof-v2";
  secondThread.title = "Verify superseding lineage evidence";
  secondThread.proofBundleId = secondBundle.id;
  secondThread.startedAt = "2026-07-14T09:00:00.000Z";
  secondThread.updatedAt = "2026-07-14T09:10:00.000Z";
  secondThread.completedAt = "2026-07-14T09:10:00.000Z";
  secondThread.events = secondThread.events.map((event) => ({ ...event, at: secondThread.completedAt }));

  const firstTrust = lineageTrust([{ id: "lineage-v1", thread: firstThread, supersedes: [] }]);
  const finalTrust = lineageTrust([
    { id: "lineage-v1", thread: firstThread, supersedes: [] },
    { id: "lineage-v2", thread: secondThread, supersedes: ["lineage-v1"] }
  ]);
  const firstWorkspace = lifecycleWorkspace(baseWorkspace, "lineage-lab", "Lineage Lab", [firstThread], firstTrust);
  const finalWorkspace = lifecycleWorkspace(baseWorkspace, "lineage-lab", "Lineage Lab", [firstThread, secondThread], finalTrust);

  const recoveryThread = structuredClone(proofThread);
  recoveryThread.id = "recovery-proof-v1";
  recoveryThread.proofBundleId = recoveryBundle.id;
  const recoveryTrust = {
    schemaVersion: 2,
    policy: lifecyclePolicy("recovery-policy"),
    bindings: [lifecycleBinding({
      id: "recovery-v1",
      stableKey: "runtime:recovery",
      thread: recoveryThread,
      supersedes: [],
      dependsOn: []
    })]
  };
  const recoveryWorkspace = lifecycleWorkspace(baseWorkspace, "recovery-lab", "Recovery Lab", [recoveryThread], recoveryTrust);

  const store = await openLocalStore(":memory:");
  let lineagePack;
  let recoveryPack;
  try {
    store.importWorkspace(firstWorkspace, lifecycleImport("lineage-import-v1", "2026-07-14T09:11:00.000Z", firstWorkspace, firstBundle, sourceRoot));
    store.importWorkspace(finalWorkspace, lifecycleImport("lineage-import-v2", "2026-07-14T09:12:00.000Z", finalWorkspace, secondBundle, sourceRoot));
    store.importWorkspace(recoveryWorkspace, lifecycleImport("recovery-import-v1", "2026-07-14T09:13:00.000Z", recoveryWorkspace, recoveryBundle, sourceRoot));

    const scope = {
      workspaceId: finalWorkspace.workspace.id,
      threadId: secondThread.id,
      bundleId: secondBundle.id,
      claimId: "deployed"
    };
    const decision = {
      schemaVersion: 1,
      ...scope,
      evidenceIdentity: secondThread.reviewEvidence.deployed,
      status: "approved",
      note: "Lineage evidence accepted.",
      updatedAt: "2026-07-14T09:14:00.000Z"
    };
    const update = {
      ...decision,
      status: "more-proof",
      note: "A superseding receipt is required.",
      updatedAt: "2026-07-14T09:15:00.000Z"
    };
    store.saveReviewDecision(decision);
    store.saveReviewDecision(update);
    assert.equal(store.deleteReviewDecision(scope), true);
    assert.equal(store.getReviewDecision(scope), null, "decision delete must remove only the current projection");

    const lineageSnapshot = store.exportTrustPackSnapshot("lineage-lab");
    const recoverySnapshot = store.exportTrustPackSnapshot("recovery-lab");
    assert.deepEqual(lineageSnapshot.workspace.trust, finalTrust, "schema-v2 lineage metadata must survive exact store projection");
    assert.deepEqual(recoverySnapshot.workspace.trust, recoveryTrust, "second workspace trust metadata must remain independent");
    assert.deepEqual(lineageSnapshot.imports.map((event) => event.receiptId), ["lineage-import-v1", "lineage-import-v2"]);
    assert.deepEqual(lineageSnapshot.decisions.map((event) => [event.action, event.status]), [
      ["set", "approved"],
      ["set", "more-proof"],
      ["deleted", "more-proof"]
    ]);
    assert.equal(lineageSnapshot.proofs.length, 2, "lineage pack must carry both attached proof revisions");
    assert.equal(recoverySnapshot.proofs.length, 1, "second workspace must carry only its own proof revision");
    assert.equal(store.listProofBundleRevisions(firstBundle.id).length, 1);
    assert.equal(store.listProofBundleRevisions(secondBundle.id).length, 1);
    assert.equal(store.listProofBundleRevisions(recoveryBundle.id).length, 1);
    assert.deepEqual(store.listTrustLedger("lineage-lab").map((entry) => entry.eventType), [
      "workspace_import",
      "workspace_import",
      "decision_set",
      "decision_set",
      "decision_deleted"
    ]);
    assert.deepEqual(store.listTrustLedger("recovery-lab").map((entry) => entry.eventType), ["workspace_import"]);

    lineagePack = buildTrustPack(lineageSnapshot);
    recoveryPack = buildTrustPack(recoverySnapshot);
  } finally {
    store.close();
  }

  const lineageResult = verifyTrustPack(structuredClone(lineagePack));
  const recoveryResult = verifyTrustPack(structuredClone(recoveryPack));
  assert.deepEqual(lineagePack.workspace.trust, finalTrust, "independent lineage pack must preserve exact schema-v2 metadata");
  assert.deepEqual(recoveryPack.workspace.trust, recoveryTrust, "independent recovery pack must preserve exact schema-v2 metadata");
  assert.deepEqual([lineageResult.importEvents, lineageResult.decisionEvents, lineageResult.proofRecords], [2, 3, 2]);
  assert.deepEqual([recoveryResult.importEvents, recoveryResult.decisionEvents, recoveryResult.proofRecords], [1, 0, 1]);
  assert.equal(lineageResult.ledgerHeadHash, recoveryResult.ledgerHeadHash, "independent workspace packs must verify the same complete store ledger");
  return { ledgerEntries: lineageResult.ledgerEntries, proofRecords: lineageResult.proofRecords + recoveryResult.proofRecords };
}

function lifecycleBundle(loadedBundle, id, title) {
  const definition = structuredClone(loadedBundle.definition);
  definition.id = id;
  definition.title = title;
  return {
    id,
    title,
    generatedAt: definition.generatedAt,
    definition,
    sources: loadedBundle.sources.map((source) => ({
      path: source.path,
      kind: source.kind,
      label: source.label,
      sha256: source.sha256,
      lineCount: source.lineCount,
      byteCount: source.bytes
    }))
  };
}

function lifecycleWorkspace(baseWorkspace, id, name, threads, trust) {
  return {
    ...structuredClone(baseWorkspace),
    workspace: { id, name },
    threads: structuredClone(threads),
    trust: structuredClone(trust)
  };
}

function lineageTrust(observations) {
  return {
    schemaVersion: 2,
    policy: lifecyclePolicy("lineage-policy"),
    bindings: observations.map(({ id, thread, supersedes }) => lifecycleBinding({
      id,
      stableKey: "release:lineage-proof",
      thread,
      supersedes,
      dependsOn: []
    }))
  };
}

function lifecyclePolicy(id) {
  return {
    id,
    version: 2,
    defaultFreshnessDays: 14,
    defaultDecisionTtlDays: 21,
    requireHumanDecisionFor: ["high", "critical"]
  };
}

function lifecycleBinding({ id, stableKey, thread, supersedes, dependsOn }) {
  return {
    id,
    stableKey,
    threadId: thread.id,
    claimId: "deployed",
    class: "operational",
    criticality: "critical",
    freshnessDays: 7,
    decisionTtlDays: 10,
    requiredGuards: ["citation-required"],
    dependsOn,
    supersedes
  };
}

function lifecycleImport(receiptId, importedAt, workspace, proofBundle, sourceRoot) {
  return {
    adapter: "trust-pack-lifecycle-v1",
    sourceRef: `${receiptId}.json`,
    sourceDigest: canonicalSha256(workspace),
    importedAt,
    receiptId,
    proofBundle,
    sourceRoot
  };
}
