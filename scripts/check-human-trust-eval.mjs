import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildHumanTrustSessionRecord,
  buildHumanTrustTrial,
  canonicalJson,
  canonicalSha256,
  humanTrustPublicReceipt,
  resolveHumanTrustPrivateRoot,
  verifyHumanTrustPublicReceipt,
  verifyHumanTrustSessionRecord
} from "../src/domain/human-trust-eval.js";
import { buildTrustOperations } from "../src/domain/trust-operations.js";
import { buildTrustBenchmark } from "./trust-benchmark-fixture.mjs";

const benchmark = buildTrustBenchmark();
const report = buildTrustOperations({ contexts: benchmark.contexts, evaluatedAt: benchmark.evaluatedAt });
const trial = buildHumanTrustTrial({ benchmark, report });
assert.equal(trial.expectedItemId, benchmark.expectedTopId);
assert.equal(trial.targetSeconds, 60);
assert.equal(buildHumanTrustTrial({ benchmark, report }).trialDigest, trial.trialDigest);

const base = {
  trial,
  participantAlias: "participant-01",
  facilitatorAlias: "facilitator-01",
  startedAt: "2026-08-03T10:00:00.000Z",
  endedAt: "2026-08-03T10:00:42.000Z",
  durationMs: 42_000,
  protocol: {
    freshParticipant: true,
    facilitatorIndependent: true,
    noPriorExposure: true,
    informedConsent: true,
    freshBrowserProfile: true
  },
  observation: {
    selectedItemId: benchmark.expectedTopId,
    contradictionIdentified: true,
    deterministicAuthorityIdentified: true,
    humanDecisionIdentified: true,
    uninterrupted: true,
    unprompted: true,
    participantResponseParaphrase: "The release claim is contradicted by deterministic evidence and needs a current human decision.",
    facilitatorNote: "Participant explained the deterministic contradiction before opening Proof Mode."
  },
  recordedAt: "2026-08-03T10:01:00.000Z",
  sessionId: randomUUID()
};

const passing = buildHumanTrustSessionRecord(base);
assert.equal(passing.scoring.passed, true);
assert.equal(verifyHumanTrustSessionRecord(passing, trial).durationSeconds, 42);
const publicReceipt = humanTrustPublicReceipt(passing);
assert.equal(publicReceipt.result, "passed");
assert.equal(publicReceipt.durationMs, 42_000);
assert.equal(verifyHumanTrustPublicReceipt(publicReceipt, trial).passed, true);
assert.match(publicReceipt.responseDigest, /^[0-9a-f]{64}$/);
const alternateResponse = buildHumanTrustSessionRecord({
  ...base,
  observation: { ...base.observation, participantResponseParaphrase: "The participant gave a different privacy-safe explanation of the same review choice." },
  sessionId: randomUUID()
});
assert.notEqual(humanTrustPublicReceipt(alternateResponse).responseDigest, publicReceipt.responseDigest);
assert.equal(JSON.stringify(publicReceipt).includes(base.participantAlias), false);
assert.equal(JSON.stringify(publicReceipt).includes(base.facilitatorAlias), false);
assert.equal(JSON.stringify(publicReceipt).includes(base.observation.participantResponseParaphrase), false);
assert.equal(JSON.stringify(publicReceipt).includes(base.observation.facilitatorNote), false);

for (const mutation of [
  { durationMs: 60_001, endedAt: "2026-08-03T10:01:00.001Z" },
  { observation: { ...base.observation, selectedItemId: report.items[1].id } },
  { observation: { ...base.observation, contradictionIdentified: false } },
  { observation: { ...base.observation, deterministicAuthorityIdentified: false } },
  { observation: { ...base.observation, humanDecisionIdentified: false } },
  { observation: { ...base.observation, uninterrupted: false } },
  { observation: { ...base.observation, unprompted: false } },
  { protocol: { ...base.protocol, facilitatorIndependent: false } },
  { protocol: { ...base.protocol, noPriorExposure: false } }
]) {
  assert.equal(buildHumanTrustSessionRecord({ ...base, ...mutation, sessionId: randomUUID() }).scoring.passed, false);
}

