# Submission evidence index

## Public surfaces

- Demo: [https://jlekerli-source.github.io/halba/](https://jlekerli-source.github.io/halba/)
- Video: [https://jlekerli-source.github.io/halba/demo/halba-demo.mp4](https://jlekerli-source.github.io/halba/demo/halba-demo.mp4)
- Source: [https://github.com/jlekerli-source/halba](https://github.com/jlekerli-source/halba)
- Deploy proof: [GitHub Actions run 29257080313](https://github.com/jlekerli-source/halba/actions/runs/29257080313)
- `scripts/build-pages.mjs` and `.github/workflows/pages.yml` — public-safe static build and deployment path.
- [`judging-matrix.md`](judging-matrix.md) — official criterion-to-evidence map and fast judge path.

## Product proof

- `artifacts/demo/halba-demo.mp4` — captioned 58-second H.264/AAC product film, inspected at eight timestamps from the encoded artifact.
- `artifacts/demo/halba-demo-still.png` — public poster frame.
- `artifacts/demo/devpost-thumbnail.png` — 1200 × 800, 3:2 project-gallery artwork.
- `submission/video/` — isolated, reproducible Remotion source, caption timings, and narration script.
- [`video-hosting.md`](video-hosting.md) and [`devpost-checklist.md`](devpost-checklist.md) — exact upload metadata and final-form reconciliation gate.
- `artifacts/screenshots/onboarding-desktop.png` — public bundle onboarding.
- `artifacts/screenshots/loading-desktop.png` — stable loading and guard-adjudication state.
- `artifacts/screenshots/proof-desktop.png` — full three-pane Proof Mode result.
- `artifacts/screenshots/proof-diff-desktop.png` — actual Build Week stale-clock diff opened at its exact source range.
- `artifacts/screenshots/review-resolved-desktop.png` — zero-open-review completion state.
- `artifacts/screenshots/live-unavailable-desktop.png` — explicit, recoverable optional-live error state.
- `artifacts/screenshots/proof-mobile-source.png` — exact-source mobile view.
- [`visual-qa.md`](visual-qa.md) — rendered-state critique and recapture record.
- `data/demo/` — synthetic public proof bundle and labeled recording.
- `data/demo/diffs/stale-review-clock.patch` — public-safe diff derived from the immutable pre-event baseline and current implementation.

## Evaluation proof

- `evals/corpus.json` — regression inputs and expected outcomes.
- `artifacts/evals/latest.json` — machine-readable metrics.
- `artifacts/evals/latest.md` — human-readable report.
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

The release gate runs `check`, `smoke`, and `eval` inside the reconstructed tree, extracts the archive, and runs the same suites again from the extracted copy. It does not publish or deploy anything.

The Dockerfile was also built from `dist/halba-public`. The resulting container reached `healthy`, served the UI and six-source bundle, and returned the six-claim recorded proof with four review gates.

The redesigned public Pages app was exercised through replay and a browser-local human rejection with zero console errors; the open-gate count moved from four to three and the decision persisted in local storage. The submission-ready MP4 SHA-256 is `3ea02dadd67a4eb7ba80034cb8b3ab79dd2a76844b4015e7e43e94fae9de021d`; deployment verification must match that digest before submission. The local rendered-state suite separately covers the exact stale-clock diff, four decisions, zero open gates, and mobile source view.

## Disclosure

- [`build-week-delta.md`](build-week-delta.md) separates pre-existing work from the event delta.
- [`attribution.md`](attribution.md) records the verified inspiration source and non-affiliation boundary.
- Optional live GPT latency, token usage, cost, and accuracy are not inferred from the replay report.
