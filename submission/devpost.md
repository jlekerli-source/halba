# Devpost submission copy

## Project name

Halba

## Tagline

The local-first agent workspace where “done” comes with proof.

## Links

- Demo: [https://jlekerli-source.github.io/halba/](https://jlekerli-source.github.io/halba/)
- Video: [https://youtu.be/5wuC21fJVdo](https://youtu.be/5wuC21fJVdo)
- Downloadable film mirror: [https://jlekerli-source.github.io/halba/demo/halba-demo.mp4](https://jlekerli-source.github.io/halba/demo/halba-demo.mp4)
- Source: [https://github.com/jlekerli-source/halba](https://github.com/jlekerli-source/halba)

The public YouTube URL is the Devpost video-field value. The GitHub-hosted MP4 remains the canonical evidence mirror.

## Inspiration

AI coding agents can produce impressive work, but the final update often compresses a messy run into confident prose. The expensive part is no longer generating the change—it is finding out which claims are supported, stale, contradicted, or still need a person.

The original prompt was inspired by Theo Browne's [“I don't have time to build these things, will you?”](https://www.youtube.com/watch?v=wEAb0x3wTRc), which called for a Slack alternative that works for agents. Halba is an independent interpretation: not another agent chat surface, but the proof layer after the run. There is no affiliation or endorsement.

## What it does

Halba gives agent work the useful shape of Slack: local workspaces, project channels, chronological run threads, and clear attention. The difference is that its "messages" are typed work events and its attention count comes from unresolved proof, not chatter. A public-safe Codex run in `#halba-build-week` shows what the agent inspected, changed, checked, and claimed before handing the material claims into Proof Mode.

Proof Mode imports the bounded agent report, source files, and machine receipts. GPT-5.6 extracts atomic claims and precise citations. Halba validates every source reference, applies deterministic guards, and assigns one of five verdicts: supported, unsupported, stale, contradicted, or uncertain.

The user sees:

- what changed;
- what is actually verified;
- what is missing or stale;
- what conflicts with deterministic evidence;
- which claims require human review.

Every claim opens to exact source lines, a content hash, the model's reasoning boundary, and the guard results. A human can approve, reject, resolve, or request more proof with a local audit note. Closed gates reduce channel attention; requesting proof intentionally leaves the gate open.

## How we built it

Halba is a dependency-free Node.js application with a static browser frontend. Proof bundles are local JSON plus source files. The server rejects absolute paths, traversal, undeclared files, symlinks, oversized inputs, and invalid line ranges.

The workspace contract validates safe ids, channel/agent/thread references, timestamps, typed event names, proof-bundle linkage, and a 64 KB input ceiling. A checked-in Codex adapter deterministically rebuilds the public workspace from the same bounded completion report, sources, receipts, and adjudication that judges can inspect.

Codex accelerated the Build Week delta end to end: baseline and privacy auditing, Proof Mode implementation, deterministic guards, the eval corpus, rendered frontend iteration, the Remotion film, Docker verification, and public release automation. The most important decisions were to keep evidence local, separate inference from proof authority, label recorded versus live execution, and reserve unresolved decisions for a human. The public demo includes a safe version of the Codex-authored report, diff, and receipts it was built to inspect.

The live inference path uses the OpenAI Responses API with `gpt-5.6-sol`, max reasoning, strict Structured Outputs, and `store: false`. Model output is never authoritative by itself. The adjudicator checks exact quotes and runs deterministic receipt, freshness, JSON-field, and required-citation guards before producing a verdict.

The public Pages demo uses synthetic evidence and a clearly labeled structured-inference fixture so judges can reproduce the full workflow without providing credentials. It is not presented as evidence of a live GPT request. The Node and Docker paths retain the optional live integration, which fails closed when it is not configured or returns an invalid model response.

## Challenges

The hardest design problem was separating inference from proof. It is tempting to let a strong model act as the judge. Halba instead treats model output as untrusted structured input and preserves deterministic authority where the source can answer directly.

Public release preparation was also a product problem. The pre-existing local app contained private adapters and data. We created a strict allowlist, a secret/path audit, and a clean-room packaging check that rebuilds the release tree and reruns checks, smoke tests, and evals from that tree.

## Accomplishments

- One legible end-to-end workflow from agent report to human decision.
- Exact-source grounding instead of opaque confidence scores.
- Deterministic guards that can override model overconfidence.
- A regression corpus spanning every verdict, malformed output, prompt-like evidence, stale boundaries, false positives, and failed receipts.
- A responsive desktop/mobile review surface built for a short live demo.
- A Slack-style agent workspace with proof-driven attention and typed Codex run events.
- A reproducible public-safe Codex-run importer and validated workspace contract.
- A downloadable review record that preserves exact source hashes, guard outcomes, and human decisions.
- A dependency-free product runtime inside a reproducible, privacy-audited public release.
- A captioned 58-second submission film whose Remotion source, narration, captions, and original sound bed are checked in.

## What we learned

The useful boundary is not “AI versus rules.” GPT-5.6 is excellent at turning an unstructured completion report into testable claims. Rules are excellent at answering narrow questions about receipts, dates, and exact source text. The trustworthy product comes from showing where each one stops.

## What's next

- Additional importers for raw agent run formats and CI receipts.
- Exportable signed review records.
- Team review sync that preserves the local-first data boundary.
- More live-model eval runs with published latency, token usage, and failure distributions.

## Built with

OpenAI Responses API, GPT-5.6 Sol, Codex, Node.js, HTML, CSS, JavaScript, local JSON, Docker, GitHub Pages, Playwright-based browser verification, and Remotion for the submission film.

## Contribution

I designed and built Halba’s local-first agent workspace and Proof Mode: the Codex-run importer, exact-source adjudication, deterministic guards, evals, responsive UI, privacy hardening, packaging, and deployment—with Codex as my implementation partner.
