import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createReviewDecision } from "../public/shared/review-contract.js";
import { inspectCodexSession } from "../src/importers/codex-session.js";
import { loadRunManifest, mergeWorkspaces, proofBundleRecord, workspaceFromRunManifest } from "../src/importers/run-manifest.js";
import { loadProofBundle } from "../src/proof/bundle.js";
import { adjudicateProof } from "../src/proof/engine.js";
import { openLocalStore, openLocalStoreReadOnly } from "../src/storage/local-store.js";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "halba-state-smoke-"));
const stateFile = path.join(temporaryRoot, "halba.sqlite");
const port = 4280;
const origin = `http://127.0.0.1:${port}`;
let server = null;

try {
  await assertRemoteBindRejected();
  const { proof, workspace, bundle } = await seedState();
  server = startServer();
  await waitForServer(server);

  const runtimeResponse = await fetch(`${origin}/api/runtime`);
  assert.equal(runtimeResponse.status, 200);
  assert.equal(runtimeResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(runtimeResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await runtimeResponse.json(), { durableState: true });
  const workspaces = await getJson("/api/workspaces");
  assert.equal(workspaces.length, 2);
  assert.deepEqual(new Set(workspaces.map((workspace) => workspace.id)), new Set(["operator-lab", "second-lab"]));
  const servedWorkspace = await getJson("/api/workspace?workspaceId=operator-lab");
  assert.equal(servedWorkspace.threads.length, 2);
  assert.ok(servedWorkspace.threads.some((thread) => thread.id === "ci-release-check" && thread.status === "failed"));
  const receipts = await getJson("/api/import-receipts?workspaceId=operator-lab");
  assert.equal(receipts.length, 2);
  assert.deepEqual(new Set(receipts.map((receipt) => receipt.adapter)), new Set(["codex-session-v1", "run-manifest-v1"]));
  assert.equal(receipts.filter((receipt) => receipt.status === "degraded").length, 1);
  const secondWorkspace = await getJson("/api/workspace?workspaceId=second-lab");
  assert.equal(secondWorkspace.threads[0].id, "independent-run");
  const historyQuery = new URLSearchParams({ workspaceId: "operator-lab", at: "2026-07-26T08:00:05.000Z", maxAgeDays: "7" });
  const history = await getJson(`/api/claim-history?${historyQuery}`);
  assert.deepEqual(history.counts, { current: 1, stale: 2, superseded: 0 });
  assert.equal(history.claims.filter((claim) => claim.state === "stale").every((claim) => claim.verdict === "supported"), true);
  const trustQuery = new URLSearchParams({ at: "2026-07-26T08:00:05.000Z", checkpointAt: "2026-07-17T00:00:00.000Z" });
  const trustOperations = await getJson(`/api/trust-operations?${trustQuery}`);
  assert.equal(trustOperations.workspaceCount, 2);
  assert.deepEqual(trustOperations.page, { limit: 50, returned: 4, totalItems: 4, truncated: false });
  assert.deepEqual(new Set(trustOperations.items.map((item) => item.id)), new Set([
    "claim:operator-lab:operator-contract-safety",
    "import:operator-lab:codex-session-v1",
    "run:operator-lab:ci-release-check",
    "run:second-lab:independent-run"
  ]));
  assert.equal(trustOperations.items[0].id, "claim:operator-lab:operator-contract-safety");
  assert.equal(trustOperations.items.every((item) => item.priority.components.length > 1), true);
  assert.equal(trustOperations.items.every((item) => item.target.kind === item.kind && item.target.workspaceId === item.workspaceId), true);
  const boundedTrust = await getJson(`/api/trust-operations?${new URLSearchParams({ ...Object.fromEntries(trustQuery), limit: "2" })}`);
  assert.deepEqual(boundedTrust.page, { limit: 2, returned: 2, totalItems: 4, truncated: true });
  assert.equal((await fetch(`${origin}/api/trust-operations?limit=101`)).status, 400);
  assert.equal((await fetch(`${origin}/api/trust-operations?at=2026-07-26T08%3A00%3A05.000Z&checkpointAt=2026-07-27T08%3A00%3A05.000Z`)).status, 400);
  const weeklyQuery = new URLSearchParams({ workspaceId: "operator-lab", at: "2026-07-26T08:00:05.000Z", windowDays: "30", maxAgeDays: "7", format: "markdown" });
  const weeklyResponse = await fetch(`${origin}/api/weekly-review?${weeklyQuery}`);
  const weeklyMarkdown = await weeklyResponse.text();
  assert.equal(weeklyResponse.status, 200);
  assert.match(weeklyResponse.headers.get("content-type"), /text\/markdown/);
  assert.match(weeklyMarkdown, /Operator Lab weekly evidence review/);
  assert.match(weeklyMarkdown, /2 stale claims/);
  assert.match(weeklyMarkdown, /ci-release-check/);

  const bundleQuery = new URLSearchParams({ bundleId: bundle.definition.id });
  const summary = await getJson(`/api/proof/bundle?${bundleQuery}`);
  assert.equal(summary.id, bundle.definition.id);
  assert.equal(summary.executionMode, "imported");
  assert.equal(summary.sourceCount, bundle.sources.length);
  assert.equal(summary.portable, true);
  assert.equal((await fetch(`${origin}/api/proof/bundle?bundleId=wrong-bundle`)).status, 404);

  const proofResponse = await postJson("/api/proof/run", { mode: "recorded", bundleId: bundle.definition.id });
  assert.equal(proofResponse.status, 200);
  const servedProof = await proofResponse.json();
  assert.deepEqual(servedProof, proof);
  const citation = proof.findings.flatMap((finding) => finding.citations).find((item) => item.valid);
  const sourceQuery = new URLSearchParams({
    bundleId: bundle.definition.id,
    path: citation.path,
    startLine: String(citation.startLine),
    endLine: String(citation.endLine)
  });
  const source = await getJson(`/api/proof/source?${sourceQuery}`);
  assert.equal(source.sha256, citation.sourceSha256);
  assert.ok(source.text.length > 0);
  assert.equal((await fetch(`${origin}/api/proof/source?bundleId=wrong-bundle&path=${encodeURIComponent(citation.path)}&startLine=1&endLine=1`)).status, 404);
  assert.equal((await fetch(`${origin}/api/proof/source?bundleId=${bundle.definition.id}&path=sources%2Fnot-declared.md&startLine=1&endLine=1`)).status, 404);

  const run = workspace.threads.find((thread) => thread.proofBundleId === bundle.definition.id);
  const finding = proof.findings.find((item) => item.reviewRequired);
  const scope = { workspaceId: workspace.workspace.id, threadId: run.id, bundleId: bundle.definition.id, claimId: finding.claimId };
  const decision = createReviewDecision({ ...scope, finding, status: "more-proof", note: "Persist this across restart." });
  const crossOrigin = await fetch(`${origin}/api/review-decision`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
    body: JSON.stringify(decision)
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error, "origin_not_allowed");
  const saveResponse = await putJson("/api/review-decision", decision);
  assert.equal(saveResponse.status, 200);
  assert.deepEqual(await saveResponse.json(), decision);
  const rejected = await putJson("/api/review-decision", { ...decision, evidenceIdentity: "changed" });
  assert.equal(rejected.status, 400);
  const decisionQuery = new URLSearchParams({ workspaceId: scope.workspaceId, threadId: scope.threadId, bundleId: scope.bundleId });
  const recoveryBefore = await recoverySnapshot({
    scope,
    bundleId: bundle.definition.id,
    historyQuery,
    trustQuery,
    weeklyQuery,
    decisionQuery,
    sourceQuery
  });

  await stopServer(server, "SIGKILL");
  server = startServer();
  await waitForServer(server);
  const recoveryAfter = await recoverySnapshot({
    scope,
    bundleId: bundle.definition.id,
    historyQuery,
    trustQuery,
    weeklyQuery,
    decisionQuery,
    sourceQuery
  });
  assert.deepEqual(recoveryAfter, recoveryBefore, "SIGKILL restart must preserve every durable trust and review projection exactly");
  assert.deepEqual(await getJson(`/api/review-decisions?${decisionQuery}`), [decision]);
  const deleteResponse = await deleteJson("/api/review-decision", scope);
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { deleted: true });
  assert.deepEqual(await getJson(`/api/review-decisions?${decisionQuery}`), []);

  console.log("check passed: abrupt restart preserves receipts, histories, ledger verification, proof hashes, trust lineage, Trust Operations, and weekly export");
} finally {
  if (server) await stopServer(server);
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function seedState() {
  const inspection = await inspectCodexSession(new URL("../data/import-fixtures/codex-session.jsonl", import.meta.url));
  const { manifest } = await loadRunManifest(new URL("../data/import-fixtures/codex-run.json", import.meta.url));
  const normalized = structuredClone(manifest);
  normalized.run.startedAt = inspection.startedAt;
  normalized.run.updatedAt = inspection.updatedAt;
  normalized.run.completedAt = inspection.updatedAt;
  const bundle = await loadProofBundle(fileURLToPath(new URL("../data/import-fixtures/codex-proof/bundle.json", import.meta.url)));
  const modelRun = JSON.parse(await readFile(new URL("../data/import-fixtures/codex-proof/proof-output.json", import.meta.url), "utf8"));
  const proof = adjudicateProof(bundle, modelRun);
  const codexWorkspace = workspaceFromRunManifest(normalized, { proof, events: inspection.events });
  const reviewFinding = proof.findings.find((finding) => finding.reviewRequired);
  codexWorkspace.trust = {
    schemaVersion: 2,
    policy: {
      id: "operator-default",
      version: 1,
      defaultFreshnessDays: 30,
      defaultDecisionTtlDays: 30,
      requireHumanDecisionFor: ["high", "critical"]
    },
    bindings: [{
      id: "operator-contract-safety",
      stableKey: "contract:universal-safety",
      threadId: codexWorkspace.threads[0].id,
      claimId: reviewFinding.claimId,
      class: "contract",
      criticality: "critical",
      requiredGuards: [],
      dependsOn: [],
      supersedes: []
    }]
  };
  const store = await openLocalStore(stateFile);
  store.importWorkspace(codexWorkspace, {
    adapter: "codex-session-v1",
    sourceRef: inspection.sourceRef,
    sourceDigest: createHash("sha256").update(JSON.stringify(inspection)).digest("hex"),
    importedAt: codexWorkspace.threads[0].updatedAt,
    proofBundle: proofBundleRecord(bundle, proof),
    sourceRoot: bundle.bundleRoot,
    receiptId: "state-smoke-codex",
    status: "degraded",
    warnings: inspection.warnings
  });
  const { manifest: ciManifest } = await loadRunManifest(new URL("../data/import-fixtures/ci-run.json", import.meta.url));
  const ciWorkspace = workspaceFromRunManifest(ciManifest);
  const workspace = mergeWorkspaces(store.getWorkspace("operator-lab"), ciWorkspace);
  store.importWorkspace(workspace, {
    adapter: "run-manifest-v1",
    sourceRef: "ci-run.json",
    sourceDigest: createHash("sha256").update(JSON.stringify(ciManifest)).digest("hex"),
    importedAt: ciWorkspace.threads[0].updatedAt,
    receiptId: "state-smoke-ci"
  });
  const secondManifest = structuredClone(ciManifest);
  secondManifest.workspace = { id: "second-lab", name: "Second Lab" };
  secondManifest.channel = { id: "operations", name: "operations", topic: "Independent operator receipts." };
  secondManifest.agent = { id: "runner-two", name: "Runner Two", role: "independent source", initial: "R" };
  Object.assign(secondManifest.run, {
    id: "independent-run",
    workspaceId: "second-lab",
    channelId: "operations",
    agentId: "runner-two",
    startedAt: "2026-07-18T07:00:00.000Z",
    updatedAt: "2026-07-18T07:04:00.000Z",
    completedAt: "2026-07-18T07:04:00.000Z"
  });
  secondManifest.run.events = secondManifest.run.events.map((event, index) => ({ ...event, id: `second-${index + 1}`, at: `2026-07-18T07:0${index}:00.000Z` }));
  const secondWorkspace = workspaceFromRunManifest(secondManifest);
  store.importWorkspace(secondWorkspace, {
    adapter: "run-manifest-v1",
    sourceRef: "second-run.json",
    sourceDigest: createHash("sha256").update(JSON.stringify(secondManifest)).digest("hex"),
    importedAt: secondWorkspace.threads[0].updatedAt,
    receiptId: "state-smoke-second"
  });
  store.close();
  return { proof, workspace, bundle };
}

async function recoverySnapshot({ scope, bundleId, historyQuery, trustQuery, weeklyQuery, decisionQuery, sourceQuery }) {
  const weeklyResponse = await fetch(`${origin}/api/weekly-review?${weeklyQuery}`);
  assert.equal(weeklyResponse.status, 200);
  const api = {
    operatorReceipts: await getJson("/api/import-receipts?workspaceId=operator-lab"),
    secondReceipts: await getJson("/api/import-receipts?workspaceId=second-lab"),
    claimHistory: await getJson(`/api/claim-history?${historyQuery}`),
    decisions: await getJson(`/api/review-decisions?${decisionQuery}`),
    trustOperations: await getJson(`/api/trust-operations?${trustQuery}`),
    proofSource: await getJson(`/api/proof/source?${sourceQuery}`),
    weeklyMarkdown: await weeklyResponse.text()
  };
  const store = await openLocalStoreReadOnly(stateFile);
  try {
    const ledger = store.verifyTrustLedger();
    return {
      api,
      durable: {
        receipts: {
          operator: store.listImportReceipts("operator-lab"),
          second: store.listImportReceipts("second-lab")
        },
        importHistory: {
          operator: store.listWorkspaceImportEvents("operator-lab"),
          second: store.listWorkspaceImportEvents("second-lab")
        },
        currentDecision: store.getReviewDecision(scope),
        decisionHistory: store.listReviewDecisionEvents(scope),
        ledger: {
          ok: ledger.ok,
          entries: ledger.entries,
          headHash: ledger.headHash,
          errors: ledger.errors
        },
        ledgerEntries: store.listTrustLedger(),
        proofSourceHashes: store.listProofSources(bundleId),
        proofBundleRevisions: store.listProofBundleRevisions(bundleId),
        trustLineage: store.getWorkspace("operator-lab")?.trust || null
      }
    };
  } finally {
    store.close();
  }
}

function startServer() {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    env: { ...process.env, HALBA_STATE_FILE: stateFile, OPENAI_API_KEY: "", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderrText = "";
  child.stderr.on("data", (chunk) => { child.stderrText += String(chunk); });
  return child;
}

async function assertRemoteBindRejected() {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    env: {
      ...process.env,
      HALBA_STATE_FILE: "",
      HALBA_HOST: "0.0.0.0",
      HALBA_ALLOW_REMOTE: "",
      OPENAI_API_KEY: "",
      PORT: String(port + 1)
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exitCode = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("remote bind rejection timed out")), 3000))
  ]);
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /Refusing non-loopback HALBA_HOST/);
}

async function waitForServer(child) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(child.stderrText || `server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/runtime`, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(child.stderrText || "durable server did not become ready");
}

async function stopServer(child, signal = "SIGTERM") {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill(signal);
  await exited;
  if (server === child) server = null;
}

async function getJson(pathname) {
  const response = await fetch(`${origin}${pathname}`);
  assert.equal(response.status, 200, `${pathname} returned ${response.status}`);
  return response.json();
}

function postJson(pathname, body) {
  return jsonRequest("POST", pathname, body);
}

function putJson(pathname, body) {
  return jsonRequest("PUT", pathname, body);
}

function deleteJson(pathname, body) {
  return jsonRequest("DELETE", pathname, body);
}

function jsonRequest(method, pathname, body) {
  return fetch(`${origin}${pathname}`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body)
  });
}
