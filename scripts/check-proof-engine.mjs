import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadProofBundle } from "../src/proof/bundle.js";
import { adjudicateProof } from "../src/proof/engine.js";
import { assertProofOutput, proofClaimTextMaxLength, proofOutputJsonSchema } from "../src/proof/schema.js";

const bundle = await loadProofBundle();
const recorded = JSON.parse(await readFile(new URL("../data/demo/recorded/gpt-5.6-sol-proof.json", import.meta.url), "utf8"));
const proof = adjudicateProof(bundle, recorded);

assert.deepEqual(proof.counts, {
  supported: 2,
  unsupported: 1,
  contradictory: 1,
  stale: 1,
  uncertain: 1
});
assert.equal(proof.reviewRequiredCount, 4);
assert.equal(proof.findings.find((finding) => finding.claimId === "stale-gate").verdict, "supported");
assert.equal(proof.findings.find((finding) => finding.claimId === "all-checks").verdict, "supported");
assert.equal(proof.findings.find((finding) => finding.claimId === "deployed").verdict, "unsupported");
assert.equal(proof.findings.find((finding) => finding.claimId === "live-gpt").verdict, "contradictory");
assert.equal(proof.findings.find((finding) => finding.claimId === "privacy-current").verdict, "stale");
assert.equal(proof.findings.find((finding) => finding.claimId === "judge-ready").verdict, "uncertain");
assert.ok(proof.findings.every((finding) => finding.citations.every((citation) => citation.valid)), "recorded proof contains an invalid citation");
assert.equal(proof.findings.find((finding) => finding.claimId === "privacy-current").modelDisagreement, true);

const oversizedClaim = structuredClone(recorded.output);
oversizedClaim.claims[0].claim = "x".repeat(proofClaimTextMaxLength + 1);
assert.throws(() => assertProofOutput(oversizedClaim), /proof claim .* text is too long/, "oversized model claims must fail at the producer boundary before Trust Inbox rendering");
assert.equal(proofOutputJsonSchema.properties.claims.items.properties.claim.maxLength, proofClaimTextMaxLength);

const malformed = structuredClone(recorded);
malformed.output.claims[0].citations[0].quote = "This quote does not exist.";
const malformedProof = adjudicateProof(bundle, malformed);
const malformedFinding = malformedProof.findings.find((finding) => finding.claimId === "stale-gate");
assert.equal(malformedFinding.verdict, "unsupported");
assert.match(malformedFinding.issues.join(" "), /does not match/);

const failedReceiptBundle = cloneBundle(bundle);
const failedReceipt = failedReceiptBundle.sourceByPath.get("receipts/check.txt");
failedReceipt.text = failedReceipt.text.replace("exit: 0", "exit: 1");
failedReceipt.lines = failedReceipt.text.split("\n");
if (failedReceipt.lines.at(-1) === "") failedReceipt.lines.pop();
failedReceipt.lineCount = failedReceipt.lines.length;
const failedReceiptProof = adjudicateProof(failedReceiptBundle, recorded);
const failedReceiptFinding = failedReceiptProof.findings.find((finding) => finding.claimId === "all-checks");
assert.equal(failedReceiptFinding.verdict, "contradictory");
assert.match(failedReceiptFinding.issues.join(" "), /does not match/);

console.log(`check passed: proof engine adjudicated ${proof.findings.length} claims across 5 verdict classes`);

function cloneBundle(sourceBundle) {
  const sources = sourceBundle.sources.map((source) => ({ ...source, lines: [...source.lines] }));
  return {
    ...sourceBundle,
    definition: structuredClone(sourceBundle.definition),
    sources,
    sourceByPath: new Map(sources.map((source) => [source.path, source]))
  };
}
