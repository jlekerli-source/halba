# Submission evidence index

## Existing public surfaces

These URLs identify the previously published submission surfaces. The July 20 Trust Operations candidate has not yet been pushed, uploaded, or used to mutate Devpost; publication is authorized, but current parity must still be verified after each external mutation.

| Surface | Signed-out truth verified 2026-07-20 | Candidate status |
| --- | --- | --- |
| GitHub Pages | Still presents the earlier **Agent Workspace** title and brand | Historical public demo; not Trust Operations parity proof |
| Devpost | Still presents the earlier local-first agent-workspace tagline, story, and gallery | Submitted historical version; candidate update not performed |
| GitHub `main` | README still frames Halba as the agent workspace | Public source exists; July 20 candidate not pushed |
| YouTube | Existing 58-second submission video remains at the submitted URL | Historical upload; current local Trust Operations encode not uploaded |

Publication proof requires all four surfaces to be updated from the same release candidate and rechecked signed out. Until then, local release evidence and the artifacts indexed below are the authority for the July 20 candidate.

- Demo: [https://jlekerli-source.github.io/halba/](https://jlekerli-source.github.io/halba/)
- Submitted Devpost project: [https://devpost.com/software/halba](https://devpost.com/software/halba)
- Existing submitted YouTube film: [https://youtu.be/5wuC21fJVdo](https://youtu.be/5wuC21fJVdo)
- Existing downloadable film mirror: [https://jlekerli-source.github.io/halba/demo/halba-demo.mp4](https://jlekerli-source.github.io/halba/demo/halba-demo.mp4)
- Source: [https://github.com/jlekerli-source/halba](https://github.com/jlekerli-source/halba)
- Deploy proof: [GitHub Actions run 29517016623](https://github.com/jlekerli-source/halba/actions/runs/29517016623)
- `scripts/build-pages.mjs` and `.github/workflows/pages.yml` — public-safe static build and deployment path.
- [`judging-matrix.md`](judging-matrix.md) — official criterion-to-evidence map and fast judge path.
- [`devpost-submission.md`](devpost-submission.md) — final form values and the observed submission confirmation.

## Product proof

- `artifacts/demo/halba-demo.mp4` — captioned 72-second H.264/AAC product film, inspected across twelve encoded frames and fully decoded without error.
- `artifacts/demo/halba-demo-still.png` — public poster frame.
- `artifacts/demo/devpost-thumbnail.png` — 1200 × 800, 3:2 project-gallery artwork.
- `artifacts/demo/halba-og-card.png` — 1200 × 630 link-preview treatment.
- `artifacts/demo/halba-social-square.png` — 1080 × 1080 social treatment.
- `submission/video/` — isolated, reproducible Remotion source, caption timings, and narration script.
- [`video-hosting.md`](video-hosting.md) and [`devpost-checklist.md`](devpost-checklist.md) — exact upload metadata and final-form reconciliation gate.
- `artifacts/screenshots/onboarding-desktop.png` — public bundle onboarding.
- `artifacts/screenshots/trust-inbox-desktop.png` — current 60-second Trust Circuit and ranked three-workspace queue.
- `artifacts/screenshots/trust-inbox-mobile.png` — current 390-pixel ranked queue.
- `artifacts/screenshots/trust-inbox-proof.png` — routed contradiction, explicit missing-source boundary, deterministic guard, and human gate.
- `artifacts/screenshots/trust-inbox-receipt.png` — exact degraded import receipt and local privacy boundary.
- `artifacts/screenshots/trust-inbox-recent-decisions.png` — current evidence-scoped decisions and append-only transitions.
- `artifacts/screenshots/loading-desktop.png` — stable loading and guard-adjudication state.
- `artifacts/screenshots/proof-desktop.png` — full three-pane Proof Mode result.
- `artifacts/screenshots/proof-diff-desktop.png` — actual Build Week stale-clock diff opened at its exact source range.
- `artifacts/screenshots/review-resolved-desktop.png` — zero-open-review completion state.
- `artifacts/screenshots/live-unavailable-desktop.png` — explicit, recoverable optional-live error state.
- `artifacts/screenshots/proof-mobile-source.png` — exact-source mobile view.
- `artifacts/screenshots/workspace-desktop.jpg` — project channel, typed Codex run, proof-driven attention, and Proof Mode handoff.
- `artifacts/screenshots/workspace-proof-desktop.jpg` — the same run opened to the exact contradictory receipt.
- `artifacts/screenshots/workspace-mobile.jpg` — intentional mobile workspace composition.
- [`visual-qa.md`](visual-qa.md) — rendered-state critique and recapture record.
- `data/demo/` — synthetic public proof bundle and labeled recording.
- `data/demo/diffs/stale-review-clock.patch` — public-safe diff derived from the immutable pre-event baseline and current implementation.

## Evaluation proof

- `evals/corpus.json` — regression inputs and expected outcomes.
- `artifacts/evals/latest.json` — machine-readable metrics.
- `artifacts/evals/latest.md` — human-readable report.
- `artifacts/evals/workspace-latest.json` and `artifacts/evals/workspace-latest.md` — ten workspace-boundary cases, including invalid references, event types, proof links, ids, and timestamps.
- `artifacts/evals/trust-operations-baseline.json` and `artifacts/evals/trust-operations-baseline.md` — three workspaces, 120 runs, 11/11 gold attention recall, precision 1.0, correct top issue, deterministic replay, and an explicit `not_run` human-comprehension status.
- `.halba/evals/human-trust-inbox/` — private location for exclusive-create raw human attempts and the local append ledger; a verified `passing.json` appears there only after an eligible real session. The directory and passing record are currently absent, consistent with `humanGate: not_run`, and are deliberately excluded from the public package. The local operator can still delete these files, so this is protocol retention rather than an external immutable store.
- `artifacts/evals/human-trust-inbox-result.json` and `.md` — emitted only after an eligible passing session as a redacted judge receipt with no aliases, response text, or facilitator note. The receipt binds every pass predicate, the current trial/report, the private record digest, and a response digest. Its absence means the human gate remains `not_run`.
- `docs/evals.md` — metric definitions and limitations.

## Release proof

Run:

```bash
npm run release:check
```

The command produces:

- `dist/halba-public/` — reconstructed allowlisted tree;
- `dist/halba-public.tar.gz` — release candidate;
- `dist/release-evidence.json` — archive hash, file count, and suite results.

`npm run release:check` produces the engineering candidate while reporting the human status honestly. `npm run release:goal` is the final completion gate: it additionally requires a current verified private passing record and an exact matching public receipt before the release is reconstructed.

The release gate runs `check`, `smoke`, `eval`, and—when Chrome is available—the real Trust Inbox and 2,000-run browser gates inside the reconstructed tree. It extracts the archive and repeats the same evidence from the extracted copy. `dist/release-evidence.json` records the exact current file count, archive hash, browser status, explicit `humanGate` status, `liveOpenAIEval: not_run_without_explicit_credentials`, and `publication: not_performed`. The archive hash is intentionally not embedded in this included file because doing so would change the archive it describes.

Historical container proof from the July 13 candidate: the Dockerfile was built from that pass's `dist/halba-public`; the resulting container reached `healthy`, served the UI and six-source bundle, and returned the six-claim recorded proof with four review gates. This is bounded historical infrastructure evidence, not current July 20 candidate-bound Docker proof.

The currently published Pages app proves the historical recorded workspace and Proof Mode route; it is not cited as a hosted Trust Inbox or as July 20 candidate parity. The local durable browser suite proves Trust Inbox ranking, keyboard routing, exact receipt handling, decision transitions, queue updates, responsive layouts, and bounded 2,000-run rendering with a clean console/network. The current local submission film is rendered from the current Trust Inbox assets and inspected as a 72.04-second H.264/AAC artifact; its SHA-256 is `bedaad04931a630fced3555aaf32cc3a9d499015306890b0defab6ef0c6779fa`.

## Disclosure

- [`build-week-delta.md`](build-week-delta.md) separates pre-existing work from the event delta.
- [`attribution.md`](attribution.md) records the verified inspiration source and non-affiliation boundary.
- Optional live GPT latency, token usage, cost, and accuracy are not inferred from the replay report.
