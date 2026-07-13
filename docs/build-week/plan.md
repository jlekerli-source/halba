# Halba Build Week execution plan

Status: release hardening complete locally; authorized publication, deployment, and Devpost setup in progress

Thesis: Halba is a local-first evidence control plane for AI-assisted work. It turns agent runs, diffs, receipts, and source files into a traceable evidence graph, detects unsupported or stale claims, and shows what actually requires human review.

Flagship workflow: **Proof Mode** is part of Halba. It is not a separate product, chatbot, kanban board, or social surface.

## Execution ledger — 2026-07-13

The acceptance checklists below preserve the original implementation contract. This ledger records the verified outcome without rewriting that history.

| Slice | Status | Evidence |
| --- | --- | --- |
| 1. Date determinism | Complete | Explicit evaluation time plus exact seven/eight-day boundary tests; full check passes. |
| 2. Public boundary | Complete | Public sample defaults, ignored private artifacts, allowlist audit, Apache-2.0 license, and sanitized root commit. |
| 3. Proof bundle | Complete | Six bounded, hashed, line-addressable public sources, including the actual public-safe Build Week diff; traversal, symlink, size, and malformed-input checks. |
| 4. Deterministic findings | Complete | Six claims cover all five verdicts; quote, receipt, JSON-field, citation, and freshness guards. |
| 5. GPT-5.6 integration | Complete for the reproducible submission path | Sol/max Responses API adapter, strict schema, storage off, safe metadata, mocked success/refusal/timeout/malformed paths, and an explicitly labeled structured-inference replay. The optional live API path is not a release gate. |
| 6. API and review lifecycle | Complete | Bundle, run, and exact-source endpoints; guarded errors; browser-local approve/reject/resolve decisions. |
| 7. Proof Mode UI | Complete | Real Chrome desktop/mobile screenshots; loading, replay, live-unavailable, empty queue, source, and human-decision states rendered. Normal demo path has zero console errors or warnings. |
| 8. Evals | Complete for replay | Nine of nine cases pass, including degraded inputs and deterministic replay. Exact gold-source grounding precision and recall are 100%; replay latency is reported separately from unmeasured optional live-model latency, usage, cost, and accuracy. |
| 9. Reproducible package | Complete | `release:check` reconstructs 106 allowlisted files, reruns check, smoke, and eval, hashes the archive, extracts it, and runs the suites again from the extracted copy. The final Docker image built from that exact tree and passed its health, UI, bundle, recorded-proof, and embedded-video hash checks. |
| 10. Submission package | Complete locally; publication in progress | Public screenshots, Devpost copy, 90-second live script, reproducible 78-second captioned film, architecture, disclosure, attribution, deployment guide, evidence index, canonical repository URL, and GitHub Pages target are present. |

Remaining gates:

- Publish only the sanitized `main` branch, deploy the public demo, and record the resulting URLs after external authentication succeeds.
- Devpost currently exposes registration but has not yet published the official rules or submission form; reconcile the final package with those fields as soon as they appear.
- A live Responses API run is optional development evidence, not a release gate. The recorded path remains explicit and the live path continues to fail closed when it is not configured.

## Event baseline and delta policy

- The private pre-event tree was captured before product changes in the immutable local baseline `build-week-prebaseline-20260713T000217Z` outside this repository.
- That baseline includes the full working tree and Git metadata, file hashes, command transcripts, and real Chrome screenshots at desktop and mobile sizes.
- The baseline contains private local artifacts and must never enter public history, release archives, screenshots, or remotes.
- The Build Week delta starts with this plan and will be disclosed separately from pre-existing Halba work.
- External publication is authorized as of 2026-07-13. Only the audited public branch and clean release artifact may leave this machine; private baseline and local tool refs remain local.

## Architecture decisions

