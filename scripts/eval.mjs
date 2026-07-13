import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadProofBundle } from "../src/proof/bundle.js";
import { adjudicateProof } from "../src/proof/engine.js";
import { runProof } from "../src/proof/run.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(await readFile(path.join(root, "evals", "corpus.json"), "utf8"));
const recorded = JSON.parse(await readFile(path.join(root, "data", "demo", "recorded", "gpt-5.6-sol-proof.json"), "utf8"));
const baseBundle = await loadProofBundle();
const writeReport = process.argv.includes("--write");
const requestLive = process.argv.includes("--live") || process.env.HALBA_EVAL_LIVE === "1";

assert.equal(corpus.schemaVersion, 1, "unsupported eval corpus schemaVersion");

const results = [];
const verdictAssertions = [];
let normalCitationCount = 0;
let normalValidCitationCount = 0;
let degradedPassed = 0;
let degradedTotal = 0;
let groundingExpected = 0;
let groundingPredicted = 0;
let groundingMatches = 0;

for (const testCase of corpus.cases) {
  const bundle = cloneBundle(baseBundle);
  const modelRun = structuredClone(recorded);
  applyMutation(testCase.mutation, bundle, modelRun);
  let proof = null;
  let error = null;
  const startedAt = performance.now();

  try {
    proof = adjudicateProof(bundle, modelRun);
  } catch (caught) {
    error = caught;
  }
  const durationMs = performance.now() - startedAt;

  const checks = [];
  if (testCase.expectedError) {
    checks.push({
      label: `error ${testCase.expectedError}`,
      passed: error?.code === testCase.expectedError,
      actual: error?.code || null,
      expected: testCase.expectedError
    });
  } else {
    checks.push({
      label: "adjudication completed",
      passed: !error,
      actual: error?.code || null,
      expected: null
    });
    for (const [claimId, expectedVerdict] of Object.entries(testCase.expected || {})) {
      const finding = proof?.findings.find((item) => item.claimId === claimId);
      const actualVerdict = finding?.verdict || null;
      const passed = actualVerdict === expectedVerdict;
      checks.push({ label: `${claimId} verdict`, passed, actual: actualVerdict, expected: expectedVerdict });
      verdictAssertions.push({
        caseId: testCase.id,
        claimId,
        actual: actualVerdict,
        expected: expectedVerdict,
        reviewRequired: finding?.reviewRequired || false
      });
    }
    for (const claimId of testCase.expectedDisagreement || []) {
      const finding = proof?.findings.find((item) => item.claimId === claimId);
      checks.push({
        label: `${claimId} model disagreement`,
        passed: finding?.modelDisagreement === true,
        actual: finding?.modelDisagreement ?? null,
        expected: true
      });
    }
    for (const [claimId, expectedCitations] of Object.entries(testCase.expectedCitations || {})) {
      const finding = proof?.findings.find((item) => item.claimId === claimId);
      const predicted = (finding?.citations || []).filter((citation) => citation.valid).map(citationKey);
      const expected = expectedCitations.map(citationKey);
      const predictedSet = new Set(predicted);
      const expectedSet = new Set(expected);
      const matches = predicted.filter((citation) => expectedSet.has(citation)).length;
      groundingExpected += expected.length;
      groundingPredicted += predicted.length;
      groundingMatches += matches;
      checks.push({
        label: `${claimId} exact source grounding`,
        passed: predicted.length === expected.length && predicted.every((citation) => expectedSet.has(citation)) && expected.every((citation) => predictedSet.has(citation)),
        actual: predicted,
        expected
      });
    }
    if (testCase.expectedIssue) {
      const issueText = proof?.findings.flatMap((finding) => finding.issues).join(" ") || "";
      checks.push({
        label: "expected issue surfaced",
        passed: issueText.includes(testCase.expectedIssue),
        actual: issueText.includes(testCase.expectedIssue),
        expected: true
      });
    }
  }

  const passed = checks.every((check) => check.passed);
  if (testCase.group === "degraded") {
    degradedTotal += 1;
    if (passed) degradedPassed += 1;
  }
  if (testCase.group === "normal" && proof) {
    for (const citation of proof.findings.flatMap((finding) => finding.citations)) {
      normalCitationCount += 1;
      if (citation.valid) normalValidCitationCount += 1;
    }
  }

  results.push({
    id: testCase.id,
    group: testCase.group,
    description: testCase.description,
    passed,
    durationMs: roundMs(durationMs),
    checks
  });
}

