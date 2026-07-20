import { decisionClosesGate, evidenceIdentity, reviewDecisionKey, reviewDecisionMatches } from "../../public/shared/review-contract.js";
import { trustCriticalities, validateTrustConfiguration } from "../../public/shared/trust-contract.js";
import { validateWorkspace } from "../../public/shared/workspace-contract.js";

export const trustOperationsSchemaVersion = 1;

const dayMs = 86_400_000;
const criticalityScore = Object.freeze({ low: 10, medium: 20, high: 30, critical: 40 });
const reasonScore = Object.freeze({
  contradiction: 100,
  unsafe_approval: 98,
  ambiguous_lineage: 96,
  failed_required_guard: 94,
  non_authoritative_verdict: 92,
  changed_since_trust: 90,
  unsupported: 86,
  dependency_affected: 82,
  missing_required_guard: 80,
  uncertain: 76,
  decision_expired: 74,
  failed_run: 72,
  stale: 68,
  freshness_expired: 66,
  human_review_required: 60,
  proof_requested: 58,
  missing_proof: 56,
  degraded_import: 52
});

export function buildTrustOperations({ contexts, evaluatedAt = new Date().toISOString() }) {
  if (!Array.isArray(contexts) || !contexts.length || contexts.length > 64) throw new Error("trust operations requires 1-64 workspace contexts");
  const evaluationTime = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluationTime)) throw new Error("trust operations evaluatedAt is invalid");
  const workspaceIds = new Set();
  const items = [];
  const claimItems = [];

  for (const rawContext of contexts) {
    const context = normalizeContext(rawContext, evaluationTime);
    const { workspace } = context;
    if (workspaceIds.has(workspace.workspace.id)) throw new Error(`trust operations workspace ${workspace.workspace.id} is duplicated`);
    workspaceIds.add(workspace.workspace.id);
    const evaluated = evaluateWorkspace(context, evaluationTime);
    items.push(...evaluated.items);
    claimItems.push(...evaluated.claimItems);
  }

  propagateDependencies(claimItems);
  for (const item of claimItems) if (item.reasons.length) items.push(finalizeItem(item));
  items.sort(compareAttention);
  const countsByReason = {};
  const countsByCriticality = Object.fromEntries(trustCriticalities.map((value) => [value, 0]));
  for (const item of items) {
    countsByCriticality[item.criticality] += 1;
    for (const reason of item.reasons) countsByReason[reason.code] = (countsByReason[reason.code] || 0) + 1;
  }
  return {
    schemaVersion: trustOperationsSchemaVersion,
    evaluatedAt: new Date(evaluationTime).toISOString(),
    workspaceCount: contexts.length,
    counts: { attention: items.length, byCriticality: countsByCriticality, byReason: countsByReason },
    items
  };
}

function normalizeContext(context, evaluationTime) {
  if (!context || typeof context !== "object" || Array.isArray(context)) throw new Error("trust operations context must be an object");
  const workspace = validateWorkspace(structuredClone(context.workspace));
  if (workspace.trust) validateTrustConfiguration(workspace);
  for (const field of ["proofRecords", "decisions", "receipts"]) {
    if (!Array.isArray(context[field] || [])) throw new Error(`trust operations ${field} must be an array`);
  }
  const checkpointAt = context.checkpointAt === undefined || context.checkpointAt === null ? null : new Date(context.checkpointAt).toISOString();
  if (checkpointAt && Date.parse(checkpointAt) > evaluationTime) throw new Error("trust operations checkpointAt cannot be later than evaluatedAt");
  return {
    workspace,
    proofRecords: context.proofRecords || [],
    decisions: context.decisions || [],
    receipts: context.receipts || [],
    checkpointAt
  };
}