1. Keep the dependency-free Node/HTML/CSS/JavaScript stack unless evidence shows it blocks the flagship workflow.
2. Make the public-safe demo bundle the default runtime. Private source adapters are local extensions and stay outside public history.
3. Use deterministic code for file containment, source-line validation, dates, staleness, exact contradictions, schema validation, and review-state authority.
4. Use GPT-5.6 Sol for structured semantic inference: extracting claims, linking plausible evidence, explaining uncertainty, and proposing human-review questions.
5. Call the Responses API only from the local server. The browser never receives an API key. Requests use `gpt-5.6-sol`, `reasoning.effort: "max"`, strict Structured Outputs, and `store: false`.
6. Keep an explicitly labeled recorded-response mode so the public demo and regression suite remain runnable without credentials. Recorded output is never described as a live model run.
7. Treat every model citation as untrusted until deterministic validation confirms the referenced source and line range exist in the imported bundle.
8. Store human approve, reject, and resolve decisions locally. The model can recommend a gate; it cannot silently clear one.
9. Ship one excellent proof-review path before adapters, hosted sync, collaboration, or broad workflow features.

## Dependency graph

```text
immutable baseline
  -> deterministic date fix
  -> public/private boundary
    -> public proof-bundle contract
      -> deterministic proof engine
        -> GPT-5.6 structured inference adapter
          -> Proof Mode API
            -> Proof Mode UI and review decisions
              -> eval corpus and regression gates
                -> public package and privacy proof
                  -> rendered demo and submission artifacts
                    -> authorized publish/deploy step
```

## Vertical slices

### Slice 1: Make review gates deterministic across dates

Description: Remove the known wall-clock dependency from the stale-count test while preserving current-date behavior in production.

Acceptance criteria:

- [ ] `reviewGateSummary` accepts an explicit evaluation time.
- [ ] Tests pass on any calendar date and cover the exact proof-window boundary.
- [ ] Production callers still default to the actual current time.

Verification:

- [ ] `pnpm run check:sort`
- [ ] `pnpm run check:stale`
- [ ] `pnpm run check`

Dependencies: immutable baseline.

Likely files: `src/domain/feed.js`, `scripts/check-feed-sort.mjs`, `scripts/check-stale.mjs`.

Estimated scope: small.

### Slice 2: Establish a provably public-safe repository surface

Description: Separate public product files from local private evidence, replace private defaults with explicit configuration, and make the sample/demo path the default.

Acceptance criteria:

- [ ] Default startup exposes only public-safe demo data and source files.
- [ ] Private feeds, run receipts, screenshots, coordination notes, and local adapters are ignored or excluded from public history.
- [ ] No absolute personal path, private portfolio content, credential, or private screenshot appears in the public file set.
- [ ] Apache-2.0 license, security policy, public architecture note, and sample-first setup exist.

Verification:

- [ ] `pnpm run audit:public`
- [ ] `pnpm run package:dry-run`
- [ ] `git rev-list --objects refs/heads/main` is audited after the sanitized initial commit; local tool refs are never mirrored or pushed.

Dependencies: Slice 1.

Likely files: `.gitignore`, `package.json`, `src/server.js`, `README.md`, public-release documents.

Estimated scope: medium, split into configuration and documentation checkpoints.

### Slice 3: Import one reviewable proof bundle end to end

Description: Define a compact public bundle containing a run receipt, claims, source files, a diff, and test receipts; index every source by stable path and line number.

Acceptance criteria:

- [ ] A public-safe Halba Build Week example imports without external services.
- [ ] Each source receives stable line-addressable references and a content hash.
- [ ] Unsafe, missing, oversized, and malformed inputs fail with actionable errors.
- [ ] The importer produces the same normalized graph for identical input.

Verification:

- [ ] `pnpm run check:proof-bundle`
- [ ] `pnpm run import:demo -- --check`
- [ ] malformed and traversal fixtures are rejected.

Dependencies: Slice 2.

Likely files: `docs/proof-bundle.md`, `data/demo/`, `src/proof/bundle.js`, `scripts/check-proof-bundle.mjs`.

Estimated scope: medium.

### Slice 4: Produce deterministic proof findings

Description: Turn normalized claims and evidence into authoritative supported, unsupported, stale, contradictory, and uncertain findings before model inference is considered.

Acceptance criteria:

- [ ] Exact citations and source ranges are validated against indexed content.
- [ ] Date staleness and explicit contradictory values are deterministic.
- [ ] Missing proof stays unsupported; uncertainty never becomes verified.
- [ ] Every finding records the guard that produced it and whether human review is required.

Verification:

- [ ] `pnpm run check:proof-engine`
- [ ] golden fixtures cover all five verdict classes.

