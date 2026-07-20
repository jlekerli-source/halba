import { createHash } from "node:crypto";

export const humanTrustSessionSchemaVersion = 1;
export const humanTrustTargetSeconds = 60;

export function buildHumanTrustTrial({ benchmark, report }) {
  invariant(benchmark && typeof benchmark === "object", "human trust trial requires a benchmark");
  invariant(report && typeof report === "object", "human trust trial requires a Trust Operations report");
  invariant((typeof benchmark.version === "string" && benchmark.version) || Number.isInteger(benchmark.version), "human trust benchmark version is required");
  invariant(typeof benchmark.expectedTopId === "string" && benchmark.expectedTopId, "human trust benchmark expected top id is required");
  invariant(report.items?.[0]?.id === benchmark.expectedTopId, "human trust trial requires the gold highest-risk issue to rank first");

  const expected = report.items[0];
  const core = {
    schemaVersion: humanTrustSessionSchemaVersion,
    corpusVersion: benchmark.version,
    evaluatedAt: benchmark.evaluatedAt,
    workspaceCount: benchmark.contexts.length,
    runCount: benchmark.runCount,
    attentionCount: report.items.length,
    targetSeconds: humanTrustTargetSeconds,
    expectedItemDigest: sha256(expected.id),
    reportDigest: canonicalSha256(report)
  };

  return {
    ...core,
    trialDigest: canonicalSha256(core),
    expectedItemId: expected.id,
    expectedReasonCodes: ["contradiction", "human_review_required"],
    expectedAuthority: "deterministic"
  };
}

export function buildHumanTrustSessionRecord({
  trial,
  participantAlias,
  facilitatorAlias,
  startedAt,
  endedAt,
  durationMs,
  observation,
  recordedAt = new Date().toISOString(),
  sessionId
}) {
  validateTrial(trial);
  validateAlias(participantAlias, "participant alias");
  validateAlias(facilitatorAlias, "facilitator alias");
  invariant(typeof sessionId === "string" && /^[0-9a-f-]{36}$/i.test(sessionId), "human trust session id must be a UUID");
  const started = timestamp(startedAt, "startedAt");
  const ended = timestamp(endedAt, "endedAt");
  timestamp(recordedAt, "recordedAt");
  invariant(ended >= started, "human trust session cannot end before it starts");
  invariant(Number.isFinite(durationMs) && durationMs > 0, "human trust duration must be positive");
  invariant(Math.abs((ended - started) - durationMs) <= 2_000, "human trust monotonic and wall-clock durations disagree");
  validateObservation(observation, trial);

  const scoring = {
    targetMs: trial.targetSeconds * 1_000,
    withinTarget: durationMs <= trial.targetSeconds * 1_000,
    highestRiskCorrect: observation.selectedItemId === trial.expectedItemId,
    contradictionIdentified: observation.contradictionIdentified,
    deterministicAuthorityIdentified: observation.deterministicAuthorityIdentified,
    humanDecisionIdentified: observation.humanDecisionIdentified,
    uninterrupted: observation.uninterrupted,
    unprompted: observation.unprompted
  };
  scoring.passed = Object.values(scoring).every((value) => typeof value !== "boolean" || value);

  const record = {
    schemaVersion: humanTrustSessionSchemaVersion,
    sessionId,
    trial: {
      corpusVersion: trial.corpusVersion,
      evaluatedAt: trial.evaluatedAt,
      workspaceCount: trial.workspaceCount,
      runCount: trial.runCount,
      attentionCount: trial.attentionCount,
      targetSeconds: trial.targetSeconds,
      expectedItemDigest: trial.expectedItemDigest,
      reportDigest: trial.reportDigest,
      trialDigest: trial.trialDigest
    },
    participantAlias,
    facilitatorAlias,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
    durationMs: rounded(durationMs),
    observation: {
      selectedItemId: observation.selectedItemId,
      contradictionIdentified: observation.contradictionIdentified,
      deterministicAuthorityIdentified: observation.deterministicAuthorityIdentified,
      humanDecisionIdentified: observation.humanDecisionIdentified,
      uninterrupted: observation.uninterrupted,
      unprompted: observation.unprompted,
      facilitatorNote: cleanNote(observation.facilitatorNote)
    },
    expectedItemId: trial.expectedItemId,
    scoring,
    attestation: "Facilitator attests that one human participant used the rendered Trust Inbox without advance disclosure of the expected answer, prompting, interruption, or automation.",
    recordedAt
  };

  return { ...record, recordDigest: canonicalSha256(record) };
}