function evaluateWorkspace(context, evaluationTime) {
  const { workspace, proofRecords, decisions, receipts, checkpointAt } = context;
  const workspaceId = workspace.workspace.id;
  const items = [];
  const claimItems = [];
  const boundThreads = new Set(workspace.trust?.bindings.map((binding) => binding.threadId) || []);
  for (const thread of workspace.threads) {
    if (thread.status !== "failed" || boundThreads.has(thread.id)) continue;
    items.push(finalizeItem({
      id: `run:${workspaceId}:${thread.id}`,
      kind: "run",
      workspaceId,
      threadId: thread.id,
      stableKey: null,
      bindingId: null,
      criticality: "high",
      criticalityAuthority: "deterministic-default",
      updatedAt: thread.updatedAt,
      newSinceCheckpoint: isNewSince(thread.updatedAt, checkpointAt),
      reasons: [reason("failed_run", `run ${thread.id} ended in failed state`)],
      evidence: { status: thread.status },
      target: { kind: "run", workspaceId, threadId: thread.id }
    }));
  }
  for (const receipt of latestReceiptsByAdapter(receipts)) {
    if (receipt.status !== "degraded") continue;
    items.push(finalizeItem({
      id: `import:${workspaceId}:${receipt.adapter}`,
      kind: "import",
      workspaceId,
      threadId: null,
      stableKey: null,
      bindingId: null,
      criticality: "medium",
      criticalityAuthority: "deterministic-default",
      updatedAt: receipt.importedAt,
      newSinceCheckpoint: isNewSince(receipt.importedAt, checkpointAt),
      reasons: [reason("degraded_import", `latest ${receipt.adapter} import is degraded`)],
      evidence: { receiptId: receipt.id, adapter: receipt.adapter, sourceDigest: receipt.sourceDigest },
      target: { kind: "import", workspaceId, receiptId: receipt.id }
    }));
  }
  if (!workspace.trust) return { items, claimItems };

  const threads = new Map(workspace.threads.map((thread) => [thread.id, thread]));
  const records = new Map(proofRecords.map((record) => [record.bundle?.id, record]));
  const decisionMap = new Map(decisions.map((decision) => [reviewDecisionKey(decision), decision]));
  const bindings = new Map(workspace.trust.bindings.map((binding) => [binding.id, binding]));
  const supersededIds = new Set(workspace.trust.bindings.flatMap((binding) => binding.supersedes));
  const tipsByStableKey = Map.groupBy(workspace.trust.bindings.filter((binding) => !supersededIds.has(binding.id)), (binding) => binding.stableKey);
  const observations = new Map();
  for (const binding of workspace.trust.bindings) observations.set(binding.id, bindingObservation(binding, threads, records, decisionMap, workspaceId));

  for (const binding of workspace.trust.bindings) {
    if (supersededIds.has(binding.id)) continue;
    const observation = observations.get(binding.id);
    const reasons = [];
    const dependencyHazards = [];
    if (!observation.finding) {
      reasons.push(reason("missing_proof", `binding ${binding.id} has no matching adjudicated proof finding`));
      dependencyHazards.push("missing_proof");
    } else {
      evaluateFinding({ binding, observation, policy: workspace.trust.policy, observations, bindings, reasons, dependencyHazards, evaluationTime });
    }
    if (observation.thread.status === "failed") {
      reasons.push(reason("failed_run", `run ${binding.threadId} ended in failed state`));
      dependencyHazards.push("failed_run");
    }
    if ((tipsByStableKey.get(binding.stableKey) || []).length > 1) {
      reasons.push(reason("ambiguous_lineage", `stable key ${binding.stableKey} has multiple current lineage tips`));
    }
    claimItems.push({
      id: `claim:${workspaceId}:${binding.id}`,
      kind: "claim",
      workspaceId,
      threadId: binding.threadId,
      stableKey: binding.stableKey,
      claim: observation.finding?.claim || `Claim text unavailable for ${binding.stableKey}.`,
      bindingId: binding.id,
      criticality: binding.criticality,
      criticalityAuthority: "declared-policy",
      updatedAt: threads.get(binding.threadId).updatedAt,
      newSinceCheckpoint: isNewSince(threads.get(binding.threadId).updatedAt, checkpointAt),
      dependsOn: binding.dependsOn,
      dependencyHazards,
      reasons,
      evidence: observation.finding ? {
        bundleId: observation.bundleId,
        claimId: binding.claimId,
        verdict: observation.finding.verdict,
        evidenceIdentity: observation.evidenceIdentity,
        policyId: workspace.trust.policy.id,
        policyVersion: workspace.trust.policy.version
      } : { claimId: binding.claimId, policyId: workspace.trust.policy.id, policyVersion: workspace.trust.policy.version },
      target: {
        kind: "claim",
        workspaceId,
        threadId: binding.threadId,
        bundleId: observation.bundleId,
        claimId: binding.claimId,
        evidenceIdentity: observation.evidenceIdentity
      }
    });
  }
  return { items, claimItems };
}