Dependencies: Slice 3.

Likely files: `src/proof/engine.js`, `src/proof/schema.js`, `scripts/check-proof-engine.mjs`, eval fixtures.

Estimated scope: medium.

### Slice 5: Add GPT-5.6 Sol structured inference

Description: Send a bounded, privacy-explicit evidence packet to the Responses API and convert strict structured output into candidate claims and evidence links for deterministic adjudication.

Acceptance criteria:

- [ ] Server-side request uses `gpt-5.6-sol`, `reasoning.effort: "max"`, strict `text.format` JSON Schema, and `store: false`.
- [ ] No credential or raw private path can reach browser output or logs.
- [ ] Recorded mode is clearly labeled and deterministic; live mode fails closed when no key exists.
- [ ] Model citations that fail source/range validation are rejected and surfaced as unsupported inference.
- [ ] Usage, latency, response id, model id, and execution mode are recorded as safe run metadata when available.

Verification:

- [ ] `pnpm run check:openai-adapter`
- [ ] mocked Responses API success, refusal, timeout, malformed output, and invalid-citation cases pass.
- [ ] Live verification is recorded separately and is not required to pass when no key is configured.

Dependencies: Slice 4.

Likely files: `src/proof/openai.js`, `src/proof/prompt.js`, `src/proof/schema.js`, `scripts/check-openai-adapter.mjs`.

Estimated scope: medium.

### Slice 6: Ship the Proof Mode API and review lifecycle

Description: Expose one bounded local endpoint that runs or replays proof analysis and returns normalized findings plus human review gates.

Acceptance criteria:

- [ ] `POST /api/proof/run` supports public demo replay and optional live execution.
- [ ] Request size, method, content type, source selection, and errors are guarded.
- [ ] Findings answer what changed, what is verified, what is unsupported, and what needs review.
- [ ] Approve, reject, and resolve actions never alter source truth and persist only in local browser state.

Verification:

- [ ] `pnpm run check:proof-api`
- [ ] `pnpm run smoke:proof`

Dependencies: Slice 5.

Likely files: `src/server.js`, `src/proof/run.js`, `scripts/check-proof-api.mjs`, `scripts/smoke-proof.mjs`.

Estimated scope: medium.

### Slice 7: Rebuild the first-use experience around Proof Mode

Description: Replace the sprawling dashboard-first experience with a judge-legible proof review flow: import/demo start, verdict summary, claim queue, exact source, reasoning boundary, and human gate.

Acceptance criteria:

- [ ] A first-time judge can run the bundled demo and understand the value in under 90 seconds.
- [ ] The first viewport prioritizes Proof Mode, not roadmap metadata or generic dashboard counts.
- [ ] Every claim shows verdict, confidence boundary, exact source, guard/model provenance, and required human action.
- [ ] Empty, loading, replay, live, timeout, refusal, malformed, and no-match states give a concrete next action.
- [ ] Desktop and mobile are intentionally composed; mobile does not render the entire desktop app as one long stack.
- [ ] Keyboard navigation, visible focus, 40px minimum hit areas, reduced motion, contrast, and semantic state are verified.

Verification:

- [ ] Real Chrome screenshots at desktop and mobile widths.
- [ ] Keyboard-only walkthrough and zero browser console errors.
- [ ] `pnpm run check:view-state`
- [ ] `pnpm run smoke:proof`

Dependencies: Slice 6.

Likely files: `public/index.html`, `public/app.js`, `public/styles.css`, `public/halba-icon.svg` only if the mark blocks legibility.

Estimated scope: medium per UI checkpoint; avoid a one-shot rewrite.

Design direction:

- Subject: an evidence examiner for builders using AI agents.
- Audience: Build Week judges and technical operators who distrust unsupported completion claims.
- Single job: decide whether an agent claim can pass human review.
- Palette: Ink `#121714`, paper `#F7F5EE`, proof teal `#087E70`, caution amber `#B66A16`, contradiction red `#B6382E`, cool evidence `#D9E7E2`.
- Type: system UI for readable body text, compact mono for source references and receipts, high-contrast display treatment only for verdict language.
- Signature: a trace line that physically connects each claim verdict to its exact source range and deterministic guard.
- Mobile structure: summary, active claim, source drawer, then review decision; secondary inventory moves behind disclosure.

