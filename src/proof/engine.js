import { daysBetween } from "../domain/stale.js";
import { assertProofOutput, proofVerdicts } from "./schema.js";

const verdictRank = new Map([
  ["supported", 0],
  ["uncertain", 1],
  ["stale", 2],
  ["unsupported", 3],
  ["contradictory", 4]
]);

export function adjudicateProof(bundle, modelRun) {
  const output = assertProofOutput(modelRun.output);
  const guardsByClaim = groupGuards(bundle.definition.guards);
  const findings = output.claims.map((claim) => {
    const citations = claim.citations.map((citation) => validateCitation(bundle, citation));
    const invalidCitations = citations.filter((citation) => !citation.valid);
    const guardResults = (guardsByClaim.get(claim.claim_id) || []).map((guard) => runGuard(bundle, guard, citations));
    const guardVerdicts = guardResults.map((result) => result.verdict);
    const deterministicVerdict = strongestVerdict([
      ...guardVerdicts,
      ...(invalidCitations.length ? ["unsupported"] : [])
    ]);
    const verdict = deterministicVerdict || claim.assessment;
    const modelDisagreement = Boolean(deterministicVerdict && deterministicVerdict !== claim.assessment);
    const reviewRequired = claim.human_review || verdict !== "supported" || modelDisagreement;
    const issues = [
      ...invalidCitations.map((citation) => citation.issue),
      ...guardResults.filter((result) => !result.passed).map((result) => result.explanation),
      ...(modelDisagreement ? [`Model assessed ${claim.assessment}; deterministic guards resolved ${verdict}.`] : [])
    ];

    return {
      claimId: claim.claim_id,
      claim: claim.claim,
      verdict,
      modelAssessment: claim.assessment,
      confidence: claim.confidence,
      reasoningBoundary: claim.reasoning_boundary,
      reviewRequired,
      modelDisagreement,
      citations,
      guardResults,
      issues
    };
  });

  const counts = Object.fromEntries([...proofVerdicts].map((verdict) => [
    verdict,
    findings.filter((finding) => finding.verdict === verdict).length
  ]));

  return {
    bundle: {
      id: bundle.definition.id,
      title: bundle.definition.title,
      generatedAt: bundle.definition.generatedAt,
      evaluationDate: bundle.definition.evaluationDate,
      agent: bundle.definition.agent,
      sourceCount: bundle.sources.length,
      totalBytes: bundle.totalBytes
    },
    execution: modelRun.execution,
    summary: output.run_summary,
    counts,
    reviewRequiredCount: findings.filter((finding) => finding.reviewRequired).length,
    findings
  };
}

export function validateCitation(bundle, citation) {
  const source = bundle.sourceByPath.get(citation.path);
  if (!source) return invalidCitation(citation, "Citation path is not in the proof bundle.");
  if (citation.end_line > source.lineCount) {
    return invalidCitation(citation, `Citation ends after line ${source.lineCount}.`);
  }
  if (citation.end_line - citation.start_line > 20) {
    return invalidCitation(citation, "Citation range exceeds 20 lines.");
  }

  const text = source.lines.slice(citation.start_line - 1, citation.end_line).join("\n");
  if (normalizeQuote(text) !== normalizeQuote(citation.quote)) {
    return invalidCitation(citation, "Citation quote does not match the referenced lines.");
  }

  return {
    path: citation.path,
    startLine: citation.start_line,
    endLine: citation.end_line,
    quote: citation.quote,
    sourceLabel: source.label,
    sourceKind: source.kind,
    sourceSha256: source.sha256,
    valid: true,
    issue: null
  };
}

function runGuard(bundle, guard, citations) {
  const source = guard.path ? bundle.sourceByPath.get(guard.path) : null;
  let passed = false;
  let detail = "";

  if (guard.type === "source_contains") {
    passed = Boolean(source?.text.includes(guard.needle));
    detail = passed
      ? `Source contains the required proof text in ${guard.path}.`
      : `Source does not contain the required proof text in ${guard.path}.`;
  }

  if (guard.type === "receipt_exit") {
    const actual = Number(source?.text.match(/^exit:\s*(-?\d+)$/m)?.[1]);
    passed = Number.isFinite(actual) && actual === Number(guard.expectedExit);
    detail = passed
      ? `Receipt exit ${actual} matches expected exit ${guard.expectedExit}.`
      : `Receipt exit ${Number.isFinite(actual) ? actual : "missing"} does not match expected exit ${guard.expectedExit}.`;
  }

  if (guard.type === "citation_required") {
    passed = citations.some((citation) => citation.valid);
    detail = passed ? "At least one valid citation exists." : "No valid citation supports the claim.";
  }

  if (guard.type === "json_field_equals") {
    let actual;
    try {
      actual = JSON.parse(source?.text || "null")?.[guard.field];
    } catch {
      actual = undefined;
    }
    passed = Object.is(actual, guard.expected);
    detail = passed
      ? `${guard.path} records ${guard.field}=${formatValue(actual)}.`
      : `${guard.path} records ${guard.field}=${formatValue(actual)}, not ${formatValue(guard.expected)}.`;
  }

  if (guard.type === "freshness") {
    const proofDate = new Date(`${guard.proofDate}T12:00:00Z`);
    const evaluationDate = new Date(`${bundle.definition.evaluationDate}T12:00:00Z`);
    const ageDays = daysBetween(proofDate, evaluationDate);
    passed = !Number.isNaN(ageDays) && ageDays <= guard.maxAgeDays;
    detail = passed
      ? `${guard.path} is ${ageDays}d old inside the ${guard.maxAgeDays}d proof window.`
      : `${guard.path} is ${ageDays}d old and exceeds the ${guard.maxAgeDays}d proof window.`;
  }

  return {
    type: guard.type,
    path: guard.path || null,
    passed,
    verdict: passed ? guard.passVerdict : guard.failVerdict,
    explanation: detail
  };
}

function groupGuards(guards) {
  const grouped = new Map();
  for (const guard of guards) {
    if (!grouped.has(guard.claimId)) grouped.set(guard.claimId, []);
    grouped.get(guard.claimId).push(guard);
  }
  return grouped;
}

function strongestVerdict(verdicts) {
  return verdicts
    .filter((verdict) => proofVerdicts.has(verdict))
    .sort((left, right) => verdictRank.get(right) - verdictRank.get(left))[0] || null;
}

function invalidCitation(citation, issue) {
  return {
    path: citation.path,
    startLine: citation.start_line,
    endLine: citation.end_line,
    quote: citation.quote,
    sourceLabel: null,
    sourceKind: null,
    sourceSha256: null,
    valid: false,
    issue
  };
}

function normalizeQuote(value) {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

function formatValue(value) {
  if (value === undefined) return "missing";
  return JSON.stringify(value);
}
