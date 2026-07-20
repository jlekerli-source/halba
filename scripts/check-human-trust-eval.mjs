import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  buildHumanTrustSessionRecord,
  buildHumanTrustTrial,
  canonicalJson,
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
  observation: {
    selectedItemId: benchmark.expectedTopId,
    contradictionIdentified: true,
    deterministicAuthorityIdentified: true,
    humanDecisionIdentified: true,
    uninterrupted: true,
    unprompted: true,
    facilitatorNote: "Participant explained the deterministic contradiction before opening Proof Mode."
  },
  recordedAt: "2026-08-03T10:01:00.000Z",
  sessionId: randomUUID()
};

const passing = buildHumanTrustSessionRecord(base);
assert.equal(passing.scoring.passed, true);
assert.equal(verifyHumanTrustSessionRecord(passing, trial).durationSeconds, 42);

for (const mutation of [
  { durationMs: 60_001, endedAt: "2026-08-03T10:01:00.001Z" },
  { observation: { ...base.observation, selectedItemId: report.items[1].id } },
  { observation: { ...base.observation, contradictionIdentified: false } },
  { observation: { ...base.observation, deterministicAuthorityIdentified: false } },
  { observation: { ...base.observation, humanDecisionIdentified: false } },
  { observation: { ...base.observation, uninterrupted: false } },
  { observation: { ...base.observation, unprompted: false } }
]) {
  assert.equal(buildHumanTrustSessionRecord({ ...base, ...mutation, sessionId: randomUUID() }).scoring.passed, false);
}

const tampered = structuredClone(passing);
tampered.durationMs = 12_000;
assert.throws(() => verifyHumanTrustSessionRecord(tampered, trial), /digest mismatch/);
assert.throws(() => buildHumanTrustSessionRecord({ ...base, participantAlias: "A Person" }), /privacy-safe token/);
assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');

console.log("check passed: human Trust Inbox timing records require a real interactive harness, exact top issue, deterministic explanation, human action, no prompting, and <=60 seconds");