### Slice 8: Build repeatable proof-quality evals

Description: Evaluate inference and guards on a versioned public corpus with honest metrics and regression thresholds.

Acceptance criteria:

- [ ] Corpus covers supported, unsupported, stale, contradictory, ambiguous, malformed, missing, and adversarial source cases.
- [ ] Metrics include verdict accuracy, citation validity, source-grounding precision, unsupported-claim recall, contradiction recall, false-positive rate, degraded-input behavior, and review-gate recall.
- [ ] Replay evals are deterministic and mandatory; live GPT evals report model, latency, usage, and failures when credentials are available.
- [ ] Thresholds fail CI locally instead of hiding regressions.
- [ ] Eval report separates deterministic-guard performance from model inference performance.

Verification:

- [ ] `pnpm run eval`
- [ ] `pnpm run eval:report`
- [ ] repeated replay runs produce identical results.

Dependencies: Slices 4-7.

Likely files: `evals/corpus.json`, `evals/recorded/`, `scripts/eval.mjs`, `docs/evals.md`.

Estimated scope: medium.

### Slice 9: Make the public package reproducible

Description: Produce a release candidate that contains only public-safe code, fixtures, docs, and proof artifacts.

Acceptance criteria:

- [ ] A clean extracted package starts and runs the demo from documented commands.
- [ ] Privacy scan, secret scan, manifest allowlist, source-path scan, and public-history scan pass.
- [ ] README explains architecture, GPT role, deterministic authority, setup, evals, limitations, and privacy.
- [ ] License and pre-existing-versus-Build-Week disclosure are explicit.
- [ ] No private adapter, data, screenshot, path, coordination note, or dangling claim is in public history.

Verification:

- [ ] `pnpm run release:check`
- [ ] `pnpm run package:dry-run`
- [ ] extract release candidate into a clean temporary directory, then run `pnpm run check`, `pnpm run smoke`, and `pnpm run eval`.

Dependencies: Slices 2-8.

Likely files: `README.md`, `LICENSE`, `SECURITY.md`, release manifest/scripts, public architecture and privacy docs.

Estimated scope: medium.

### Slice 10: Prepare the judge demo and submission package

Description: Make the product explainable and reproducible without overselling unverified capabilities.

Acceptance criteria:

- [ ] A 90-120 second demo script shows import, GPT inference or labeled replay, deterministic adjudication, exact source opening, and human resolution.
- [ ] Final desktop and mobile screenshots use only public demo data.
- [ ] Devpost copy covers problem, insight, workflow, OpenAI use, architecture, validation, limitations, and Build Week delta.
- [ ] Attribution to public inspiration is source-verified and avoids partnership or endorsement language.
- [ ] Deployment guide and container/start commands work locally; external deployment remains an authorization gate.
- [ ] Final evidence index links commands, reports, screenshots, architecture, privacy proof, and known blockers.

Verification:

- [ ] scripted browser walkthrough succeeds from a clean package.
- [ ] screenshot critique has at least two iteration rounds.
- [ ] all submission claims map to evidence in the final index.

Dependencies: Slice 9.

Likely files: `submission/`, `docs/demo.md`, `docs/architecture.md`, final screenshots under a public artifact directory.

Estimated scope: medium.

## Execution checkpoints

### Checkpoint A: baseline and deterministic health

- [ ] Immutable pre-event baseline hash verifies.
- [ ] Date-sensitive stale-count failure is fixed.
- [ ] `pnpm run check` and both smoke modes pass.

### Checkpoint B: public boundary

- [ ] Public runtime defaults to demo data.
- [ ] Privacy, secret, package-manifest, and public-history scans pass.
- [ ] Only sanitized files enter the initial public commit.

### Checkpoint C: flagship vertical slice

- [ ] Proof bundle imports.
- [ ] GPT adapter or clearly labeled replay produces structured candidate findings.
- [ ] Deterministic guards validate citations and verdicts.
- [ ] A human can inspect source and resolve the gate.

### Checkpoint D: eval and rendered proof

- [ ] Eval thresholds pass or failures are documented with exact cases.
- [ ] Desktop and mobile screenshots are critiqued and iterated.
- [ ] Loading, empty, replay, live-unavailable, error, and review states are rendered.

