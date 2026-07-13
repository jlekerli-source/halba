# Public package manifest

This allowlist defines the only files eligible for a public Halba release candidate. It does not publish or copy anything by itself.

## Include

- `.gitignore`
- `package.json`
- `pnpm-lock.yaml`
- `README.md`
- `LICENSE`
- `SECURITY.md`
- `public/`
- `src/server.js`
- `src/domain/`
- `scripts/audit-public.mjs`
- `scripts/check-feed-sort.mjs`
- `scripts/check-public-manifest.mjs`
- `scripts/check-review-export.mjs`
- `scripts/check-sample-feed.mjs`
- `scripts/check-source-preview-copy.mjs`
- `scripts/check-stale.mjs`
- `scripts/check-view-state.mjs`
- `scripts/check.mjs`
- `scripts/feed-validation.mjs`
- `scripts/public-manifest.mjs`
- `scripts/public-package-dry-run.mjs`
- `scripts/smoke-sample.mjs`
- `data/sample-feed.json`
- `data/sample-source/`
- `docs/build-week/plan.md`
- `docs/feed-contract.md`
- `docs/importer-template.md`
- `docs/public-package-manifest.md`

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
