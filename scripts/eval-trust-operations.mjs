import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { buildTrustOperations } from "../src/domain/trust-operations.js";
import { buildHumanTrustTrial, verifyHumanTrustSessionRecord } from "../src/domain/human-trust-eval.js";
import { buildTrustBenchmark } from "./trust-benchmark-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmark = buildTrustBenchmark();
const iterations = 200;
const timings = [];
let report;
for (let index = 0; index < iterations; index += 1) {
  const started = performance.now();
  report = buildTrustOperations({ contexts: benchmark.contexts, evaluatedAt: benchmark.evaluatedAt });
  timings.push(performance.now() - started);
}
const actual = new Set(report.items.map((item) => item.id));
const expected = new Set(benchmark.expectedAttentionIds);
const truePositive = [...actual].filter((id) => expected.has(id)).length;
const precision = truePositive / actual.size;
const recall = truePositive / expected.size;
const falsePositive = [...actual].filter((id) => !expected.has(id));
const missed = [...expected].filter((id) => !actual.has(id));
const sortedTimings = [...timings].sort((left, right) => left - right);
const humanTrial = buildHumanTrustTrial({ benchmark, report });
const humanSession = await readHumanSession();
const humanVerification = humanSession ? verifyHumanTrustSessionRecord(humanSession, humanTrial) : null;
const metrics = {
  schemaVersion: 1,
  corpusVersion: benchmark.version,
  evaluatedAt: benchmark.evaluatedAt,
  workspaces: benchmark.contexts.length,
  runs: benchmark.runCount,
  expectedAttention: expected.size,
  actualAttention: actual.size,
  precision,
  recall,
  falsePositive,
  missed,
  topIssue: report.items[0]?.id || null,
  topIssueCorrect: report.items[0]?.id === benchmark.expectedTopId,
  replayStable: JSON.stringify(buildTrustOperations({ contexts: benchmark.contexts, evaluatedAt: benchmark.evaluatedAt })) === JSON.stringify(report),
  latencyMs: {
    iterations,
    p50: percentile(sortedTimings, 0.5),
    p95: percentile(sortedTimings, 0.95),
    max: sortedTimings.at(-1)
  },
  humanIdentificationStatus: humanVerification ? (humanVerification.passed ? "passed" : "failed") : "not_run",
  humanIdentificationSeconds: humanVerification?.durationSeconds ?? null,
  humanIdentificationSessionId: humanVerification?.sessionId ?? null,
  humanIdentificationRecordDigest: humanVerification?.recordDigest ?? null,
  humanIdentificationNote: humanVerification
    ? "Facilitator-attested uninterrupted human session; the digest detects edits but is not an identity signature."
    : "Rendered browser mechanics pass; the under-60-second comprehension gate still requires an uninterrupted human-timed session."
};

assert.ok(metrics.precision >= 0.9, `attention precision ${metrics.precision} is below 0.9`);
assert.equal(metrics.recall, 1, "gold attention recall must be complete");
assert.equal(metrics.topIssueCorrect, true, "the highest-risk deterministic issue must rank first");
assert.equal(metrics.replayStable, true, "fixed trust input must replay identically");
assert.ok(metrics.latencyMs.p95 < 100, `trust evaluation p95 ${metrics.latencyMs.p95}ms exceeds 100ms`);
if (process.argv.includes("--require-human")) {
  assert.equal(metrics.humanIdentificationStatus, "passed", "goal-level eval requires a passing facilitator-attested human Trust Inbox session");
}

if (process.argv.includes("--write")) {
  const outputDirectory = path.join(root, "artifacts", "evals");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "trust-operations-baseline.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, "trust-operations-baseline.md"), markdown(metrics));
}

console.log(`trust operations eval: precision=${percent(metrics.precision)} recall=${percent(metrics.recall)} top=${metrics.topIssueCorrect ? "correct" : "wrong"} p95=${metrics.latencyMs.p95.toFixed(3)}ms runs=${metrics.runs}`);
console.log(`human identification: ${metrics.humanIdentificationStatus}${metrics.humanIdentificationSeconds === null ? "" : ` (${metrics.humanIdentificationSeconds.toFixed(3)}s)`} — ${metrics.humanIdentificationNote}`);

function percentile(values, quantile) {
  return values[Math.min(values.length - 1, Math.floor(values.length * quantile))];
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function markdown(value) {
  return `# Trust Operations synthetic baseline

- Corpus version: ${value.corpusVersion}
- Evaluated at: ${value.evaluatedAt}
- Scale: ${value.workspaces} workspaces, ${value.runs} runs
- Attention: ${value.actualAttention}/${value.expectedAttention}
- Precision: ${percent(value.precision)}
- Recall: ${percent(value.recall)}
- Highest-risk issue ranked first: ${value.topIssueCorrect ? "yes" : "no"} (${value.topIssue})
- Deterministic replay: ${value.replayStable ? "yes" : "no"}
- Evaluation latency: p50 ${value.latencyMs.p50.toFixed(3)} ms; p95 ${value.latencyMs.p95.toFixed(3)} ms; max ${value.latencyMs.max.toFixed(3)} ms over ${value.latencyMs.iterations} iterations
- Human identification: ${value.humanIdentificationStatus}${value.humanIdentificationSeconds === null ? "" : ` in ${value.humanIdentificationSeconds.toFixed(3)} seconds`}

This corpus measures deterministic attention classification and ordering. Rendered browser mechanics pass separately. Human comprehension is claimed only when a facilitator-attested, integrity-checked session record is present; that local record is not an identity signature.
`;
}

async function readHumanSession() {
  const input = path.join(root, ".halba", "evals", "human-trust-inbox", "passing.json");
  try {
    return JSON.parse(await readFile(input, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
