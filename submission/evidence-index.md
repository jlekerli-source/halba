# Submission evidence index

## Product proof

- `artifacts/screenshots/onboarding-desktop.png` — public bundle onboarding.
- `artifacts/screenshots/proof-desktop.png` — full three-pane Proof Mode result.
- `artifacts/screenshots/proof-mobile-source.png` — exact-source mobile view.
- `data/demo/` — synthetic public proof bundle and labeled recording.

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

## Disclosure

- [`build-week-delta.md`](build-week-delta.md) separates pre-existing work from the event delta.
- [`attribution.md`](attribution.md) records the verified inspiration source and non-affiliation boundary.
- Live GPT latency, token usage, cost, and accuracy are not claimed until a credentialed run is performed.