const tampered = structuredClone(passing);
tampered.durationMs = 12_000;
assert.throws(() => verifyHumanTrustSessionRecord(tampered, trial), /digest mismatch/);
const responseTampered = structuredClone(passing);
responseTampered.observation.participantResponseParaphrase = "A different private response was substituted after the trial.";
assert.throws(() => verifyHumanTrustSessionRecord(responseTampered, trial), /digest mismatch/);
assert.throws(() => buildHumanTrustSessionRecord({ ...base, participantAlias: "A Person" }), /privacy-safe token/);
assert.throws(() => buildHumanTrustSessionRecord({ ...base, facilitatorAlias: "PARTICIPANT-01" }), /aliases must be distinct/);
assert.throws(() => buildHumanTrustSessionRecord({ ...base, observation: { ...base.observation, participantResponseParaphrase: "too short" } }), /paraphrase is required/);

const receiptTampered = structuredClone(publicReceipt);
receiptTampered.responseDigest = "0".repeat(64);
assert.throws(() => verifyHumanTrustPublicReceipt(receiptTampered, trial), /digest mismatch/);
const predicateForgery = resignReceipt({ ...publicReceipt, durationMs: 60_001 });
assert.throws(() => verifyHumanTrustPublicReceipt(predicateForgery, trial), /result does not match/);
const trialForgery = resignReceipt({ ...publicReceipt, trialDigest: "0".repeat(64) });
assert.throws(() => verifyHumanTrustPublicReceipt(trialForgery, trial), /trial mismatch/);
const privacyLeak = resignReceipt({ ...publicReceipt, participantAlias: base.participantAlias });
assert.throws(() => verifyHumanTrustPublicReceipt(privacyLeak, trial), /fields are invalid/);

const repoRoot = path.resolve("/tmp/halba-human-trust-test-repo");
assert.equal(resolveHumanTrustPrivateRoot(repoRoot, path.join(repoRoot, ".halba", "evals")), path.join(repoRoot, ".halba", "evals"));
assert.throws(() => resolveHumanTrustPrivateRoot(repoRoot, path.join(repoRoot, "private-evals")), /must remain inside/);
assert.throws(() => resolveHumanTrustPrivateRoot(repoRoot, path.join(repoRoot, ".halba-escape")), /must remain inside/);

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harnessSource = await readFile(path.join(scriptRoot, "scripts", "human-trust-inbox-eval.mjs"), "utf8");
assert.ok(harnessSource.indexOf("participantResponseParaphrase = await terminal.question") < harnessSource.indexOf("report.items.forEach"), "participant response must be captured before rubric output");
for (const chromeBoundary of ["--user-data-dir=", "--disable-extensions", "--window-size=1440,1000", "terminate(browser, { processGroup: true })"]) {
  assert.ok(harnessSource.includes(chromeBoundary), `isolated Chrome boundary missing: ${chromeBoundary}`);
}
assert.equal(harnessSource.includes("--incognito"), false);

const packageJson = JSON.parse(await readFile(path.join(scriptRoot, "package.json"), "utf8"));
assert.equal(packageJson.scripts["release:goal"], "node scripts/release-check.mjs --require-human");
const releaseSource = await readFile(path.join(scriptRoot, "scripts", "release-check.mjs"), "utf8");
assert.ok(releaseSource.includes("verifyHumanTrustPublicReceipt(receipt, trial)"));
assert.ok(releaseSource.indexOf('await run("npm run eval:goal", root)') < releaseSource.indexOf("await rm(packageRoot"), "goal eval must run before the release build");
assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');

console.log("check passed: human Trust Inbox timing records require a real interactive harness, exact top issue, deterministic explanation, human action, no prompting, and <=60 seconds");

function resignReceipt(receipt) {
  const { receiptDigest, ...core } = receipt;
  return { ...core, receiptDigest: canonicalSha256(core) };
}