const baselineA = adjudicateProof(cloneBundle(baseBundle), structuredClone(recorded));
const baselineB = adjudicateProof(cloneBundle(baseBundle), structuredClone(recorded));
const replayDigestA = digest(baselineA);
const replayDigestB = digest(baselineB);
const deterministicReplay = replayDigestA === replayDigestB;

const correctVerdicts = verdictAssertions.filter((item) => item.actual === item.expected).length;
const expectedUnsupported = verdictAssertions.filter((item) => item.expected === "unsupported");
const expectedContradictions = verdictAssertions.filter((item) => item.expected === "contradictory");
const expectedReviewGates = verdictAssertions.filter((item) => item.expected !== "supported");
const falsePositives = verdictAssertions.filter((item) => item.expected !== "supported" && item.actual === "supported");

const metrics = {
  verdictAccuracy: ratio(correctVerdicts, verdictAssertions.length),
  normalCitationValidity: ratio(normalValidCitationCount, normalCitationCount),
  sourceGroundingPrecision: ratio(groundingMatches, groundingPredicted),
  sourceGroundingRecall: ratio(groundingMatches, groundingExpected),
  unsupportedRecall: ratio(expectedUnsupported.filter((item) => item.actual === "unsupported").length, expectedUnsupported.length),
  contradictionRecall: ratio(expectedContradictions.filter((item) => item.actual === "contradictory").length, expectedContradictions.length),
  reviewGateRecall: ratio(expectedReviewGates.filter((item) => item.reviewRequired).length, expectedReviewGates.length),
  falsePositiveRate: ratio(falsePositives.length, verdictAssertions.filter((item) => item.expected !== "supported").length),
  degradedBehaviorPassRate: ratio(degradedPassed, degradedTotal),
  deterministicReplay
};

const thresholdChecks = [
  threshold("verdictAccuracy", metrics.verdictAccuracy, corpus.thresholds.verdictAccuracy, ">="),
  threshold("normalCitationValidity", metrics.normalCitationValidity, corpus.thresholds.normalCitationValidity, ">="),
  threshold("sourceGroundingPrecision", metrics.sourceGroundingPrecision, corpus.thresholds.sourceGroundingPrecision, ">="),
  threshold("sourceGroundingRecall", metrics.sourceGroundingRecall, corpus.thresholds.sourceGroundingRecall, ">="),
  threshold("unsupportedRecall", metrics.unsupportedRecall, corpus.thresholds.unsupportedRecall, ">="),
  threshold("contradictionRecall", metrics.contradictionRecall, corpus.thresholds.contradictionRecall, ">="),
  threshold("reviewGateRecall", metrics.reviewGateRecall, corpus.thresholds.reviewGateRecall, ">="),
  threshold("falsePositiveRate", metrics.falsePositiveRate, corpus.thresholds.maxFalsePositiveRate, "<="),
  threshold("degradedBehaviorPassRate", metrics.degradedBehaviorPassRate, corpus.thresholds.degradedBehaviorPassRate, ">="),
  { metric: "deterministicReplay", actual: deterministicReplay, expected: true, passed: deterministicReplay }
];

const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
const timing = {
  totalMs: roundMs(durations.reduce((sum, value) => sum + value, 0)),
  meanCaseMs: roundMs(durations.reduce((sum, value) => sum + value, 0) / durations.length),
  p50CaseMs: percentile(durations, 0.5),
  p95CaseMs: percentile(durations, 0.95)
};

let live = {
  requested: requestLive,
  status: "not_run",
  reason: requestLive ? "OPENAI_API_KEY is not configured." : "Live eval was not requested.",
  model: "gpt-5.6-sol",
  latencyMs: null,
  usage: null,
  costUsd: null
};

if (requestLive && process.env.OPENAI_API_KEY) {
  try {
    const proof = await runProof({ mode: "live" });
    live = {
      requested: true,
      status: "completed",
      reason: null,
      model: proof.execution.model,
      latencyMs: proof.execution.latencyMs,
      usage: proof.execution.usage,
      costUsd: null
    };
  } catch (error) {
    live = {
      ...live,
      status: "failed",
      reason: error.code || "live_eval_failed"
    };
  }
}

const report = {
  schemaVersion: 1,
  corpus: corpus.name,
  caseCount: results.length,
  passedCaseCount: results.filter((result) => result.passed).length,
  failedCaseCount: results.filter((result) => !result.passed).length,
  replayDigest: replayDigestA,
  metrics,
  timing,
  thresholds: thresholdChecks,
  results,
  live
};

