import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectCodexSession } from "../src/importers/codex-session.js";
import { loadRunManifest, mergeWorkspaces, proofBundleRecord, workspaceFromRunManifest } from "../src/importers/run-manifest.js";
import { loadProofBundle } from "../src/proof/bundle.js";
import { adjudicateProof } from "../src/proof/engine.js";
import { loadStoredSource, storedAdjudication, storedBundleSummary } from "../src/proof/stored.js";
import { createReviewDecision, evidenceIdentity } from "../public/shared/review-contract.js";
import { openLocalStore } from "../src/storage/local-store.js";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-importers-"));
try {
  const codexSource = new URL("../data/import-fixtures/codex-session.jsonl", import.meta.url);
  const inspection = await inspectCodexSession(codexSource);
  const inspectionText = JSON.stringify(inspection);
  assert.equal(inspection.sessionId, "019f0000-0000-7000-8000-000000000001");
  assert.equal(inspection.counts.malformed, 1);
  assert.equal(inspection.counts.toolCalls, 1);
  assert.equal(inspection.warnings.length, 1);
  assert.equal(inspection.complete, true);
  assert.equal(inspection.proofEligible, false, "malformed source bytes must block proof attachment");
  assert.ok(!inspectionText.includes("TRANSCRIPT_BODY_SENTINEL"));
  assert.ok(!inspectionText.includes("COMMAND_BODY_SENTINEL"));
  assert.ok(!inspectionText.includes("EVENT_TYPE_SENTINEL"));
  assert.ok(!inspectionText.includes("TOP_LEVEL_TYPE_SENTINEL"));
  assert.equal(inspection.eventTypes.other, 1);
  assert.equal(inspection.topLevelTypes.other, 1);
  assert.equal(inspection.events.length, 4);
  const cleanInspection = await inspectCodexSession(new URL("../data/import-fixtures/codex-session-clean.jsonl", import.meta.url));
  assert.equal(cleanInspection.complete, true);
  assert.equal(cleanInspection.proofEligible, true);
  const incomplete = await inspectCodexSession(new URL("../data/import-fixtures/codex-session-incomplete.jsonl", import.meta.url));
  assert.equal(incomplete.complete, false);
  assert.match(incomplete.warnings[0], /latest task/);
  await assert.rejects(
    inspectCodexSession(new URL("../data/import-fixtures/codex-session-mixed.jsonl", import.meta.url)),
    /multiple session ids/
  );

  const { manifest: codexManifest } = await loadRunManifest(new URL("../data/import-fixtures/codex-run.json", import.meta.url));
  const normalizedCodexManifest = structuredClone(codexManifest);
  normalizedCodexManifest.run.startedAt = inspection.startedAt;
  normalizedCodexManifest.run.updatedAt = inspection.updatedAt;
  normalizedCodexManifest.run.completedAt = inspection.updatedAt;
  const bundle = await loadProofBundle(fileURLToPath(new URL("../data/import-fixtures/codex-proof/bundle.json", import.meta.url)));
  const modelRun = JSON.parse(await readFile(new URL("../data/import-fixtures/codex-proof/proof-output.json", import.meta.url), "utf8"));
  const proof = adjudicateProof(bundle, modelRun);
  const codexWorkspace = workspaceFromRunManifest(normalizedCodexManifest, { proof, events: inspection.events });
  const codexRun = codexWorkspace.threads[0];
  assert.equal(codexRun.proofState, "ready");
  assert.equal(codexRun.reviewGateCount, 1);
  assert.equal(Object.keys(codexRun.reviewEvidence).length, 1);

  const store = await openLocalStore(path.join(temporaryRoot, "halba.sqlite"));
  const sourceDigest = createHash("sha256").update(JSON.stringify(inspection)).digest("hex");
  store.importWorkspace(codexWorkspace, {
    adapter: "codex-session-v1",
    sourceRef: inspection.sourceRef,
    sourceDigest,
    importedAt: codexRun.updatedAt,
    proofBundle: proofBundleRecord(bundle, proof),
    sourceRoot: bundle.bundleRoot,
    receiptId: "codex-receipt",
    status: "degraded",
    warnings: inspection.warnings
  });

  const { manifest: ciManifest } = await loadRunManifest(new URL("../data/import-fixtures/ci-run.json", import.meta.url));
  const ciIncoming = workspaceFromRunManifest(ciManifest);
  const merged = mergeWorkspaces(store.getWorkspace("operator-lab"), ciIncoming);
  assert.equal(merged.channels.length, 2);
  assert.equal(merged.agents.length, 2);
  assert.equal(merged.threads.length, 2);
  store.importWorkspace(merged, {
    adapter: "run-manifest-v1",
    sourceRef: "ci-run.json",
    sourceDigest: createHash("sha256").update(JSON.stringify(ciManifest)).digest("hex"),
    importedAt: ciIncoming.threads[0].updatedAt,
    receiptId: "ci-receipt"
  });
  assert.equal(store.getWorkspace("operator-lab").threads.length, 2);
  assert.equal(store.listRuns("operator-lab").length, 2);
  assert.equal(store.getProofBundle(bundle.definition.id).adjudication.findings.length, 3);
  assert.deepEqual(store.listImportReceipts("operator-lab").map((receipt) => receipt.adapter), ["run-manifest-v1", "codex-session-v1"]);
  assert.equal(store.listImportReceipts("operator-lab")[1].warnings.length, 1);

  const storedRecord = store.getProofBundleRecord(bundle.definition.id);
  assert.equal(storedBundleSummary(storedRecord).executionMode, "imported");
  assert.equal(storedBundleSummary(storedRecord).portable, true);
  assert.equal(storedAdjudication(storedRecord).findings.length, 3);
  const citedFinding = proof.findings.find((finding) => finding.citations.some((citation) => citation.valid));
  const citation = citedFinding.citations.find((item) => item.valid);
  const storedSource = await loadStoredSource(storedRecord, citation.path, { startLine: citation.startLine, endLine: citation.endLine });
  assert.equal(storedSource.sha256, citation.sourceSha256);
  assert.ok(storedSource.text.length > 0);
  await assert.rejects(
    loadStoredSource(storedRecord, "sources/not-declared.md", { startLine: 1, endLine: 1 }),
    /not declared/
  );

  const tamperedRoot = path.join(temporaryRoot, "tampered-proof");
  await cp(bundle.bundleRoot, tamperedRoot, { recursive: true });
  const tamperedPath = path.join(tamperedRoot, citation.path);
  const originalBytes = await readFile(tamperedPath);
  const tamperedBytes = Buffer.from(originalBytes);
  tamperedBytes[0] = tamperedBytes[0] === 65 ? 66 : 65;
  await writeFile(tamperedPath, tamperedBytes);
  const vaultedSource = await loadStoredSource({ ...storedRecord, sourceRoot: tamperedRoot }, citation.path, { startLine: citation.startLine, endLine: citation.endLine });
  assert.equal(vaultedSource.sha256, citation.sourceSha256, "the content-addressed vault must not depend on a changed external root");
  await assert.rejects(
    loadStoredSource({ ...storedRecord, sourceObjectProvider: null, sourceRoot: tamperedRoot }, citation.path, { startLine: citation.startLine, endLine: citation.endLine }),
    /hash changed/
  );

  const reviewFinding = proof.findings.find((finding) => finding.reviewRequired);
  const reviewScope = {
    workspaceId: codexWorkspace.workspace.id,
    threadId: codexRun.id,
    bundleId: bundle.definition.id,
    claimId: reviewFinding.claimId
  };
  const decision = createReviewDecision({ ...reviewScope, finding: reviewFinding, status: "more-proof", note: "Need an independent receipt." });
  store.saveReviewDecision(decision);
  assert.equal(store.listReviewDecisions(reviewScope).length, 1);
  assert.equal(store.listReviewDecisions(reviewScope)[0].evidenceIdentity, evidenceIdentity(reviewFinding));
  assert.throws(() => store.saveReviewDecision({ ...decision, evidenceIdentity: "changed" }), /does not match/);
  assert.equal(store.deleteReviewDecision(reviewScope), true);
  assert.equal(store.listReviewDecisions(reviewScope).length, 0);
  assert.deepEqual(store.listReviewDecisionEvents(reviewScope).map((event) => event.action), ["set", "deleted"]);

  const deterministicReplay = workspaceFromRunManifest(normalizedCodexManifest, { proof, events: inspection.events });
  assert.deepEqual(deterministicReplay, codexWorkspace);

  const mismatchedProof = structuredClone(proof);
  mismatchedProof.bundle.title = "Another run";
  assert.throws(() => workspaceFromRunManifest(normalizedCodexManifest, { proof: mismatchedProof, events: inspection.events }), /proof title does not match/);

  const unsafeManifest = structuredClone(ciManifest);
  unsafeManifest.run.events[0].id = "../unsafe";
  assert.throws(() => workspaceFromRunManifest(unsafeManifest), /safe slugs/);
  store.close();

  console.log("check passed: Codex JSONL and independent manifest adapters normalize deterministically without retaining transcript bodies");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
