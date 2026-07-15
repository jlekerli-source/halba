import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { validateWorkspace } from "../src/domain/workspace.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(await readFile(path.join(root, "evals", "workspace-corpus.json"), "utf8"));
const fixture = JSON.parse(await readFile(path.join(root, "data", "demo", "workspace.json"), "utf8"));
const proofBundleId = "halba-build-week-demo";
const writeReport = process.argv.includes("--write");

assert.equal(corpus.schemaVersion, 1, "unsupported workspace eval corpus schemaVersion");

const results = corpus.cases.map((testCase) => {
  const workspace = structuredClone(fixture);
  if (testCase.mutation) applyMutation(workspace, testCase.mutation);
  const startedAt = performance.now();
  let error = null;
  try {
    validateWorkspace(workspace, { proofBundleId });
  } catch (caught) {
    error = caught;
  }
  const actual = error ? "rejected" : "accepted";
  const outcomeMatches = actual === testCase.expected;
  const messageMatches = !testCase.expectedMessage || error?.message.includes(testCase.expectedMessage);
  return {
    id: testCase.id,
    description: testCase.description,
    expected: testCase.expected,
    actual,
    passed: outcomeMatches && messageMatches,
    error: error?.message || null,
    durationMs: roundMs(performance.now() - startedAt)
  };
});

const unsafeCases = results.filter((result) => result.expected === "rejected");
const safeCases = results.filter((result) => result.expected === "accepted");
const metrics = {
  outcomeAccuracy: ratio(results.filter((result) => result.passed).length, results.length),
  unsafeAcceptanceRate: ratio(unsafeCases.filter((result) => result.actual === "accepted").length, unsafeCases.length),
  falseRejectionRate: ratio(safeCases.filter((result) => result.actual === "rejected").length, safeCases.length)
};
const thresholds = [
  threshold("outcomeAccuracy", metrics.outcomeAccuracy, corpus.thresholds.outcomeAccuracy, ">="),
  threshold("unsafeAcceptanceRate", metrics.unsafeAcceptanceRate, corpus.thresholds.maxUnsafeAcceptanceRate, "<="),
  threshold("falseRejectionRate", metrics.falseRejectionRate, corpus.thresholds.maxFalseRejectionRate, "<=")
];
const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
const report = {
  schemaVersion: 1,
  corpus: corpus.name,
  caseCount: results.length,
  passedCaseCount: results.filter((result) => result.passed).length,
  failedCaseCount: results.filter((result) => !result.passed).length,
  metrics,
  timing: {
    totalMs: roundMs(durations.reduce((sum, value) => sum + value, 0)),
    meanCaseMs: roundMs(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p95CaseMs: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] || 0
  },
  thresholds,
  results
};

if (writeReport) {
  const artifactRoot = path.join(root, "artifacts", "evals");
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(path.join(artifactRoot, "workspace-latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(artifactRoot, "workspace-latest.md"), markdownReport(report));
}

for (const result of results) console.log(`${result.passed ? "PASS" : "FAIL"} workspace:${result.id}`);
console.log(`workspace eval: accuracy=${percent(metrics.outcomeAccuracy)} unsafe_acceptance=${percent(metrics.unsafeAcceptanceRate)} false_rejection=${percent(metrics.falseRejectionRate)}`);

assert.equal(results.every((result) => result.passed), true, "one or more workspace eval cases failed");
assert.equal(thresholds.every((check) => check.passed), true, "one or more workspace eval thresholds failed");

function applyMutation(target, mutation) {
  const parts = mutation.path.split(".");
  const key = parts.pop();
  let parent = target;
  for (const part of parts) parent = parent[Array.isArray(parent) ? Number(part) : part];
  parent[Array.isArray(parent) ? Number(key) : key] = mutation.valueFrom
    ? getPath(target, mutation.valueFrom)
    : mutation.value;
}

function getPath(target, valuePath) {
  return valuePath.split(".").reduce((value, part) => value[Array.isArray(value) ? Number(part) : part], target);
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 1;
}

function threshold(metric, actual, expected, operator) {
  return { metric, actual, expected, operator, passed: operator === ">=" ? actual >= expected : actual <= expected };
}

function roundMs(value) {
  return Math.round(value * 1000) / 1000;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function markdownReport(value) {
  const metrics = Object.entries(value.metrics).map(([name, result]) => `| ${name} | ${percent(result)} |`).join("\n");
  const cases = value.results.map((result) => `| ${result.passed ? "PASS" : "FAIL"} | ${result.id} | ${result.description} |`).join("\n");
  return `# Halba agent-workspace boundary eval\n\nCorpus: ${value.corpus}\n\n- Cases: ${value.passedCaseCount}/${value.caseCount} passed\n- Scope: deterministic workspace validation; this report does not represent a live model call.\n\n## Metrics\n\n| Metric | Result |\n| --- | ---: |\n${metrics}\n\n## Cases\n\n| Result | Case | Purpose |\n| --- | --- | --- |\n${cases}\n`;
}