function evaluateFinding({ binding, observation, policy, observations, bindings, reasons, dependencyHazards, evaluationTime }) {
  const finding = observation.finding;
  const effective = effectiveDecision(binding, observation, observations, bindings);
  const freshnessDays = binding.freshnessDays || policy.defaultFreshnessDays;
  const decisionTtlDays = binding.decisionTtlDays || policy.defaultDecisionTtlDays;
  const generatedAt = Date.parse(observation.generatedAt);
  const freshnessExpired = evaluationTime - generatedAt > freshnessDays * dayMs;
  const decisionExpired = effective && evaluationTime - Date.parse(effective.decision.updatedAt) > decisionTtlDays * dayMs;
  const unsafeCodes = new Set();

  if (finding.verdictAuthority !== "deterministic") unsafeCodes.add("non_authoritative_verdict");
  else {
    if (finding.verdict === "contradictory") unsafeCodes.add("contradiction");
    if (finding.verdict === "unsupported") unsafeCodes.add("unsupported");
    if (finding.verdict === "uncertain") unsafeCodes.add("uncertain");
    if (finding.verdict === "stale") unsafeCodes.add("stale");
  }
  for (const guardName of binding.requiredGuards) {
    const guards = (finding.guardResults || []).filter((guard) => guard.type === guardName);
    if (!guards.length) unsafeCodes.add("missing_required_guard");
    else if (guards.some((guard) => !guard.passed)) unsafeCodes.add("failed_required_guard");
  }
  dependencyHazards.push(...unsafeCodes);

  const acknowledged = effective && !decisionExpired && ["rejected", "resolved"].includes(effective.decision.status);
  if (!acknowledged) for (const code of unsafeCodes) reasons.push(reason(code, findingReason(code, binding, observation)));
  if (effective?.decision.status === "approved" && [...unsafeCodes].some((code) => ["contradiction", "unsupported", "failed_required_guard"].includes(code))) {
    reasons.push(reason("unsafe_approval", `approved decision conflicts with deterministic evidence for ${binding.stableKey}`));
  }
  if (freshnessExpired) reasons.push(reason("freshness_expired", `proof is older than the declared ${freshnessDays}-day freshness window`));
  if (decisionExpired) reasons.push(reason("decision_expired", `decision is older than the declared ${decisionTtlDays}-day decision window`));

  const priorTrusted = latestPriorTrusted(binding, observations, bindings);
  if (priorTrusted && priorTrusted.evidenceIdentity !== observation.evidenceIdentity) {
    reasons.push(reason("changed_since_trust", `evidence changed after decision on binding ${priorTrusted.binding.id}`));
  }
  const currentDecision = observation.decision;
  if (currentDecision && !reviewDecisionMatches(currentDecision, observation.scope, observation.evidenceIdentity)) {
    reasons.push(reason("changed_since_trust", `current decision no longer matches the evidence identity for ${binding.stableKey}`));
  }
  if (currentDecision?.status === "more-proof") reasons.push(reason("proof_requested", `operator requested more proof for ${binding.stableKey}`));

  const humanRequired = finding.reviewRequired || policy.requireHumanDecisionFor.includes(binding.criticality);
  if (humanRequired && (!effective || decisionExpired || !decisionClosesGate(effective.decision))) {
    reasons.push(reason("human_review_required", `policy requires a current evidence-scoped human decision for ${binding.criticality} claim ${binding.stableKey}`));
  }
}

function bindingObservation(binding, threads, records, decisionMap, workspaceId) {
  const thread = threads.get(binding.threadId);
  const record = thread?.proofBundleId ? records.get(thread.proofBundleId) : null;
  const proof = record?.bundle?.adjudication;
  const finding = proof?.findings?.find((item) => item.claimId === binding.claimId) || null;
  const bundleId = record?.bundle?.id || thread?.proofBundleId || null;
  const scope = bundleId ? { workspaceId, threadId: binding.threadId, bundleId, claimId: binding.claimId } : null;
  return {
    binding,
    thread,
    record,
    finding,
    bundleId,
    scope,
    generatedAt: proof?.bundle?.generatedAt || null,
    evidenceIdentity: finding ? evidenceIdentity(finding) : null,
    decision: scope ? decisionMap.get(reviewDecisionKey(scope)) || null : null
  };
}

function effectiveDecision(binding, observation, observations, bindings) {
  if (validClosingDecision(observation)) return { decision: observation.decision, inherited: false };
  const prior = latestPriorTrusted(binding, observations, bindings);
  if (prior && prior.evidenceIdentity === observation.evidenceIdentity) return { decision: prior.decision, inherited: true, bindingId: prior.binding.id };
  return null;
}

function latestPriorTrusted(binding, observations, bindings) {
  const candidates = [];
  const visited = new Set();
  const visit = (bindingId) => {
    if (visited.has(bindingId)) return;
    visited.add(bindingId);
    const priorBinding = bindings.get(bindingId);
    if (!priorBinding) return;
    const prior = observations.get(bindingId);
    if (validClosingDecision(prior)) candidates.push(prior);
    for (const nextId of priorBinding.supersedes) visit(nextId);
  };
  for (const priorId of binding.supersedes) visit(priorId);
  return candidates.sort((left, right) => Date.parse(right.thread.updatedAt) - Date.parse(left.thread.updatedAt))[0] || null;
}

