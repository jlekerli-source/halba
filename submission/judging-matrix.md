# Build Week judging matrix

This matrix maps the four published OpenAI Build Week judging criteria to evidence a judge can inspect directly. It is an index, not a replacement for the product demo or source.

## Technical implementation

Judge question: How thoroughly and skillfully does Halba use Codex, and does the code reflect genuine effort and a working, non-trivial implementation?

Halba assigns GPT-5.6 Sol/max the semantic task that deterministic code cannot handle reliably: extracting atomic claims, proposing precise citations, and expressing bounded uncertainty. The model response is strict structured input, never authority. The adjudicator independently validates paths, line ranges, quotes, dates, receipts, and explicit contradictions.

Evidence:

- `src/proof/openai.js` — Responses API request, max reasoning, strict schema, storage disabled, refusal and timeout handling.
- `src/proof/prompt.js` and `src/proof/schema.js` — bounded evidence prompt and structured contract.
- `src/proof/engine.js` — citation validation and deterministic verdict precedence.
- `scripts/check-openai-adapter.mjs` — request-shape, success, refusal, timeout, and malformed-output coverage.
- `evals/corpus.json` — nine regression cases across all verdicts and degraded inputs.
- The downloadable review record preserves every verdict, reasoning boundary, exact source range and hash, deterministic guard, and human decision in one portable Markdown artifact.
- Film: 00:14–00:40 shows the real app, structured inference, deterministic override, and exact evidence.

Honest boundary: the public credential-free demo uses a visibly labeled structured-inference fixture. It proves the shipped inference contract and end-to-end workflow, not a live API request.

## Design

Judge question: Is this a complete, coherent product experience rather than a technical proof of concept?

Proof Mode stages one decision from start to finish: review a bounded packet, understand the verdict distribution, open the exact source, see the model/guard boundary, and close the human gate. Desktop keeps claim, verdict, and evidence visible together. Mobile switches among Summary, Claims, and Source instead of compressing three desktop columns.

Evidence:

- [Live demo](https://jlekerli-source.github.io/halba/)
- `artifacts/screenshots/onboarding-desktop.png` — first-use hierarchy.
- `artifacts/screenshots/proof-diff-desktop.png` — claim-to-source trace.
- `artifacts/screenshots/review-resolved-desktop.png` — completed human-review state.
- `artifacts/screenshots/proof-mobile-source.png` — intentional mobile source view.
- `submission/visual-qa.md` — two rendered critique rounds and rejected recaptures.
- Film: 00:00–00:58 presents the complete product story with captions and eight distinct visual beats.

## Potential impact

Judge question: Does Halba solve a credible problem for a specific audience?

The audience is teams using coding agents who currently reconstruct “done” by manually opening reports, diffs, logs, receipts, and source files. Halba turns that review burden into a bounded proof packet and a short queue containing only unsupported, stale, contradictory, or uncertain claims. It does not ask the model to approve itself.

Evidence:

- The public packet includes an actual Build Week patch, test receipt, model execution receipt, privacy receipt, and completion report.
- The six-claim demo reduces the run to four review gates while preserving two verified claims.
- Every gate opens to a stable source range and content hash.
- Browser-local decisions demonstrate the human control loop without requiring hosted identity or uploading source data.

Honest boundary: the current release imports the documented proof-bundle format. Additional agent and CI adapters are future work.

## Quality of the idea

Judge question: Is this a creative, non-obvious use of GPT-5.6 that reflects understanding of the problem?

Halba does not use GPT-5.6 as a chatbot or final judge. It uses the model as a semantic compiler from narrative completion reports into testable claims, then places deterministic proof and human judgment around that inference. The product's core insight is that model reasoning and proof authority should be visible together but remain separate.

Evidence:

- Five explicit verdicts preserve unsupported and uncertain states instead of collapsing them into confidence.
- Deterministic guards can override model overconfidence and confirm claims the model doubts.
- Prompt-like text inside evidence has no instruction authority.
- The reasoning boundary is shown beside every source citation rather than hidden behind a score.
- `submission/attribution.md` distinguishes the verified public inspiration from Halba's independent proof-layer interpretation.

## Fast judge path

1. Open the [live demo](https://jlekerli-source.github.io/halba/) and select **Review the public run**.
2. Confirm the execution is labeled **Recorded replay · gpt-5.6-sol**.
3. Open the contradictory live-GPT claim and compare it with `receipts/model-run.json`.
4. Switch to **Verified** and open the stale-clock claim to see the actual Build Week diff.
5. Reject or resolve a gate and confirm the local decision count changes.
6. Download the review record and confirm the human decision, exact citations, hashes, and guard outcomes are portable.
7. Read `artifacts/evals/latest.md` for the compact corpus results and stated limitations.

## Submission reconciliation

Reconciled July 15, 2026 against the live Devpost Hackathons plugin: **Technological Implementation**, **Design**, **Potential Impact**, and **Quality of the Idea** are the four published criteria; Halba remains submitted under **Developer Tools**.
