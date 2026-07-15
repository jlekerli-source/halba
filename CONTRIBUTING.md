# Contributing to Halba

Halba accepts changes that make agent work easier to follow and harder to misrepresent. The useful contribution areas are local agent-run adapters, typed event normalization, proof adjudication, exact-source review, human gates, evals, and the workspace interface.

Halba deliberately does not aim to become a general human chat, project-management, or realtime-collaboration product. A channel is a durable context for agent work; proof state, not message volume, decides what needs attention.

## Where to contribute

- **Agent adapters:** map a public-safe local run format into Halba's bounded workspace and proof contracts. [`src/importers/codex-proof.js`](src/importers/codex-proof.js) is the smallest working example.
- **Proof guards:** add deterministic checks for facts that source bytes or machine receipts can settle better than a model.
- **Evals:** contribute compact fixtures for unsupported, stale, contradictory, uncertain, or degraded agent claims.
- **Interface:** improve workspace, thread, evidence, loading, empty, error, and mobile states without adding social noise.
- **Documentation:** make local setup, importer boundaries, and failure recovery easier to follow.

Start with [`docs/agent-workspace-plan.md`](docs/agent-workspace-plan.md), [`docs/architecture.md`](docs/architecture.md), and [`docs/proof-bundle.md`](docs/proof-bundle.md). Keep the change to one reviewable vertical slice.

## Before opening a change

1. Keep fixtures synthetic or unquestionably public-safe.
2. Add deterministic coverage for new proof behavior.
3. Add eval cases when a change affects claim verdicts or citations.
4. Reuse the dependency-free Node, browser, JSON, and local-file patterns before proposing infrastructure.
5. Run the focused checks while working, then the release gate:

```bash
npm run release:check
```

For visible changes, also inspect the rendered desktop and mobile application. A clean command result is not evidence that the interface works.

## Pull request evidence

Describe the user-visible outcome, files or contracts changed, commands run, and anything not exercised. UI changes should include current desktop and mobile screenshots. Adapter changes should include one synthetic or unquestionably public-safe fixture plus a focused failing/passing check.

## Data and security

Never commit credentials, private project files, personal absolute paths, or unredacted agent transcripts. Import adapters should be read-only and opt-in. Report security issues using the process in [`SECURITY.md`](SECURITY.md).
