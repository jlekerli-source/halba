# Public package manifest

This allowlist defines the only files eligible for a public Halba release candidate. It does not publish or copy anything by itself.

## Include

- `.gitignore`
- `.dockerignore`
- `.env.example`
- `Dockerfile`
- `package.json`
- `pnpm-lock.yaml`
- `README.md`
- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `public/`
- `src/server.js`
- `src/domain/`
- `src/proof/`
- `scripts/audit-public.mjs`
- `scripts/check-feed-sort.mjs`
- `scripts/check-openai-adapter.mjs`
- `scripts/check-public-manifest.mjs`
- `scripts/check-proof-bundle.mjs`
- `scripts/check-proof-engine.mjs`
- `scripts/check-review-export.mjs`
- `scripts/check-sample-feed.mjs`
- `scripts/check-source-preview-copy.mjs`
- `scripts/check-stale.mjs`
- `scripts/check-view-state.mjs`
- `scripts/check.mjs`
- `scripts/feed-validation.mjs`
- `scripts/eval.mjs`
- `scripts/public-manifest.mjs`
- `scripts/public-package-dry-run.mjs`
- `scripts/release-check.mjs`
- `scripts/smoke-sample.mjs`
- `scripts/smoke-proof.mjs`
- `data/sample-feed.json`
- `data/sample-source/`
- `data/demo/`
- `evals/`
- `artifacts/evals/`
- `artifacts/screenshots/`
- `docs/build-week/plan.md`
- `docs/architecture.md`
- `docs/deployment.md`
- `docs/feed-contract.md`
- `docs/evals.md`
- `docs/importer-template.md`
- `docs/openai.md`
- `docs/privacy.md`
- `docs/proof-bundle.md`
- `docs/public-package-manifest.md`
- `submission/`

## Exclude

- `AGENTS.md`
- `codex/`
- `data/seed.json`
- `data/import-runs.json`
- `data/agent-updates.json`
- `output/`
- `.playwright-cli/`
- `docs/architecture/`
- `docs/goals/`
- `docs/superpowers/`
- `docs/roadmap.md`
- `src/importers/le-brain.js`
- `scripts/import-le-brain.mjs`
- `scripts/check-importer.mjs`
- `scripts/smoke.mjs`

## Review Before Including

- No entries. Add a path here only when it is intentionally blocked pending a privacy or licensing decision.
