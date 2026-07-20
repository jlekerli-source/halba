import { createHash } from "node:crypto";

import { validateWorkspace } from "../../public/shared/workspace-contract.js";

export const trustPackSchemaVersion = 1;
export const trustLedgerGenesisHash = "0".repeat(64);
export const trustPackIntegrity = Object.freeze({
  algorithm: "sha256-canonical-json-v1",
  mode: "unsigned-local",
  assurance: "integrity-only-no-identity-authenticity",
  privacyScope: "full-local-ledger-payloads"
});
export const trustPackLimits = Object.freeze({
  importHistoryEntries: 4096,
  decisionHistoryEntries: 16384,
  ledgerEntries: 32768,
  proofRecords: 512,
  sourcesPerProof: 64,
  totalSources: 4096,
  sourceBytes: 4 * 1024 * 1024,
  totalSourceBytes: 64 * 1024 * 1024,
  payloadBytes: 2 * 1024 * 1024
});

const digestPattern = /^[a-f0-9]{64}$/;
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const ledgerEventTypes = new Set(["workspace_import", "decision_set", "decision_deleted"]);
const importFields = [
  "eventId", "receiptId", "workspaceId", "adapter", "sourceRef", "sourceDigest", "status",
  "counts", "warnings", "importedAt", "recordedAt"
];
const decisionFields = [
  "eventId", "action", "schemaVersion", "workspaceId", "threadId", "bundleId", "claimId",
  "evidenceIdentity", "status", "note", "updatedAt", "recordedAt", "origin"
];
const countFields = ["agents", "channels", "proofSources", "reviewGates", "runs"];
const packFields = ["decisionHistory", "importHistory", "integrity", "ledger", "proofRecords", "schemaVersion", "workspace"];
const integrityFields = ["algorithm", "assurance", "mode", "packDigest", "privacyScope", "sectionDigests"];
const sectionDigestFields = ["decisionHistory", "importHistory", "ledger", "proofRecords", "workspace"];
const ledgerFields = [
  "entryHash", "eventRef", "eventType", "payloadDigest", "payloadJson", "previousHash",
  "recordedAt", "sequence", "workspaceId"
];
const proofFields = [
  "bundle", "bundleDigest", "importedAt", "sourceDigest", "sources", "threadId", "workspaceId"
];
const sourceFields = ["byteCount", "bytesBase64", "kind", "label", "lineCount", "path", "sha256"];

function fail(message) {
  throw new Error(`invalid trust pack: ${message}`);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object`);
  return value;
}

function exactFields(value, fields, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail(`${label} has unknown, missing, or unsafe schema fields`);
  }
}

function boundedString(value, label, max = 4096, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && value.length === 0) || value.length > max) {
    fail(`${label} must be a bounded string`);
  }
  return value;
}

function timestamp(value, label) {
  boundedString(value, label, 64);
  if (!Number.isFinite(Date.parse(value))) fail(`${label} must be a timestamp`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !digestPattern.test(value)) fail(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`);
  return value;
}

