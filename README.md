# Halba

Halba is a local-first operational workspace for AI agents, with proof built into every material handoff.

It takes the useful shape of Slack—workspaces, channels, chronological agent threads, and attention—then replaces chat noise with typed run events and source-backed review. When an agent says the work is done, Halba answers four questions: **what changed, what is verified, what is unsupported, and what still needs human review?**

Its flagship workflow, **Proof Mode**, turns an agent report, local source files, and run receipts into a traceable evidence graph. GPT-5.6 extracts claims and precise citations; deterministic guards check the actual bytes; a human makes the final decision.

Halba is not a general-purpose chatbot or human Slack clone. Channels organize agent work; Proof Mode decides which claims deserve trust.

![Halba showing a Codex run in an agent channel with four proof gates](artifacts/screenshots/workspace-desktop.jpg)

## Try the public demo

- Public demo: [jlekerli-source.github.io/halba](https://jlekerli-source.github.io/halba/)
- Build Week submission: [devpost.com/software/halba](https://devpost.com/software/halba)
- 58-second film: [jlekerli-source.github.io/halba/demo/halba-demo.mp4](https://jlekerli-source.github.io/halba/demo/halba-demo.mp4)
- Source: [github.com/jlekerli-source/halba](https://github.com/jlekerli-source/halba)

Requirements: Node.js 20 or newer. Halba has no package dependencies.

```bash
npm run check
npm start
```

Open [http://localhost:4177](http://localhost:4177), then open the Proof handoff in `#halba-build-week`. `pnpm` works in place of `npm`.

The default demo is synthetic and public-safe. Its structured-inference fixture is visibly labeled **Recorded** and makes no OpenAI request. The GitHub Pages deployment runs that same read-only recorded workflow entirely in the browser; the Node and Docker paths retain the optional live Responses API endpoint.

## Agent workspace

The public demo contains three channels, three agents, and four selectable runs. Use **Attention** to see only work with unresolved human gates, browse a channel or agent scope, filter by run state, or search event details. The selected scope, filter, query, and run persist locally across reloads.

The proof-ready Codex run in `#halba-build-week` appears as four typed events: source indexing, a file change, deterministic receipts, and a completion-claim handoff. Opening that handoff enters Proof Mode. Other completed or in-progress runs show their own local receipts and never borrow evidence from the proof-ready run.

**Import workspace JSON** accepts a bounded Halba workspace from disk, validates ids, references, counts, timestamps, event boundaries, and proof linkage in the browser, and keeps the imported data only for the current session. It never uploads the file.

The checked-in workspace is generated from the existing public-safe Codex completion report, bounded proof bundle, receipts, and recorded adjudication:

```bash
npm run import:codex-demo
npm run check:codex-import
```

The importer does not scrape private transcripts. It uses the same public-safe packet that judges can inspect, validates the normalized workspace, and produces `data/demo/workspace.json` deterministically.

## What Proof Mode does

1. Loads one bounded local proof bundle containing claims, source files, and receipts.
2. Uses GPT-5.6 Sol with max reasoning and strict Structured Outputs to propose claim boundaries and citations.
3. Verifies source membership, line ranges, and exact quotes.
4. Applies authoritative receipt, freshness, JSON-field, and required-citation guards.
5. Assigns `supported`, `unsupported`, `stale`, `contradicted`, or `uncertain`.
6. Opens every verdict to the exact source, content hash, model reasoning boundary, and guard trace.
7. Records a human approve, reject, or resolve decision locally in the browser.
8. Lets a reviewer request more proof without falsely closing the gate.
9. Downloads a portable Markdown review record with verdicts, exact source ranges and hashes, guards, human decisions, and decision timestamps.

The model proposes; Halba checks; the human decides.

## Optional live GPT-5.6

Provide a key only to the server process:

```bash
OPENAI_API_KEY=... npm start
```

Then choose **Run live GPT-5.6**. The request uses:

- `gpt-5.6-sol`;
- reasoning effort `max`;
- strict JSON Schema output;
- `store: false`;
- only the bounded active proof packet.

Credentials never enter browser code. Missing credentials, refusals, timeouts, malformed JSON, and schema-invalid responses fail closed; Halba does not silently substitute the recording.

See [`docs/openai.md`](docs/openai.md) for the inference boundary.

## Evaluation

```bash
npm run eval
```

The public regression suite contains two corpora:

- nine proof cases covering all five verdicts, citation fabrication, unknown sources, model/guard disagreement, failed receipts, the exact stale boundary, prompt-like evidence, malformed output, false positives, and deterministic replay;
- ten workspace boundary cases covering valid import, unknown channels, agents and event types, duplicate events, out-of-bounds events, wrong proof linkage, review-count drift, unsafe ids, and inverted timestamps.

The checked-in reports currently pass 9/9 proof cases and 10/10 workspace cases. The compact proof corpus reports 100% expected-verdict accuracy, 100% exact gold-source grounding precision and recall, and 0% final-verdict false positives. The workspace corpus reports 0% unsafe acceptance and 0% false rejection. These results validate the checked-in adjudication, grounding, and routing contracts—not live-model quality. Optional live-model latency, usage, cost, and accuracy are not claimed by the replay reports.

Read [`artifacts/evals/latest.md`](artifacts/evals/latest.md), [`artifacts/evals/workspace-latest.md`](artifacts/evals/workspace-latest.md), and [`docs/evals.md`](docs/evals.md).

## How Codex and GPT-5.6 were used

Codex was the Build Week implementation partner. It audited the private pre-event baseline, implemented Proof Mode and its deterministic guards, built the public-safe bundle and eval corpus, iterated the rendered interface, produced the reproducible film, and exercised the clean release in GitHub Pages and Docker. The public demo's own completion report, diff, and receipts make part of that Codex-authored delta inspectable inside Halba.

GPT-5.6 Sol is part of the shipped product rather than only the development process. It converts an unstructured completion report into atomic claims, precise citations, uncertainty, and review questions under a strict schema. Halba then validates its output against exact source lines and lets deterministic guards override the model where receipts, dates, or required citations provide stronger authority.

The key product decisions were to keep source bytes local, make recorded and live execution visibly distinct, preserve deterministic authority, and require a human decision for unresolved boundaries. Those decisions are encoded in the runtime, evals, screenshots, and release checks—not only described in submission copy.

## Reconstruct the public release

```bash
npm run release:check
```

This command:

- copies only the explicit public allowlist into `dist/halba-public/`;
- proves known private paths are absent;
- reruns checks, HTTP smoke tests, and evals inside that clean tree;
- creates `dist/halba-public.tar.gz` and a SHA-256 evidence record;
- extracts the archive and reruns the same suites from the extracted copy;
- performs no push, deployment, upload, or submission.

The allowlist is [`docs/public-package-manifest.md`](docs/public-package-manifest.md). Container instructions are in [`docs/deployment.md`](docs/deployment.md).

## Architecture

Halba intentionally stays small:

- dependency-free Node.js HTTP server;
- static HTML, CSS, and browser JavaScript;
- local JSON and source files;
- bounded, read-only source inspection;
- server-side OpenAI integration;
- deterministic guards ahead of final verdicts;
- browser-local human review records.

See [`docs/architecture.md`](docs/architecture.md) and [`docs/proof-bundle.md`](docs/proof-bundle.md).

## Privacy model

- Public sample data is the default.
- The release is built from an allowlist, not from the working tree by exclusion alone.
- Personal paths, known private-source markers, and credential-shaped content are audit failures.
- OpenAI requests are opt-in, bounded, server-side, and configured with storage disabled.
- Local feeds, raw transcripts, environment files, import histories, and private adapters are not in the public artifact.

Read [`docs/privacy.md`](docs/privacy.md) and [`SECURITY.md`](SECURITY.md).

## Build Week disclosure

Halba began Build Week as a local evidence-feed MVP with stale detection, source previews, and review export. Proof Mode, the GPT-5.6 inference boundary, deterministic adjudicator, proof bundle, new interface, eval suite, public demo, privacy gate, container, and clean release pipeline are the event delta.

The full disclosure is in [`submission/build-week-delta.md`](submission/build-week-delta.md). Judge-ready copy, a 90-second live script, a reproducible 58-second captioned film, and the evidence index live in [`submission/`](submission/).

## Inspiration

The original prompt was inspired by Theo Browne's June 22, 2026 video, [“I don't have time to build these things, will you?”](https://www.youtube.com/watch?v=wEAb0x3wTRc), which included a call for a Slack alternative that works for agents.

Halba is an independent response focused on evidence and human review. Theo and the T3 Code ecosystem did not build, sponsor, partner on, or endorse Halba. See the [attribution record](submission/attribution.md).

## Scope

In scope: local workspaces, project/goal channels, typed agent run threads, evidence ingestion, claim extraction, exact-source grounding, stale and contradictory proof detection, human review gates, evals, and review exports.

Out of scope: human DMs, reactions, presence, typing indicators, hosted accounts, generic roadmap management, and arbitrary agent command execution. Realtime infrastructure waits until file refresh is measurably insufficient.

The active expansion plan is [`docs/agent-workspace-plan.md`](docs/agent-workspace-plan.md).

## Contributing

Contributions are welcome for local agent adapters, typed run events, deterministic proof guards, eval fixtures, exact-source review, and the workspace interface. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a change; fixtures must be synthetic or unquestionably public-safe.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
