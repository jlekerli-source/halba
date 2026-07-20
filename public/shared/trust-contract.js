export const evidencePolicySchemaVersion = 2;

export const trustCriticalities = Object.freeze(["low", "medium", "high", "critical"]);
export const trustLimits = Object.freeze({ bindings: 512, dependencies: 16, supersedes: 16, guards: 16, key: 128 });

const criticalities = new Set(trustCriticalities);
const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const keyPattern = /^[a-z0-9][a-z0-9._:/-]*$/;

function invariant(condition, message) {
  if (!condition) throw new Error(`invalid trust configuration: ${message}`);
}

function boundedKey(value, label) {
  invariant(typeof value === "string" && value.length <= trustLimits.key && keyPattern.test(value), `${label} must be a bounded stable key`);
}

function boundedSlug(value, label) {
  invariant(typeof value === "string" && value.length <= 120 && slugPattern.test(value), `${label} must be a safe slug`);
}

function boundedSlugList(value, label, limit) {
  invariant(Array.isArray(value) && value.length <= limit, `${label} must be a bounded array`);
  for (const item of value) boundedSlug(item, label);
  invariant(new Set(value).size === value.length, `${label} must be unique`);
}

export function validateTrustConfiguration(workspace) {
  const trust = workspace?.trust;
  validateEvidencePolicyPacket(trust);

  const threads = new Map(workspace.threads.map((thread) => [thread.id, thread]));
  const bindings = new Map(trust.bindings.map((binding) => [binding.id, binding]));
  const stableKeys = new Set();
  for (const binding of trust.bindings) {
    const thread = threads.get(binding.threadId);
    invariant(thread, `binding ${binding.id} references unknown thread ${binding.threadId}`);
    invariant(Array.isArray(thread.claimIds), `binding ${binding.id} requires explicit claimIds on thread ${binding.threadId}`);
    invariant(thread.claimIds.includes(binding.claimId), `binding ${binding.id} references unknown claim ${binding.claimId}`);
    stableKeys.add(binding.stableKey);
  }

  for (const binding of trust.bindings) {
    for (const dependency of binding.dependsOn) {
      invariant(dependency !== binding.stableKey, `binding ${binding.id} cannot depend on itself`);
      invariant(stableKeys.has(dependency), `binding ${binding.id} depends on unknown stable key ${dependency}`);
    }
    for (const priorId of binding.supersedes) {
      const prior = bindings.get(priorId);
      invariant(prior, `binding ${binding.id} supersedes unknown binding ${priorId}`);
      invariant(prior.stableKey === binding.stableKey, `binding ${binding.id} can supersede only the same stable key`);
      invariant(Date.parse(threads.get(prior.threadId).updatedAt) < Date.parse(threads.get(binding.threadId).updatedAt), `binding ${binding.id} must supersede an older observation`);
    }
  }

  for (const group of Map.groupBy(trust.bindings, (binding) => binding.stableKey).values()) {
    group.sort((left, right) => Date.parse(threads.get(left.threadId).updatedAt) - Date.parse(threads.get(right.threadId).updatedAt));
    for (const binding of group.slice(1)) invariant(binding.supersedes.length > 0, `binding ${binding.id} must explicitly supersede an earlier observation`);
  }

  assertAcyclicDependencies(trust.bindings, stableKeys);
  return trust;
}

export function validateEvidencePolicyPacket(packet, { threadId = null } = {}) {
  invariant(packet && typeof packet === "object" && !Array.isArray(packet), "trust must be an object");
  invariant(packet.schemaVersion === evidencePolicySchemaVersion, `schemaVersion must be ${evidencePolicySchemaVersion}`);
  validatePolicy(packet.policy);
  invariant(Array.isArray(packet.bindings) && packet.bindings.length > 0 && packet.bindings.length <= trustLimits.bindings, `bindings must contain 1-${trustLimits.bindings} entries`);
  const bindingIds = new Set();
  const observationScopes = new Set();
  for (const binding of packet.bindings) {
    validateBinding(binding);
    invariant(!bindingIds.has(binding.id), `binding id ${binding.id} is duplicated`);
    bindingIds.add(binding.id);
    if (threadId !== null) invariant(binding.threadId === threadId, `binding ${binding.id} must reference packet thread ${threadId}`);
    const scope = `${binding.threadId}:${binding.claimId}`;
    invariant(!observationScopes.has(scope), `claim observation ${scope} is bound more than once`);
    observationScopes.add(scope);
  }
  return packet;
}

function validatePolicy(policy) {
  invariant(policy && typeof policy === "object" && !Array.isArray(policy), "policy is required");
  boundedSlug(policy.id, "policy id");
  invariant(Number.isInteger(policy.version) && policy.version >= 1 && policy.version <= 1_000_000, "policy version must be a positive bounded integer");
  boundedDays(policy.defaultFreshnessDays, "defaultFreshnessDays");
  boundedDays(policy.defaultDecisionTtlDays, "defaultDecisionTtlDays");
  invariant(Array.isArray(policy.requireHumanDecisionFor) && policy.requireHumanDecisionFor.every((value) => criticalities.has(value)), "requireHumanDecisionFor contains an unknown criticality");
  invariant(new Set(policy.requireHumanDecisionFor).size === policy.requireHumanDecisionFor.length, "requireHumanDecisionFor must be unique");
}

function validateBinding(binding) {
  invariant(binding && typeof binding === "object" && !Array.isArray(binding), "binding must be an object");
  boundedSlug(binding.id, "binding id");
  boundedKey(binding.stableKey, `binding ${binding.id} stableKey`);
  boundedSlug(binding.threadId, `binding ${binding.id} threadId`);
  boundedSlug(binding.claimId, `binding ${binding.id} claimId`);
  boundedSlug(binding.class, `binding ${binding.id} class`);
  invariant(criticalities.has(binding.criticality), `binding ${binding.id} has unknown criticality`);
  if (binding.freshnessDays !== undefined) boundedDays(binding.freshnessDays, `binding ${binding.id} freshnessDays`);
  if (binding.decisionTtlDays !== undefined) boundedDays(binding.decisionTtlDays, `binding ${binding.id} decisionTtlDays`);
  boundedSlugList(binding.requiredGuards, `binding ${binding.id} requiredGuards`, trustLimits.guards);
  invariant(Array.isArray(binding.dependsOn) && binding.dependsOn.length <= trustLimits.dependencies, `binding ${binding.id} dependsOn must be bounded`);
  for (const dependency of binding.dependsOn) boundedKey(dependency, `binding ${binding.id} dependency`);
  invariant(new Set(binding.dependsOn).size === binding.dependsOn.length, `binding ${binding.id} dependencies must be unique`);
  boundedSlugList(binding.supersedes, `binding ${binding.id} supersedes`, trustLimits.supersedes);
}

function boundedDays(value, label) {
  invariant(Number.isInteger(value) && value >= 1 && value <= 3650, `${label} must be between 1 and 3650`);
}

function assertAcyclicDependencies(bindings, stableKeys) {
  const edges = new Map([...stableKeys].map((key) => [key, new Set()]));
  for (const binding of bindings) for (const dependency of binding.dependsOn) edges.get(binding.stableKey).add(dependency);
  const visiting = new Set();
  const visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) invariant(false, `dependency cycle includes ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of edges.get(key)) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of stableKeys) visit(key);
}