function assertJsonValue(value, label = "value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`);
    return;
  }
  if (typeof value !== "object" || ArrayBuffer.isView(value)) fail(`${label} must contain only JSON values`);
  if (seen.has(value)) fail(`${label} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${label}[${index}]`, seen));
  } else {
    plainObject(value, label);
    for (const [key, entry] of Object.entries(value)) {
      if (unsafeKeys.has(key)) fail(`${label} contains an unsafe key`);
      assertJsonValue(entry, `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
}

export function canonicalJson(value) {
  assertJsonValue(value);
  return canonicalJsonUnchecked(value);
}

function canonicalJsonUnchecked(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonUnchecked).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonUnchecked(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalSha256(value) {
  return sha256(canonicalJson(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalClone(value) {
  return JSON.parse(canonicalJson(value));
}

export function trustLedgerEntryHash(entry) {
  const fields = {
    sequence: entry?.sequence,
    workspaceId: entry?.workspaceId,
    eventType: entry?.eventType,
    eventRef: entry?.eventRef,
    payloadDigest: entry?.payloadDigest,
    previousHash: entry?.previousHash,
    recordedAt: entry?.recordedAt
  };
  validateLedgerHashFields(fields);
  return canonicalSha256(fields);
}

function validateLedgerHashFields(entry) {
  positiveInteger(entry.sequence, "ledger sequence");
  boundedString(entry.workspaceId, "ledger workspaceId", 256);
  if (!ledgerEventTypes.has(entry.eventType)) fail("ledger eventType is unsupported");
  boundedString(entry.eventRef, "ledger eventRef", 512);
  digest(entry.payloadDigest, "ledger payloadDigest");
  digest(entry.previousHash, "ledger previousHash");
  timestamp(entry.recordedAt, "ledger recordedAt");
}

function normalizeLedgerEntry(entry, index) {
  plainObject(entry, `ledger[${index}]`);
  const payloadJson = entry.payloadJson ?? canonicalJson(entry.payload);
  boundedString(payloadJson, `ledger[${index}].payloadJson`, trustPackLimits.payloadBytes);
  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    fail(`ledger[${index}].payloadJson must be JSON`);
  }
  const canonicalPayloadJson = canonicalJson(payload);
  if (canonicalPayloadJson !== payloadJson) fail(`ledger[${index}].payloadJson must be canonical JSON`);
  const normalized = {
    sequence: entry.sequence,
    workspaceId: entry.workspaceId,
    eventType: entry.eventType,
    eventRef: entry.eventRef,
    payloadJson,
    payloadDigest: entry.payloadDigest,
    previousHash: entry.previousHash,
    entryHash: entry.entryHash,
    recordedAt: entry.recordedAt
  };
  validateLedgerHashFields(normalized);
  digest(normalized.entryHash, `ledger[${index}].entryHash`);
  if (sha256(payloadJson) !== normalized.payloadDigest) fail(`ledger sequence ${normalized.sequence} payload digest mismatch`);
  return normalized;
}

export function verifyTrustLedger(ledger) {
  if (!Array.isArray(ledger)) fail("ledger must be an array");
  if (ledger.length > trustPackLimits.ledgerEntries) fail(`ledger exceeds ${trustPackLimits.ledgerEntries} entries`);
  const normalized = [];
  const eventIdentities = new Set();
  let previousHash = trustLedgerGenesisHash;
  for (let index = 0; index < ledger.length; index += 1) {
    const input = ledger[index];
    exactFields(input, ledgerFields, `ledger[${index}]`);
    const entry = normalizeLedgerEntry(input, index);
    const expectedSequence = index + 1;
    if (entry.sequence !== expectedSequence) fail(`ledger sequence ${entry.sequence} is reordered, missing, or duplicated; expected ${expectedSequence}`);
    if (entry.previousHash !== previousHash) fail(`ledger sequence ${entry.sequence} has a broken previous hash`);
    if (trustLedgerEntryHash(entry) !== entry.entryHash) fail(`ledger sequence ${entry.sequence} entry hash mismatch`);
    const identity = `${entry.eventType}\0${entry.eventRef}`;
    if (eventIdentities.has(identity)) fail(`ledger sequence ${entry.sequence} duplicates an event identity`);
    eventIdentities.add(identity);
    normalized.push(entry);
    previousHash = entry.entryHash;
  }
  return {
    ledger: normalized,
    entries: normalized.length,
    headHash: previousHash,
    algorithm: trustPackIntegrity.algorithm,
    mode: trustPackIntegrity.mode,
    identityAuthenticity: false
  };
}

function normalizeCounts(counts, label) {
  exactFields(counts, countFields, label);
  return Object.fromEntries(countFields.map((field) => [field, nonNegativeInteger(counts[field], `${label}.${field}`)]));
}

function normalizeImportEvent(event, index) {
  exactFields(event, importFields, `importHistory[${index}]`);
  const warnings = event.warnings;
  if (!Array.isArray(warnings) || warnings.length > 128) fail(`importHistory[${index}].warnings must be a bounded array`);
  return {
    eventId: positiveInteger(event.eventId, `importHistory[${index}].eventId`),
    receiptId: boundedString(event.receiptId, `importHistory[${index}].receiptId`, 512),
    workspaceId: boundedString(event.workspaceId, `importHistory[${index}].workspaceId`, 256),
    adapter: boundedString(event.adapter, `importHistory[${index}].adapter`, 256),
    sourceRef: event.sourceRef === null ? null : boundedString(event.sourceRef, `importHistory[${index}].sourceRef`, 4096),
    sourceDigest: digest(event.sourceDigest, `importHistory[${index}].sourceDigest`),
    status: boundedString(event.status, `importHistory[${index}].status`, 64),
    counts: normalizeCounts(event.counts, `importHistory[${index}].counts`),
    warnings: warnings.map((warning, warningIndex) => boundedString(warning, `importHistory[${index}].warnings[${warningIndex}]`, 500, { empty: true })),
    importedAt: timestamp(event.importedAt, `importHistory[${index}].importedAt`),
    recordedAt: timestamp(event.recordedAt, `importHistory[${index}].recordedAt`)
  };
}

function normalizeDecisionEvent(event, index) {
  exactFields(event, decisionFields, `decisionHistory[${index}]`);
  if (!new Set(["set", "deleted"]).has(event.action)) fail(`decisionHistory[${index}].action is unsupported`);
  if (event.schemaVersion !== 1) fail(`decisionHistory[${index}].schemaVersion is unsupported`);
  return {
    eventId: positiveInteger(event.eventId, `decisionHistory[${index}].eventId`),
    action: event.action,
    schemaVersion: 1,
    workspaceId: boundedString(event.workspaceId, `decisionHistory[${index}].workspaceId`, 256),
    threadId: boundedString(event.threadId, `decisionHistory[${index}].threadId`, 256),
    bundleId: boundedString(event.bundleId, `decisionHistory[${index}].bundleId`, 256),
    claimId: boundedString(event.claimId, `decisionHistory[${index}].claimId`, 256),
    evidenceIdentity: boundedString(event.evidenceIdentity, `decisionHistory[${index}].evidenceIdentity`, 65536),
    status: boundedString(event.status, `decisionHistory[${index}].status`, 64),
    note: boundedString(event.note, `decisionHistory[${index}].note`, 4000, { empty: true }),
    updatedAt: timestamp(event.updatedAt, `decisionHistory[${index}].updatedAt`),
    recordedAt: timestamp(event.recordedAt, `decisionHistory[${index}].recordedAt`),
    origin: boundedString(event.origin, `decisionHistory[${index}].origin`, 64)
  };
}

function normalizeHistory(history, label, limit, normalizer, workspaceId) {
  if (!Array.isArray(history) || history.length > limit) fail(`${label} must be an array with at most ${limit} entries`);
  let previousEventId = 0;
  return history.map((event, index) => {
    const normalized = normalizer(event, index);
    if (normalized.eventId <= previousEventId) fail(`${label} is reordered or has a missing/duplicated event sequence`);
    previousEventId = normalized.eventId;
    if (normalized.workspaceId !== workspaceId) fail(`${label}[${index}] references the wrong workspace`);
    return normalized;
  });
}

function safeSourcePath(value, label) {
  boundedString(value, label, 2048);
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[a-z]:/i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    fail(`${label} must be a safe relative path`);
  }
  if (!value.split("/").every((part) => part && part !== "." && part !== "..")) fail(`${label} must be a safe relative path`);
  return value;
}

function sourceBytes(source, label) {
  if (source.bytes !== undefined) {
    if (!(Buffer.isBuffer(source.bytes) || source.bytes instanceof Uint8Array)) fail(`${label}.bytes must be bytes`);
    return Buffer.from(source.bytes);
  }
  if (typeof source.bytesBase64 !== "string" || source.bytesBase64.length % 4 !== 0) fail(`${label}.bytesBase64 must be canonical base64`);
  const bytes = Buffer.from(source.bytesBase64, "base64");
  if (bytes.toString("base64") !== source.bytesBase64) fail(`${label}.bytesBase64 must be canonical base64`);
  return bytes;
}

function normalizeSource(source, label, { packInput = false } = {}) {
  plainObject(source, label);
  if (packInput) exactFields(source, sourceFields, label);
  const bytes = sourceBytes(source, label);
  if (bytes.length > trustPackLimits.sourceBytes) fail(`${label} exceeds ${trustPackLimits.sourceBytes} bytes`);
  const normalized = {
    path: safeSourcePath(source.path, `${label}.path`),
    kind: boundedString(source.kind, `${label}.kind`, 128),
    label: boundedString(source.label, `${label}.label`, 500),
    sha256: digest(source.sha256, `${label}.sha256`),
    lineCount: nonNegativeInteger(source.lineCount, `${label}.lineCount`),
    byteCount: nonNegativeInteger(source.byteCount, `${label}.byteCount`),
    bytesBase64: bytes.toString("base64")
  };
  if (normalized.byteCount !== bytes.length) fail(`${label} source byte count mismatch`);
  if (normalized.sha256 !== sha256(bytes)) fail(`${label} source hash mismatch`);
  const normalizedText = bytes.toString("utf8").replace(/\r\n?/g, "\n");
  const lines = normalizedText.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (normalized.lineCount !== lines.length) fail(`${label} source line count mismatch`);
  return { normalized, byteLength: bytes.length };
}

function proofBundleId(bundle, label) {
  const value = bundle?.definition?.id ?? bundle?.id;
  return boundedString(value, `${label}.bundle id`, 256);
}

function normalizeProofRecord(record, index, workspaceId, { packInput = false } = {}) {
  const label = `proofRecords[${index}]`;
  plainObject(record, label);
  if (packInput) exactFields(record, proofFields, label);
  const bundle = canonicalClone(record.bundle);
  const id = proofBundleId(bundle, label);
  if (!Array.isArray(bundle.sources)) fail(`${label}.bundle.sources must be an array`);
  const sources = packInput ? record.sources : record.sources?.map((source, sourceIndex) => {
    const declaration = bundle.sources?.find((candidate) => candidate.path === source.path);
    if (!declaration) fail(`${label}.sources[${sourceIndex}] has no matching bundle declaration`);
    if (source.encoding !== undefined && source.encoding !== "base64") fail(`${label}.sources[${sourceIndex}].encoding is unsupported`);
    return {
      ...declaration,
      ...source,
      bytesBase64: source.bytesBase64 ?? source.data
    };
  });
  if (!Array.isArray(sources) || sources.length > trustPackLimits.sourcesPerProof) {
    fail(`${label}.sources must contain at most ${trustPackLimits.sourcesPerProof} entries`);
  }
  if (sources.length !== bundle.sources.length) fail(`${label}.sources must exactly cover bundle source declarations`);
  const paths = new Set();
  let sourceBytesTotal = 0;
  const normalizedSources = sources.map((source, sourceIndex) => {
    const result = normalizeSource(source, `${label}.sources[${sourceIndex}]`, { packInput });
    const declaration = bundle.sources.find((candidate) => candidate.path === result.normalized.path);
    if (!declaration) fail(`${label}.sources[${sourceIndex}] has no matching bundle declaration`);
    for (const field of ["path", "kind", "label", "sha256", "lineCount", "byteCount"]) {
      if (declaration[field] !== result.normalized[field]) fail(`${label}.sources[${sourceIndex}] does not match its bundle declaration`);
    }
    if (paths.has(result.normalized.path)) fail(`${label} has duplicate source paths`);
    paths.add(result.normalized.path);
    sourceBytesTotal += result.byteLength;
    return result.normalized;
  });
  const normalized = {
    workspaceId: boundedString(record.workspaceId, `${label}.workspaceId`, 256),
    threadId: boundedString(record.threadId, `${label}.threadId`, 256),
    importedAt: timestamp(record.importedAt, `${label}.importedAt`),
    sourceDigest: digest(record.sourceDigest, `${label}.sourceDigest`),
    bundleDigest: packInput ? digest(record.bundleDigest, `${label}.bundleDigest`) : canonicalSha256(bundle),
    bundle,
    sources: normalizedSources
  };
  if (normalized.workspaceId !== workspaceId) fail(`${label} references the wrong workspace`);
  if (normalized.bundleDigest !== canonicalSha256(bundle)) fail(`${label} bundle digest mismatch`);
  return { normalized, id, sourceCount: normalizedSources.length, sourceBytesTotal };
}

function normalizeProofRecords(records, workspaceId, { packInput = false } = {}) {
  if (!Array.isArray(records) || records.length > trustPackLimits.proofRecords) {
    fail(`proofRecords must contain at most ${trustPackLimits.proofRecords} entries`);
  }
  const ids = new Set();
  let totalSources = 0;
  let totalSourceBytes = 0;
  const normalized = records.map((record, index) => {
    const result = normalizeProofRecord(record, index, workspaceId, { packInput });
    if (ids.has(result.id)) fail("proofRecords contains duplicate bundle ids");
    ids.add(result.id);
    totalSources += result.sourceCount;
    totalSourceBytes += result.sourceBytesTotal;
    if (totalSources > trustPackLimits.totalSources) fail(`proofRecords exceeds ${trustPackLimits.totalSources} sources`);
    if (totalSourceBytes > trustPackLimits.totalSourceBytes) fail(`proofRecords exceeds ${trustPackLimits.totalSourceBytes} source bytes`);
    return result.normalized;
  });
  return { normalized, totalSources, totalSourceBytes };
}

function ledgerPayload(entry) {
  return JSON.parse(entry.payloadJson);
}

function verifyHistoryLedgerCoverage(importHistory, decisionHistory, ledger, workspaceId) {
  const byIdentity = new Map(ledger.map((entry) => [`${entry.eventType}\0${entry.eventRef}`, entry]));
  const represented = new Set();
  for (const event of importHistory) {
    const entry = byIdentity.get(`workspace_import\0${event.receiptId}`);
    if (!entry || entry.workspaceId !== workspaceId) fail(`import history event ${event.eventId} is missing from the ledger`);
    const payload = ledgerPayload(entry);
    for (const field of ["receiptId", "workspaceId", "adapter", "sourceRef", "sourceDigest", "status", "importedAt"]) {
      if (payload[field] !== event[field]) fail(`import history event ${event.eventId} does not match its ledger payload`);
    }
    if (canonicalJson(payload.counts) !== canonicalJson(event.counts) || canonicalJson(payload.warnings) !== canonicalJson(event.warnings)) {
      fail(`import history event ${event.eventId} does not match its ledger payload`);
    }
    if (entry.recordedAt !== event.recordedAt) fail(`import history event ${event.eventId} does not match its ledger timestamp`);
    represented.add(`workspace_import\0${event.receiptId}`);
  }
  for (const event of decisionHistory) {
    const eventType = event.action === "set" ? "decision_set" : "decision_deleted";
    const entry = byIdentity.get(`${eventType}\0decision:${event.eventId}`);
    if (!entry || entry.workspaceId !== workspaceId) fail(`decision history event ${event.eventId} is missing from the ledger`);
    const payload = ledgerPayload(entry);
    for (const field of ["action", "schemaVersion", "workspaceId", "threadId", "bundleId", "claimId", "evidenceIdentity", "status", "note", "updatedAt", "origin"]) {
      if (payload[field] !== event[field]) fail(`decision history event ${event.eventId} does not match its ledger payload`);
    }
    if (entry.recordedAt !== event.recordedAt) fail(`decision history event ${event.eventId} does not match its ledger timestamp`);
    represented.add(`${eventType}\0decision:${event.eventId}`);
  }
  for (const entry of ledger) {
    if (entry.workspaceId !== workspaceId) continue;
    const identity = `${entry.eventType}\0${entry.eventRef}`;
    if (!represented.has(identity)) fail(`ledger event ${entry.eventRef} is omitted from the workspace history`);
  }
}

function verifyProofCoverage(workspace, decisionHistory, proofRecords) {
  const threads = new Map(workspace.threads.map((thread) => [thread.id, thread]));
  const proofs = new Map();
  for (const record of proofRecords) {
    const id = proofBundleId(record.bundle, "proof record");
    const thread = threads.get(record.threadId);
    if (!thread || thread.proofBundleId !== id) fail(`proof record ${id} is not attached to its declared workspace thread`);
    proofs.set(id, record);
  }
  for (const thread of workspace.threads) {
    if (thread.proofBundleId !== null && !proofs.has(thread.proofBundleId)) fail(`workspace proof ${thread.proofBundleId} is missing from proofRecords`);
  }
  for (const event of decisionHistory) {
    const proof = proofs.get(event.bundleId);
    if (!proof || proof.threadId !== event.threadId) fail(`decision history event ${event.eventId} references a missing proof record`);
  }
}

function sectionDigests(sections) {
  return Object.fromEntries(sectionDigestFields.map((field) => [field, canonicalSha256(sections[field])]));
}

function packDigestEnvelope(pack) {
  return {
    schemaVersion: pack.schemaVersion,
    integrity: {
      algorithm: pack.integrity.algorithm,
      mode: pack.integrity.mode,
      assurance: pack.integrity.assurance,
      privacyScope: pack.integrity.privacyScope,
      sectionDigests: pack.integrity.sectionDigests
    },
    workspace: pack.workspace,
    importHistory: pack.importHistory,
    decisionHistory: pack.decisionHistory,
    proofRecords: pack.proofRecords,
    ledger: pack.ledger
  };
}

export function buildTrustPack(snapshot) {
  plainObject(snapshot, "build input");
  const {
    workspace,
    importHistory = snapshot.imports ?? [],
    decisionHistory = snapshot.decisions ?? [],
    proofRecords = snapshot.proofs ?? [],
    ledger = []
  } = snapshot;
  const canonicalWorkspace = canonicalClone(validateWorkspace(canonicalClone(workspace)));
  const workspaceId = canonicalWorkspace.workspace.id;
  const canonicalImports = normalizeHistory(importHistory, "importHistory", trustPackLimits.importHistoryEntries, normalizeImportEvent, workspaceId);
  const canonicalDecisions = normalizeHistory(decisionHistory, "decisionHistory", trustPackLimits.decisionHistoryEntries, normalizeDecisionEvent, workspaceId);
  const canonicalProofs = normalizeProofRecords(proofRecords, workspaceId).normalized;
  const canonicalLedgerInput = ledger.map((entry) => ({
    sequence: entry.sequence,
    workspaceId: entry.workspaceId,
    eventType: entry.eventType,
    eventRef: entry.eventRef,
    payloadJson: entry.payloadJson ?? canonicalJson(entry.payload),
    payloadDigest: entry.payloadDigest,
    previousHash: entry.previousHash,
    entryHash: entry.entryHash,
    recordedAt: entry.recordedAt
  }));
  const canonicalLedger = verifyTrustLedger(canonicalLedgerInput).ledger;
  verifyHistoryLedgerCoverage(canonicalImports, canonicalDecisions, canonicalLedger, workspaceId);
  verifyProofCoverage(canonicalWorkspace, canonicalDecisions, canonicalProofs);
  const sections = {
    workspace: canonicalWorkspace,
    importHistory: canonicalImports,
    decisionHistory: canonicalDecisions,
    proofRecords: canonicalProofs,
    ledger: canonicalLedger
  };
  const pack = {
    schemaVersion: trustPackSchemaVersion,
    integrity: { ...trustPackIntegrity, sectionDigests: sectionDigests(sections), packDigest: "" },
    ...sections
  };
  pack.integrity.packDigest = canonicalSha256(packDigestEnvelope(pack));
  return pack;
}

export function verifyTrustPack(input) {
  exactFields(input, packFields, "root");
  if (input.schemaVersion !== trustPackSchemaVersion) fail(`schemaVersion must be ${trustPackSchemaVersion}`);
  exactFields(input.integrity, integrityFields, "integrity");
  exactFields(input.integrity.sectionDigests, sectionDigestFields, "integrity.sectionDigests");
  for (const [field, value] of Object.entries(trustPackIntegrity)) {
    if (input.integrity[field] !== value) fail(`integrity.${field} is unsupported`);
  }
  digest(input.integrity.packDigest, "integrity.packDigest");
  for (const field of sectionDigestFields) digest(input.integrity.sectionDigests[field], `integrity.sectionDigests.${field}`);

  const workspace = canonicalClone(validateWorkspace(canonicalClone(input.workspace)));
  const workspaceId = workspace.workspace.id;
  const importHistory = normalizeHistory(input.importHistory, "importHistory", trustPackLimits.importHistoryEntries, normalizeImportEvent, workspaceId);
  const decisionHistory = normalizeHistory(input.decisionHistory, "decisionHistory", trustPackLimits.decisionHistoryEntries, normalizeDecisionEvent, workspaceId);
  const proofSummary = normalizeProofRecords(input.proofRecords, workspaceId, { packInput: true });
  const ledgerSummary = verifyTrustLedger(input.ledger);
  verifyHistoryLedgerCoverage(importHistory, decisionHistory, ledgerSummary.ledger, workspaceId);
  verifyProofCoverage(workspace, decisionHistory, proofSummary.normalized);

  const sections = { workspace, importHistory, decisionHistory, proofRecords: proofSummary.normalized, ledger: ledgerSummary.ledger };
  const expectedSectionDigests = sectionDigests(sections);
  for (const field of sectionDigestFields) {
    if (input.integrity.sectionDigests[field] !== expectedSectionDigests[field]) fail(`${field} section digest mismatch`);
  }
  if (input.integrity.packDigest !== canonicalSha256(packDigestEnvelope(input))) fail("full pack digest mismatch");

  return {
    ok: true,
    schemaVersion: trustPackSchemaVersion,
    mode: trustPackIntegrity.mode,
    assurance: trustPackIntegrity.assurance,
    identityAuthenticity: false,
    workspaceId,
    importEvents: importHistory.length,
    decisionEvents: decisionHistory.length,
    proofRecords: proofSummary.normalized.length,
    proofSources: proofSummary.totalSources,
    proofSourceBytes: proofSummary.totalSourceBytes,
    ledgerEntries: ledgerSummary.entries,
    ledgerHeadHash: ledgerSummary.headHash,
    packDigest: input.integrity.packDigest
  };
}