if (writeReport) {
  const artifactRoot = path.join(root, "artifacts", "evals");
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(path.join(artifactRoot, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(artifactRoot, "latest.md"), markdownReport(report));
}

for (const result of results) {
  console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id}`);
}
console.log(`eval metrics: accuracy=${percent(metrics.verdictAccuracy)} grounding_precision=${percent(metrics.sourceGroundingPrecision)} grounding_recall=${percent(metrics.sourceGroundingRecall)} unsupported_recall=${percent(metrics.unsupportedRecall)} contradiction_recall=${percent(metrics.contradictionRecall)} false_positive_rate=${percent(metrics.falsePositiveRate)}`);
console.log(`replay timing: total=${timing.totalMs}ms mean=${timing.meanCaseMs}ms p50=${timing.p50CaseMs}ms p95=${timing.p95CaseMs}ms`);
console.log(`live eval: ${live.status} (${live.reason || `${live.latencyMs} ms`})`);

assert.equal(results.every((result) => result.passed), true, "one or more eval cases failed");
assert.equal(thresholdChecks.every((check) => check.passed), true, "one or more eval thresholds failed");

function cloneBundle(bundle) {
  const definition = structuredClone(bundle.definition);
  const sources = bundle.sources.map((source) => ({
    ...source,
    lines: [...source.lines]
  }));
  return {
    ...bundle,
    definition,
    sources,
    sourceByPath: new Map(sources.map((source) => [source.path, source]))
  };
}

function applyMutation(mutation, bundle, modelRun) {
  if (!mutation) return;
  if (mutation.type === "citation_quote" || mutation.type === "citation_path") {
    const claim = modelRun.output.claims.find((item) => item.claim_id === mutation.claimId);
    const citation = claim.citations[mutation.citationIndex];
    citation[mutation.type === "citation_quote" ? "quote" : "path"] = mutation.value;
  }
  if (mutation.type === "model_assessment") {
    const claim = modelRun.output.claims.find((item) => item.claim_id === mutation.claimId);
    claim.assessment = mutation.value;
    claim.human_review = mutation.humanReview;
  }
  if (mutation.type === "source_replace" || mutation.type === "source_append") {
    const source = bundle.sourceByPath.get(mutation.path);
    source.text = mutation.type === "source_replace"
      ? source.text.replace(mutation.find, mutation.replace)
      : `${source.text}${mutation.value}`;
    source.lines = source.text.replace(/\r\n?/g, "\n").split("\n");
    if (source.lines.at(-1) === "") source.lines.pop();
    source.lineCount = source.lines.length;
  }
  if (mutation.type === "evaluation_date") bundle.definition.evaluationDate = mutation.value;
  if (mutation.type === "remove_output_field") delete modelRun.output[mutation.field];
}

function threshold(metric, actual, expected, operator) {
  return {
    metric,
    actual,
    expected,
    operator,
    passed: operator === ">=" ? actual >= expected : actual <= expected
  };
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 1;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function citationKey(citation) {
  return `${citation.path}:L${citation.startLine}-L${citation.endLine}`;
}

function roundMs(value) {
  return Math.round(value * 1000) / 1000;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function markdownReport(report) {
  const metricRows = Object.entries(report.metrics)
    .map(([name, value]) => `| ${name} | ${typeof value === "number" ? percent(value) : value} |`)
    .join("\n");
  const caseRows = report.results
    .map((result) => `| ${result.passed ? "PASS" : "FAIL"} | ${result.id} | ${result.description} |`)
    .join("\n");
  const timingRows = Object.entries(report.timing)
    .map(([name, value]) => `| ${name} | ${value} ms |`)
    .join("\n");
  return `# Halba proof eval report

Replay corpus: ${report.corpus}

- Cases: ${report.passedCaseCount}/${report.caseCount} passed
- Replay digest: \`${report.replayDigest}\`
- Live GPT eval: ${report.live.status} — ${report.live.reason || `${report.live.latencyMs} ms`}
- Live cost: not measured; Halba does not hardcode mutable pricing.

## Metrics

| Metric | Result |
| --- | ---: |
${metricRows}

## Replay timing

Timing is informational and machine-dependent; it is not a regression threshold.

| Metric | Result |
| --- | ---: |
${timingRows}

## Cases

| Result | Case | Purpose |
| --- | --- | --- |
${caseRows}

## Interpretation

Replay results prove Halba's deterministic ingestion, source grounding, citation validation, guard authority, degraded-input behavior, and UI-safe result contract. They do not prove a live GPT request. Live latency, usage, and cost remain unmeasured until a local API key is intentionally configured and the live eval is run.
`;
}