function validClosingDecision(observation) {
  return Boolean(observation?.decision && observation.scope && reviewDecisionMatches(observation.decision, observation.scope, observation.evidenceIdentity) && decisionClosesGate(observation.decision));
}

function propagateDependencies(claimItems) {
  const dependents = new Map();
  const hazardous = new Set();
  for (const item of claimItems) {
    const ownKey = `${item.workspaceId}:${item.stableKey}`;
    if (item.dependencyHazards?.length || item.reasons.length) hazardous.add(ownKey);
    for (const dependency of item.dependsOn) {
      const dependencyKey = `${item.workspaceId}:${dependency}`;
      const entries = dependents.get(dependencyKey) || [];
      entries.push({ item, dependency });
      dependents.set(dependencyKey, entries);
    }
  }
  const queue = [...hazardous];
  for (let index = 0; index < queue.length; index += 1) {
    const upstreamKey = queue[index];
    for (const { item, dependency } of dependents.get(upstreamKey) || []) {
      const reasonKey = `dependency_affected:${dependency}`;
      if (!item.reasons.some((entry) => entry.key === reasonKey)) {
        item.reasons.push({ ...reason("dependency_affected", `dependency ${dependency} currently requires attention`), key: reasonKey });
      }
      const dependentKey = `${item.workspaceId}:${item.stableKey}`;
      if (!hazardous.has(dependentKey)) {
        hazardous.add(dependentKey);
        queue.push(dependentKey);
      }
    }
  }
}

function finalizeItem(item) {
  const unique = new Map();
  for (const entry of item.reasons) unique.set(entry.key || entry.code, entry);
  const reasons = [...unique.values()].sort((left, right) => right.weight - left.weight || left.code.localeCompare(right.code));
  const components = [
    { code: `criticality:${item.criticality}`, value: criticalityScore[item.criticality], authority: item.criticalityAuthority },
    ...reasons.map((entry) => ({ code: entry.code, value: entry.weight, authority: "deterministic" }))
  ];
  return {
    id: item.id,
    kind: item.kind,
    workspaceId: item.workspaceId,
    threadId: item.threadId,
    stableKey: item.stableKey,
    claim: item.claim || null,
    bindingId: item.bindingId,
    criticality: item.criticality,
    updatedAt: item.updatedAt,
    newSinceCheckpoint: item.newSinceCheckpoint,
    subjectUpdatedSinceCheckpoint: item.newSinceCheckpoint,
    priority: { score: components.reduce((sum, component) => sum + component.value, 0), components },
    reasons: reasons.map(({ key, weight, ...entry }) => entry),
    evidence: item.evidence,
    target: item.target
  };
}

function reason(code, explanation) {
  return { code, explanation, weight: reasonScore[code], key: code };
}

function findingReason(code, binding, observation) {
  if (code === "contradiction") return `deterministic adjudication marks ${binding.stableKey} contradictory`;
  if (code === "unsupported") return `adjudication marks ${binding.stableKey} unsupported`;
  if (code === "uncertain") return `adjudication cannot settle ${binding.stableKey}`;
  if (code === "stale") return `adjudication already marks ${binding.stableKey} stale`;
  if (code === "missing_required_guard") return `one or more declared guards are absent for ${binding.stableKey}`;
  if (code === "failed_required_guard") return `one or more declared guards failed for ${binding.stableKey}`;
  if (code === "non_authoritative_verdict") return `the stored verdict for ${binding.stableKey} lacks deterministic authority`;
  return `evidence requires attention for ${observation.bundleId}/${binding.claimId}`;
}

function latestReceiptsByAdapter(receipts) {
  const sorted = [...receipts].sort((left, right) => Date.parse(right.importedAt) - Date.parse(left.importedAt) || String(left.id).localeCompare(String(right.id)));
  const adapters = new Set();
  return sorted.filter((receipt) => {
    if (adapters.has(receipt.adapter)) return false;
    adapters.add(receipt.adapter);
    return true;
  });
}

function isNewSince(value, checkpointAt) {
  return checkpointAt ? Date.parse(value) > Date.parse(checkpointAt) : true;
}

function compareAttention(left, right) {
  return right.priority.score - left.priority.score
    || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || left.id.localeCompare(right.id);
}
