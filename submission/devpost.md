# Devpost submission copy

## Project name

Halba

## Tagline

The evidence control plane that checks whether an AI agent's “done” can pass human review.

## Inspiration

AI coding agents can produce impressive work, but the final update often compresses a messy run into confident prose. The expensive part is no longer generating the change—it is finding out which claims are supported, stale, contradicted, or still need a person.

The original prompt was inspired by Theo Browne's [“I don't have time to build these things, will you?”](https://www.youtube.com/watch?v=wEAb0x3wTRc), which called for a Slack alternative that works for agents. Halba is an independent interpretation: not another agent chat surface, but the proof layer after the run. There is no affiliation or endorsement.

## What it does

Proof Mode imports a portable bundle containing an agent report, source files, and machine receipts. GPT-5.6 extracts atomic claims and precise citations. Halba validates every source reference, applies deterministic guards, and assigns one of five verdicts: supported, unsupported, stale, contradicted, or uncertain.

The user sees:

- what changed;
- what is actually verified;
- what is missing or stale;
- what conflicts with deterministic evidence;
- which claims require human review.

Every claim opens to exact source lines, a content hash, the model's reasoning boundary, and the guard results. A human can approve, reject, or resolve the gate with a local audit note.

## How we built it

Halba is a dependency-free Node.js application with a static browser frontend. Proof bundles are local JSON plus source files. The server rejects absolute paths, traversal, undeclared files, symlinks, oversized inputs, and invalid line ranges.

The live inference path uses the OpenAI Responses API with `gpt-5.6-sol`, max reasoning, strict Structured Outputs, and `store: false`. Model output is never authoritative by itself. The adjudicator checks exact quotes and runs deterministic receipt, freshness, JSON-field, and required-citation guards before producing a verdict.

The public demo uses synthetic evidence and a clearly labeled structured-inference fixture so judges can reproduce the full workflow without providing credentials. It is not presented as evidence of a live GPT request. The live path fails closed when credentials or a valid model response are unavailable.

## Challenges

The hardest design problem was separating inference from proof. It is tempting to let a strong model act as the judge. Halba instead treats model output as untrusted structured input and preserves deterministic authority where the source can answer directly.

Public release preparation was also a product problem. The pre-existing local app contained private adapters and data. We created a strict allowlist, a secret/path audit, and a clean-room packaging check that rebuilds the release tree and reruns checks, smoke tests, and evals from that tree.

## Accomplishments

- One legible end-to-end workflow from agent report to human decision.
- Exact-source grounding instead of opaque confidence scores.
- Deterministic guards that can override model overconfidence.
- A regression corpus spanning every verdict, malformed output, prompt-like evidence, stale boundaries, false positives, and failed receipts.
- A responsive desktop/mobile review surface built for a short live demo.
- A reproducible, privacy-audited, dependency-free public artifact.

## What we learned

The useful boundary is not “AI versus rules.” GPT-5.6 is excellent at turning an unstructured completion report into testable claims. Rules are excellent at answering narrow questions about receipts, dates, and exact source text. The trustworthy product comes from showing where each one stops.

## What's next

- First-class importers for common agent run formats and CI receipts.
- Exportable signed review records.
- Team review sync that preserves the local-first data boundary.
- More live-model eval runs with published latency, token usage, and failure distributions.

## Built with

OpenAI Responses API, GPT-5.6 Sol, Node.js, HTML, CSS, JavaScript, local JSON, and Playwright-based browser verification.