### Checkpoint E: release candidate

- [ ] Clean-package checks, smoke, evals, and demo walkthrough pass.
- [ ] Submission copy and evidence index contain no unsupported claim.
- [ ] Remaining external steps are isolated behind explicit authorization.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Private local data enters public history | Critical | Immutable private backup, allowlist packaging, ignored private paths, content scans, intended-branch/tag enumeration, and an explicit branch-only push before any remote action. Never mirror local tool refs. |
| Optional live API execution is not part of the development gate | Medium | Verify the adapter with mock HTTP plus labeled recorded responses; keep replay and live execution visibly distinct and never imply a live call. |
| Model output cites nonexistent proof | High | Validate every path, hash, and line range deterministically; reject invalid citations and require review. |
| The UI remains a dense dashboard instead of a demo story | High | Make Proof Mode the first viewport, move metadata behind disclosure, render at judge and mobile widths, and iterate from screenshots. |
| Public demo data feels synthetic | Medium | Use Halba's own public Build Week delta and command receipts as the demo bundle, with reproducible generation instructions. |
| Vanilla files become unmaintainably large | Medium | Extract proof-specific domain modules first; split UI only along stable workflow boundaries and avoid framework churn. |
| Max reasoning is slow or costly | Medium | Preserve `max` for the judge-quality workflow, measure live latency/cost when possible, and keep deterministic replay for development and demos. |
| Deterministic and model verdicts conflict | Medium | Deterministic guards remain authoritative; surface disagreement as a human-review reason. |
| Attribution is inaccurate | Medium | Verify the original public source before including names or quotes; describe inspiration only, never partnership or endorsement. |
| Public release could accidentally include local-only refs or artifacts | Critical | External publication is authorized, but push only audited `main`; never mirror local tool refs or upload the private baseline. |

## Project-wide definition of done

Halba is complete for this Build Week objective only when all of the following are true:

- [ ] Scope: Proof Mode is demonstrably Halba's flagship workflow and no social, chat, kanban, or ShipGuard redesign scope has leaked in.
- [ ] Correctness: deterministic guards, proof API, public demo import, and review decisions behave as specified.
- [ ] OpenAI: the shipped adapter centrally uses GPT-5.6 Sol with max reasoning and structured inference; its live-verification status is stated honestly.
- [ ] Grounding: every displayed proof citation opens the exact public-safe source and line range; invalid citations cannot pass.
- [ ] Evaluation: replay eval thresholds pass, live eval status is recorded, and failures are enumerable by case.
- [ ] Reliability: `pnpm run check`, `pnpm run smoke`, focused proof checks, view-state checks, import checks, delta checks, and clean-package checks pass.
- [ ] UX: onboarding, happy path, human gate, empty, loading, replay, live-unavailable, refusal, timeout, malformed, and degraded-input states are understandable.
- [ ] Accessibility: keyboard use, visible focus, semantic states, minimum hit areas, reduced motion, contrast, and responsive layouts are verified on the rendered app.
- [ ] Privacy: public tree, history, package, screenshots, docs, and demo data contain no private path, portfolio record, secret, or local coordination artifact.
- [ ] Documentation: setup, architecture, proof contract, OpenAI boundary, eval methodology, privacy model, limitations, and contribution path are current.
- [ ] Submission: demo script, screenshots, Devpost copy, architecture explanation, verified inspiration credit, pre-existing-work disclosure, Build Week delta, and evidence index are ready.
- [ ] Reproducibility: a clean extracted release candidate can run the public demo and mandatory checks from the documented commands.
- [ ] Honesty: no build, screenshot, replay, mock, or planned deployment is described as stronger evidence than it is.
- [ ] External gate: public remote creation, push, deployment, video upload, and submission remain undone unless separately authorized.

## Explicitly parked

- ShipGuard redesign; only an optional future adapter may be named.
- DMs, channels, presence, reactions, invites, and realtime collaboration.
- Generic tasks, kanban, roadmap editing, and agent command execution.
- Hosted accounts, auth, sync, billing, and team permissions.
- Broad framework migration or dependency adoption without measured need.
- Public remote, deployment, or submission before the final privacy gate and explicit authorization.
