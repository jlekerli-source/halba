export const proofAssessments = new Set([
  "supported",
  "unsupported",
  "contradictory",
  "uncertain"
]);

export const proofVerdicts = new Set([
  "supported",
  "unsupported",
  "contradictory",
  "stale",
  "uncertain"
]);

export const proofOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    run_summary: { type: "string", minLength: 1 },
    claims: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim_id: { type: "string", minLength: 1 },
          claim: { type: "string", minLength: 1 },
          assessment: {
            type: "string",
            enum: [...proofAssessments]
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reasoning_boundary: { type: "string", minLength: 1 },
          citations: {
            type: "array",
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                path: { type: "string", minLength: 1 },
                start_line: { type: "integer", minimum: 1 },
                end_line: { type: "integer", minimum: 1 },
                quote: { type: "string", minLength: 1 }
              },
              required: ["path", "start_line", "end_line", "quote"]
            }
          },
          human_review: { type: "boolean" }
        },
        required: [
          "claim_id",
          "claim",
          "assessment",
          "confidence",
          "reasoning_boundary",
          "citations",
          "human_review"
        ]
      }
    }
  },
  required: ["run_summary", "claims"]
};

export function assertProofOutput(output) {
  invariant(output && typeof output === "object" && !Array.isArray(output), "proof output must be an object");
  invariant(typeof output.run_summary === "string" && output.run_summary.trim(), "proof output is missing run_summary");
  invariant(Array.isArray(output.claims) && output.claims.length > 0, "proof output is missing claims");
  invariant(output.claims.length <= 24, "proof output has too many claims");

  const ids = new Set();
  for (const claim of output.claims) {
    invariant(claim && typeof claim === "object", "proof claim must be an object");
    invariant(typeof claim.claim_id === "string" && claim.claim_id.trim(), "proof claim is missing claim_id");
    invariant(!ids.has(claim.claim_id), `duplicate proof claim id ${claim.claim_id}`);
    ids.add(claim.claim_id);
    invariant(typeof claim.claim === "string" && claim.claim.trim(), `proof claim ${claim.claim_id} is missing text`);
    invariant(proofAssessments.has(claim.assessment), `proof claim ${claim.claim_id} has an invalid assessment`);
    invariant(Number.isFinite(claim.confidence) && claim.confidence >= 0 && claim.confidence <= 1, `proof claim ${claim.claim_id} has invalid confidence`);
    invariant(typeof claim.reasoning_boundary === "string" && claim.reasoning_boundary.trim(), `proof claim ${claim.claim_id} is missing a reasoning boundary`);
    invariant(Array.isArray(claim.citations), `proof claim ${claim.claim_id} is missing citations`);
    invariant(claim.citations.length <= 12, `proof claim ${claim.claim_id} has too many citations`);
    invariant(typeof claim.human_review === "boolean", `proof claim ${claim.claim_id} is missing human_review`);

    for (const citation of claim.citations) {
      invariant(typeof citation.path === "string" && citation.path.trim(), `proof claim ${claim.claim_id} has a citation without a path`);
      invariant(Number.isInteger(citation.start_line) && citation.start_line > 0, `proof claim ${claim.claim_id} has an invalid citation start`);
      invariant(Number.isInteger(citation.end_line) && citation.end_line >= citation.start_line, `proof claim ${claim.claim_id} has an invalid citation end`);
      invariant(typeof citation.quote === "string" && citation.quote.trim(), `proof claim ${claim.claim_id} has a citation without a quote`);
    }
  }

  return output;
}

function invariant(condition, message) {
  if (!condition) throw new ProofSchemaError(message);
}

export class ProofSchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProofSchemaError";
    this.code = "invalid_proof_output";
  }
}
