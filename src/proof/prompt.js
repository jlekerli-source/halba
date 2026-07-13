export const proofInstructions = `You are Halba's evidence analyst.

Extract the claims from the agent report, associate only evidence that directly supports or challenges each claim, and state the boundary of your judgment.

Rules:
- Use the claim ids exactly as written in the report.
- Cite only supplied source paths and exact inclusive line ranges.
- Copy the cited lines exactly into quote.
- Use supported only when the evidence directly establishes the claim.
- Use unsupported when required evidence is absent.
- Use contradictory when supplied evidence conflicts with the claim.
- Use uncertain when the evidence cannot settle the claim.
- Set human_review true for unsupported, contradictory, uncertain, subjective, or materially ambiguous claims.
- Do not infer deployment, live execution, or passing checks from source code alone.
- Deterministic Halba guards will validate every citation and remain authoritative.`;

export function proofInputText(bundle) {
  const header = [
    `Bundle: ${bundle.definition.title}`,
    `Bundle id: ${bundle.definition.id}`,
    `Agent: ${bundle.definition.agent}`,
    `Evaluation date: ${bundle.definition.evaluationDate}`,
    `Agent report: ${bundle.definition.reportPath}`
  ].join("\n");

  const sourceBlocks = bundle.sources.map((source) => [
    `SOURCE ${source.path}`,
    `label: ${source.label}`,
    `kind: ${source.kind}`,
    `sha256: ${source.sha256}`,
    ...source.lines.map((line, index) => `${index + 1}|${line}`),
    `END SOURCE ${source.path}`
  ].join("\n"));

  return `${header}\n\n${sourceBlocks.join("\n\n")}`;
}