export function verifyHumanTrustSessionRecord(record, trial) {
  invariant(record && typeof record === "object" && !Array.isArray(record), "human trust session must be an object");
  validateTrial(trial);
  invariant(record.schemaVersion === humanTrustSessionSchemaVersion, "unsupported human trust session schema");
  invariant(record.recordDigest === canonicalSha256(withoutDigest(record)), "human trust session digest mismatch");
  invariant(record.trial?.trialDigest === trial.trialDigest, "human trust trial digest mismatch");
  invariant(record.trial?.reportDigest === trial.reportDigest, "human trust report digest mismatch");
  invariant(record.expectedItemId === trial.expectedItemId, "human trust expected item mismatch");
  const rebuilt = buildHumanTrustSessionRecord({
    trial,
    participantAlias: record.participantAlias,
    facilitatorAlias: record.facilitatorAlias,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: record.durationMs,
    observation: record.observation,
    recordedAt: record.recordedAt,
    sessionId: record.sessionId
  });
  invariant(rebuilt.recordDigest === record.recordDigest, "human trust session fields are inconsistent");
  return {
    valid: true,
    passed: record.scoring.passed,
    durationSeconds: record.durationMs / 1_000,
    sessionId: record.sessionId,
    recordDigest: record.recordDigest
  };
}

export function humanTrustSessionMarkdown(record) {
  return `# Human Trust Inbox comprehension session

- Session: \`${record.sessionId}\`
- Participant: \`${record.participantAlias}\`
- Facilitator: \`${record.facilitatorAlias}\`
- Corpus: \`${record.trial.corpusVersion}\` (${record.trial.workspaceCount} workspaces, ${record.trial.runCount} runs)
- Started: ${record.startedAt}
- Duration: ${(record.durationMs / 1_000).toFixed(3)} seconds
- Highest-risk item correct: ${yes(record.scoring.highestRiskCorrect)}
- Contradiction identified: ${yes(record.scoring.contradictionIdentified)}
- Deterministic authority identified: ${yes(record.scoring.deterministicAuthorityIdentified)}
- Current human decision identified: ${yes(record.scoring.humanDecisionIdentified)}
- Uninterrupted and unprompted: ${yes(record.scoring.uninterrupted && record.scoring.unprompted)}
- Under ${record.trial.targetSeconds} seconds: ${yes(record.scoring.withinTarget)}
- Result: **${record.scoring.passed ? "PASS" : "FAIL"}**
- Record SHA-256: \`${record.recordDigest}\`

This record is a facilitator-attested local usability observation. Its digest detects later edits; it is not an identity signature and does not turn automation into human evidence.
`;
}

export function canonicalSha256(value) {
  return sha256(canonicalJson(value));
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function validateTrial(trial) {
  invariant(trial?.schemaVersion === humanTrustSessionSchemaVersion, "unsupported human trust trial schema");
  invariant(trial.targetSeconds === humanTrustTargetSeconds, "human trust target must remain 60 seconds");
  invariant(trial.trialDigest === canonicalSha256(withoutTrialSecrets(trial)), "human trust trial digest mismatch");
  invariant(trial.expectedItemDigest === sha256(trial.expectedItemId), "human trust expected item digest mismatch");
}

function withoutTrialSecrets(trial) {
  return {
    schemaVersion: trial.schemaVersion,
    corpusVersion: trial.corpusVersion,
    evaluatedAt: trial.evaluatedAt,
    workspaceCount: trial.workspaceCount,
    runCount: trial.runCount,
    attentionCount: trial.attentionCount,
    targetSeconds: trial.targetSeconds,
    expectedItemDigest: trial.expectedItemDigest,
    reportDigest: trial.reportDigest
  };
}

function validateObservation(value, trial) {
  invariant(value && typeof value === "object" && !Array.isArray(value), "human trust observation is required");
  invariant(typeof value.selectedItemId === "string" && value.selectedItemId, "human trust selected item is required");
  for (const field of ["contradictionIdentified", "deterministicAuthorityIdentified", "humanDecisionIdentified", "uninterrupted", "unprompted"]) {
    invariant(typeof value[field] === "boolean", `human trust observation ${field} must be boolean`);
  }
  invariant(!value.facilitatorNote || String(value.facilitatorNote).length <= 500, "human trust facilitator note is too long");
  invariant(trial.expectedReasonCodes.includes("contradiction") && trial.expectedReasonCodes.includes("human_review_required"), "human trust trial reason rubric is incomplete");
  invariant(trial.expectedAuthority === "deterministic", "human trust authority rubric must remain deterministic");
}

function validateAlias(value, label) {
  invariant(typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value), `${label} must be a privacy-safe token`);
}

function cleanNote(value) {
  return String(value || "").trim().replace(/[\r\n]+/g, " ").slice(0, 500);
}

function timestamp(value, label) {
  const result = Date.parse(value);
  invariant(Number.isFinite(result), `human trust ${label} must be an ISO timestamp`);
  return result;
}

function withoutDigest(record) {
  const { recordDigest, ...rest } = record;
  return rest;
}

function rounded(value) {
  return Math.round(value * 1_000) / 1_000;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function yes(value) {
  return value ? "yes" : "no";
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
