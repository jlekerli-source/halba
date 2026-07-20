# Build Week judging matrix

This matrix maps the four published OpenAI Build Week judging criteria to evidence a judge can inspect directly. It is an index, not a replacement for the product demo or source.

## Technical implementation

Judge question: How thoroughly and skillfully does Halba use Codex, and does the code reflect genuine effort and a working, non-trivial implementation?

Halba assigns GPT-5.6 Sol/max the semantic task that deterministic code cannot handle reliably: extracting atomic claims, proposing precise citations, and expressing bounded uncertainty. The model response is strict structured input, never authority. The adjudicator independently validates paths, line ranges, quotes, dates, receipts, and explicit contradictions.

Evidence:

- `src/domain/workspace.js` and `src/importers/codex-proof.js` — validated typed agent threads plus a deterministic public-safe Codex-run import.
- `scripts/check-codex-import.mjs` — proves the checked-in channel thread is reproduced from the same inspectable proof packet.
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

Halba stages one decision from start to finish: Trust Inbox ranks the risky completion claim, explains why it matters now, opens the exact evidence boundary, shows deterministic authority beside model inference, and leaves the final accountable action to a human. The same claim → evidence → guard → human circuit is visible in the judge path, ranked cards, Proof Mode, film, and gallery artwork. Mobile uses a real 390-pixel layout without horizontal page overflow.

Evidence:

- [Published historical demo](https://jlekerli-source.github.io/halba/) — proves the credential-free workspace/Proof packet, not July 20 Trust Operations parity; current local browser and release evidence are listed below.
- `artifacts/screenshots/trust-inbox-desktop.png` — current 60-second judge path, deterministic queue, and three-workspace boundary.
- `artifacts/screenshots/trust-inbox-mobile.png` — intentional 390-pixel Trust Inbox composition.
- `artifacts/screenshots/trust-inbox-proof.png` — exact routed claim, guard boundary, and human gate.
- `artifacts/screenshots/trust-inbox-receipt.png` — degraded import routed to its exact local receipt.
- `artifacts/screenshots/trust-inbox-recent-decisions.png` — current decisions beside append-only transition history.
- `artifacts/screenshots/workspace-desktop.jpg` — channel, agent thread, proof-driven attention, and handoff.
- `artifacts/screenshots/workspace-mobile.jpg` — intentional 390-pixel channel layout.
- `artifacts/screenshots/workspace-proof-desktop.jpg` — workspace handoff opened to an exact contradictory receipt.
- `artifacts/screenshots/onboarding-desktop.png` — first-use hierarchy.
- `artifacts/screenshots/proof-diff-desktop.png` — claim-to-source trace.
- `artifacts/screenshots/review-resolved-desktop.png` — completed human-review state.
- `artifacts/screenshots/proof-mobile-source.png` — intentional mobile source view.
- `submission/visual-qa.md` — two rendered critique rounds and rejected recaptures.
- Film: 00:00–00:58 presents the current Trust Inbox → source-backed Proof Mode → human decision story with captions and eight distinct visual beats.

## Potential impact

Judge question: Does Halba solve a credible problem for a specific audience?

The audience is teams using coding agents who currently reconstruct “done” across chat, reports, diffs, logs, receipts, and source files. Halba gives those runs a Slack-like operational home, then turns completion claims into a short queue containing only unsupported, stale, contradictory, or uncertain work. It does not ask the model to approve itself.

Evidence:

- The public packet includes an actual Build Week patch, test receipt, model execution receipt, privacy receipt, and completion report.
- The six-claim demo reduces the run to four review gates while preserving two verified claims.
- Every gate opens to a stable source range and content hash.
- Browser-local decisions update channel attention without requiring hosted identity or uploading source data; requesting more proof leaves the gate open.

Honest boundary: the bounded import protocol currently supports Codex session metadata, structured CI receipts, and release packets. Arbitrary adapter expansion and raw-transcript storage remain intentionally out of scope.

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

1. Start from `artifacts/screenshots/trust-inbox-desktop.png` or a locally seeded durable runtime; GitHub Pages does not claim to host Trust Inbox.
2. Read the top critical completion claim and its deterministic **Contradiction** reason.
3. Open the routed claim. The synthetic benchmark honestly shows a missing-source boundary rather than inventing evidence.
4. Move to the separate source-backed Pages packet, open the contradictory live-GPT claim, and compare it with `receipts/model-run.json`.
5. Request more proof or resolve the gate; the decision remains scoped to the exact evidence identity and the ranked queue updates.
6. Inspect **Recent decisions** to see the current projection beside append-only transitions.
7. Run `npm run check && npm run smoke && npm run eval` and read the three checked-in evaluation reports.
8. Treat under-60-second human comprehension as unproven until a fresh participant and independent facilitator make `npm run eval:goal` pass and produce the redacted `artifacts/evals/human-trust-inbox-result.*` judge receipt.

## Submission reconciliation

The four current criterion headings remain **Technological Implementation**, **Design**, **Potential Impact**, and **Quality of the Idea**; Halba's existing submission is under **Developer Tools**. This July 20 matrix describes the local Trust Operations candidate. The official rules require a public repository, public demonstration video, project description, test path, and a submission completed by July 21, 2026 at 5:00 PM Pacific Time. External Devpost, Pages, YouTube, and repository parity is not claimed until an explicitly authorized publication pass is completed and verified signed out.
