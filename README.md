# Halba

Halba is a local-first evidence control plane for AI-assisted work.

It is built for a simple but expensive question: when an agent says work is complete, what evidence actually supports that claim?

Halba keeps source files, run receipts, diffs, tests, and human review gates connected. Its Build Week flagship workflow, **Proof Mode**, is being developed to extract claims with GPT-5.6, validate exact source references with deterministic guards, and show what is verified, unsupported, stale, contradictory, or still uncertain.

Halba is not a chatbot, kanban board, or team-chat clone.

## Public-safe quickstart

Requirements:

- Node.js 20 or newer.
- No package dependencies.

Run the checked-in public sample:

```bash
npm run check
npm start
```

Open [http://localhost:4177](http://localhost:4177).

`pnpm` can be used in place of `npm`.

The default runtime serves only:

- `data/sample-feed.json`
- source files under `data/sample-source/`

To serve another local feed, set explicit paths:

```bash
HALBA_FEED_FILE=/absolute/path/to/feed.json \
HALBA_SOURCE_ROOT=/absolute/path/to/source-root \
npm start
```

Source paths inside the feed must remain relative to the configured source root. Halba rejects absolute, URI-like, Windows-absolute, and traversal-shaped source references.

## Current verification

```bash
npm run check
npm run smoke
npm run audit:public
npm run package:dry-run
```

- `check` validates the public feed contract, date and stale logic, sorting, exports, source-preview receipts, view-state helpers, the public manifest, and the privacy allowlist.
- `smoke` starts the public sample server and verifies the feed, source previews, and path guards over HTTP.
- `audit:public` scans only public-manifest files for private paths, private-source markers, and credential-shaped content.
- `package:dry-run` enumerates public include and local-only exclude paths without copying or publishing anything.

## Architecture

Halba intentionally starts small:

- Node.js standard-library HTTP server.
- Static HTML, CSS, and browser JavaScript.
- Local JSON and source files.
- Read-only source preview with path containment.
- Deterministic proof guards ahead of model inference.
- Optional server-side OpenAI integration; credentials never enter browser code.

The active Build Week execution plan is in [`docs/build-week/plan.md`](docs/build-week/plan.md).

## Privacy model

- Public sample data is the default.
- Local operator data and adapters are ignored and excluded from the public manifest.
- OpenAI requests, when enabled, are server-side, bounded to the selected evidence packet, and configured with storage disabled.
- A recorded-response demo must be labeled as recorded; it is never evidence of a live API call.
- No remote, deployment, or publication is created by the repository scripts.

## Project boundary

In scope:

- evidence ingestion;
- claim and citation extraction;
- stale, contradictory, missing, and unsupported proof detection;
- exact source inspection;
- human approve, reject, and resolve gates;
- repeatable evals and review exports.

Out of scope:

- DMs, channels, presence, reactions, and realtime collaboration;
- hosted accounts and sync;
- generic task or roadmap management;
- agent command execution.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
