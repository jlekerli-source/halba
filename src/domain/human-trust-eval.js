import { createHash } from "node:crypto";
import path from "node:path";

export const humanTrustSessionSchemaVersion = 3;
export const humanTrustPublicReceiptSchemaVersion = 2;
export const humanTrustTargetSeconds = 60;

const humanTrustPublicReceiptCaveat = "Facilitator attestation with edit detection; not identity proof. Private aliases, response text, and notes are excluded.";

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
  protocol,
  observation,
  recordedAt = new Date().toISOString(),
  sessionId
}) {
  validateTrial(trial);
  validateHumanTrustAliases(participantAlias, facilitatorAlias);
  invariant(typeof sessionId === "string" && /^[0-9a-f-]{36}$/i.test(sessionId), "human trust session id must be a UUID");
  const started = timestamp(startedAt, "startedAt");
  const ended = timestamp(endedAt, "endedAt");
  timestamp(recordedAt, "recordedAt");
  invariant(ended >= started, "human trust session cannot end before it starts");
  invariant(Number.isFinite(durationMs) && durationMs > 0, "human trust duration must be positive");
  invariant(Math.abs((ended - started) - durationMs) <= 2_000, "human trust monotonic and wall-clock durations disagree");
  validateProtocol(protocol);
  validateObservation(observation, trial);

  const scoring = {
    targetMs: trial.targetSeconds * 1_000,
    withinTarget: durationMs <= trial.targetSeconds * 1_000,
    highestRiskCorrect: observation.selectedItemId === trial.expectedItemId,
    contradictionIdentified: observation.contradictionIdentified,
    deterministicAuthorityIdentified: observation.deterministicAuthorityIdentified,
    humanDecisionIdentified: observation.humanDecisionIdentified,
    uninterrupted: observation.uninterrupted,
    unprompted: observation.unprompted,
    protocolEligible: Object.values(protocol).every(Boolean)
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
    protocol: {
      freshParticipant: protocol.freshParticipant,
      facilitatorIndependent: protocol.facilitatorIndependent,
      noPriorExposure: protocol.noPriorExposure,
      informedConsent: protocol.informedConsent,
      freshBrowserProfile: protocol.freshBrowserProfile
    },
    observation: {
      selectedItemId: observation.selectedItemId,
      contradictionIdentified: observation.contradictionIdentified,
      deterministicAuthorityIdentified: observation.deterministicAuthorityIdentified,
      humanDecisionIdentified: observation.humanDecisionIdentified,
      uninterrupted: observation.uninterrupted,
      unprompted: observation.unprompted,
      participantResponseParaphrase: cleanParticipantResponse(observation.participantResponseParaphrase),
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
    protocol: record.protocol,
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
- Fresh participant with no prior answer exposure: ${yes(record.protocol.freshParticipant && record.protocol.noPriorExposure)}
- Independent facilitator: ${yes(record.protocol.facilitatorIndependent)}
- Anonymous usability consent and fresh browser profile: ${yes(record.protocol.informedConsent && record.protocol.freshBrowserProfile)}
- Highest-risk item correct: ${yes(record.scoring.highestRiskCorrect)}
- Contradiction identified: ${yes(record.scoring.contradictionIdentified)}
- Deterministic authority identified: ${yes(record.scoring.deterministicAuthorityIdentified)}
- Current human decision identified: ${yes(record.scoring.humanDecisionIdentified)}
- Uninterrupted and unprompted: ${yes(record.scoring.uninterrupted && record.scoring.unprompted)}
- Under ${record.trial.targetSeconds} seconds: ${yes(record.scoring.withinTarget)}
- Participant response paraphrase: ${record.observation.participantResponseParaphrase}
- Result: **${record.scoring.passed ? "PASS" : "FAIL"}**
- Record SHA-256: \`${record.recordDigest}\`

This record is a facilitator-attested local usability observation. Its digest detects later edits; it is not an identity signature and does not turn automation into human evidence.
`;
}

export function humanTrustPublicReceipt(record) {
  const core = {
    schemaVersion: humanTrustPublicReceiptSchemaVersion,
    evidenceType: "facilitator_attested_human_comprehension",
    result: record.scoring.passed ? "passed" : "failed",
    sessionId: record.sessionId,
    corpusVersion: record.trial.corpusVersion,
    trialDigest: record.trial.trialDigest,
    reportDigest: record.trial.reportDigest,
    targetSeconds: record.trial.targetSeconds,
    durationMs: record.durationMs,
    highestRiskCorrect: record.scoring.highestRiskCorrect,
    contradictionIdentified: record.scoring.contradictionIdentified,
    deterministicAuthorityIdentified: record.scoring.deterministicAuthorityIdentified,
    humanDecisionIdentified: record.scoring.humanDecisionIdentified,
    uninterrupted: record.scoring.uninterrupted,
    unprompted: record.scoring.unprompted,
    protocolEligible: record.scoring.protocolEligible,
    rawRecordDigest: record.recordDigest,
    responseDigest: sha256(record.observation.participantResponseParaphrase),
    recordedAt: record.recordedAt,
    caveat: humanTrustPublicReceiptCaveat
  };
  return { ...core, receiptDigest: canonicalSha256(core) };
}

export function verifyHumanTrustPublicReceipt(receipt, trial) {
  invariant(receipt && typeof receipt === "object" && !Array.isArray(receipt), "human trust public receipt must be an object");
  validateTrial(trial);
  invariant(receipt.schemaVersion === humanTrustPublicReceiptSchemaVersion, "unsupported human trust public receipt schema");

  const expectedFields = [
    "caveat",
    "contradictionIdentified",
    "corpusVersion",
    "deterministicAuthorityIdentified",
    "durationMs",
    "evidenceType",
    "highestRiskCorrect",
    "humanDecisionIdentified",
    "protocolEligible",
    "rawRecordDigest",
    "receiptDigest",
    "recordedAt",
    "reportDigest",
    "responseDigest",
    "result",
    "schemaVersion",
    "sessionId",
    "targetSeconds",
    "trialDigest",
    "uninterrupted",
    "unprompted"
  ];
  invariant(JSON.stringify(Object.keys(receipt).sort()) === JSON.stringify(expectedFields), "human trust public receipt fields are invalid");
  invariant(receipt.evidenceType === "facilitator_attested_human_comprehension", "human trust public receipt evidence type is invalid");
  invariant(receipt.caveat === humanTrustPublicReceiptCaveat, "human trust public receipt caveat is invalid");
  invariant(typeof receipt.sessionId === "string" && /^[0-9a-f-]{36}$/i.test(receipt.sessionId), "human trust public receipt session id must be a UUID");
  invariant(receipt.corpusVersion === trial.corpusVersion, "human trust public receipt corpus mismatch");
  invariant(receipt.trialDigest === trial.trialDigest, "human trust public receipt trial mismatch");
  invariant(receipt.reportDigest === trial.reportDigest, "human trust public receipt report mismatch");
  invariant(receipt.targetSeconds === trial.targetSeconds, "human trust public receipt target mismatch");
  invariant(Number.isFinite(receipt.durationMs) && receipt.durationMs > 0, "human trust public receipt duration is invalid");
  for (const field of ["highestRiskCorrect", "contradictionIdentified", "deterministicAuthorityIdentified", "humanDecisionIdentified", "uninterrupted", "unprompted", "protocolEligible"]) {
    invariant(typeof receipt[field] === "boolean", `human trust public receipt ${field} must be boolean`);
  }
  invariant(isSha256(receipt.rawRecordDigest), "human trust public receipt raw record digest is invalid");
  invariant(isSha256(receipt.responseDigest), "human trust public receipt response digest is invalid");
  invariant(isSha256(receipt.receiptDigest), "human trust public receipt digest is invalid");
  timestamp(receipt.recordedAt, "public receipt recordedAt");

  const predicatesPassed = receipt.durationMs <= receipt.targetSeconds * 1_000
    && receipt.highestRiskCorrect
    && receipt.contradictionIdentified
    && receipt.deterministicAuthorityIdentified
    && receipt.humanDecisionIdentified
    && receipt.uninterrupted
    && receipt.unprompted
    && receipt.protocolEligible;
  invariant(receipt.result === (predicatesPassed ? "passed" : "failed"), "human trust public receipt result does not match its pass predicates");
  invariant(receipt.receiptDigest === canonicalSha256(withoutReceiptDigest(receipt)), "human trust public receipt digest mismatch");

  return {
    valid: true,
    passed: predicatesPassed,
    durationSeconds: receipt.durationMs / 1_000,
    sessionId: receipt.sessionId,
    rawRecordDigest: receipt.rawRecordDigest,
    responseDigest: receipt.responseDigest,
    receiptDigest: receipt.receiptDigest
  };
}

export function humanTrustPublicReceiptMarkdown(receipt) {
  return `# Human Trust Inbox judge receipt

- Result: **${receipt.result.toUpperCase()}**
- Duration: ${(receipt.durationMs / 1_000).toFixed(3)} seconds (target: ${receipt.targetSeconds} seconds)
- Highest-risk item, contradiction, deterministic authority, and human action identified: ${yes(receipt.highestRiskCorrect && receipt.contradictionIdentified && receipt.deterministicAuthorityIdentified && receipt.humanDecisionIdentified)}
- Uninterrupted and unprompted: ${yes(receipt.uninterrupted && receipt.unprompted)}
- Fresh-participant protocol eligible: ${yes(receipt.protocolEligible)}
- Trial SHA-256: \`${receipt.trialDigest}\`
- Private raw-record SHA-256: \`${receipt.rawRecordDigest}\`
- Participant response SHA-256: \`${receipt.responseDigest}\`
- Public receipt SHA-256: \`${receipt.receiptDigest}\`

This is a redacted facilitator attestation with edit detection, not identity proof. Participant and facilitator aliases, the participant response text, and the private observation note are deliberately excluded from the public artifact.
`;
}

export function validateHumanTrustAliases(participantAlias, facilitatorAlias) {
  validateAlias(participantAlias, "participant alias");
  validateAlias(facilitatorAlias, "facilitator alias");
  invariant(participantAlias.toLowerCase() !== facilitatorAlias.toLowerCase(), "participant and facilitator aliases must be distinct");
}

export function resolveHumanTrustPrivateRoot(repoRoot, requestedRoot) {
  const allowedRoot = path.join(path.resolve(repoRoot), ".halba");
  const candidate = path.resolve(requestedRoot);
  const relative = path.relative(allowedRoot, candidate);
  invariant(relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)), "human trust private root must remain inside the repository .halba directory");
  return candidate;
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
  cleanParticipantResponse(value.participantResponseParaphrase);
  invariant(!value.facilitatorNote || String(value.facilitatorNote).length <= 500, "human trust facilitator note is too long");
  invariant(trial.expectedReasonCodes.includes("contradiction") && trial.expectedReasonCodes.includes("human_review_required"), "human trust trial reason rubric is incomplete");
  invariant(trial.expectedAuthority === "deterministic", "human trust authority rubric must remain deterministic");
}

function validateProtocol(value) {
  invariant(value && typeof value === "object" && !Array.isArray(value), "human trust protocol attestation is required");
  for (const field of ["freshParticipant", "facilitatorIndependent", "noPriorExposure", "informedConsent", "freshBrowserProfile"]) {
    invariant(typeof value[field] === "boolean", `human trust protocol ${field} must be boolean`);
  }
}

function validateAlias(value, label) {
  invariant(typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value), `${label} must be a privacy-safe token`);
}

function cleanNote(value) {
  return String(value || "").trim().replace(/[\r\n]+/g, " ").slice(0, 500);
}

function cleanParticipantResponse(value) {
  const result = String(value || "").trim().replace(/\s+/g, " ");
  invariant(result.length >= 12, "human trust participant response paraphrase is required");
  invariant(result.length <= 300, "human trust participant response paraphrase is too long");
  return result;
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

function withoutReceiptDigest(receipt) {
  const { receiptDigest, ...rest } = receipt;
  return rest;
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
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
