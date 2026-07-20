# Local state operations

Halba uses a local SQLite state file for durable workspaces, canonical run projections, immutable proof revisions, content-addressed proof-source objects, adjudicated proof results, import history, evidence-scoped review history, and a hash-linked trust ledger. Store schema v3 migrates schema-v1 and schema-v2 files in place. The workspace and review wire contracts remain backward compatible. The default path is `.halba/halba.sqlite`; override it with `HALBA_STATE_FILE`.

Requirements: Node.js 22.5 or newer. Halba uses the built-in `node:sqlite` module and adds no package dependency.

## Initialize and inspect

The first initializer imports the public-safe demonstration packet. It does not scrape Codex transcripts or private directories.

```bash
npm run state -- init
npm run state -- status
HALBA_STATE_FILE=.halba/halba.sqlite npm start
```

`HALBA_STATE_FILE` is an explicit runtime switch. When present, the Node server serves the newest stored workspace by default, selects proof and sources by bundle id, and reads and writes review decisions through the local database. When absent, the server serves the public-safe demonstration packet and does not open SQLite.

The server binds to `127.0.0.1` by default. A non-loopback `HALBA_HOST` is rejected unless `HALBA_ALLOW_REMOTE=1` is also set. Browser origins for state-changing requests must be listed in `HALBA_ALLOWED_ORIGINS`; cross-site requests are rejected. Remote access does not add authentication, TLS, multi-user isolation, or authenticated read endpoints. Trust Inbox is a loopback-only operator surface for this phase; do not expose it remotely without an operator-controlled authenticated boundary.

The durable browser workflow can be exercised with `npm run smoke:state`. That smoke seeds multiple workspaces and independent run sources, checks bundle isolation and exact source hashes, writes a review decision, terminates the server abruptly, restarts it, and proves SQLite recovery preserves the decision under the same evidence scope.

`GET /api/trust-operations` evaluates all stored workspaces together. Workspaces carrying validated evidence-policy v2 metadata contribute explicit claim lineage, deterministic guard policy, criticality, dependencies, freshness, and decision-expiry state. Legacy workspaces remain valid and contribute only deterministic run and import-health signals; Halba does not invent claim relationships for them. The response returns a bounded priority page (`limit` defaults to 50 and is capped at 100) with `totalItems` and `truncated`; optional `workspaceId`, `reason`, and `criticality` filters are applied after one deterministic evaluation. This is intentionally a top-N read model, not a cursor claim over mutable state.

## Weekly evidence review

Export the newest stored workspace as Markdown, or select a workspace and deterministic evaluation time explicitly:

```bash
npm run review:weekly -- --state .halba/halba.sqlite --output reviews/weekly.md
npm run review:weekly -- --state .halba/halba.sqlite --workspace operator-lab --at 2026-07-18T12:00:00.000Z --format json
```

The report includes run outcomes, failed and running counts, open evidence-scoped gates, stale and superseded claim history, decisions made in the window, and bounded import receipt digests. It does not copy source bytes or raw agent transcripts. Durable browser mode exposes the same report through **Export weekly review**.

The database enables foreign keys, full synchronous writes, a five-second busy timeout, and WAL mode. Its directory is mode `0700`; the database, backup, and restored files are mode `0600`. Imports validate the canonical workspace before opening a transaction. Rejected input cannot leave partial runs or receipts.

Each successful import records an append-only workspace event while retaining only the configured receipt projection for the UI. The `runs` table is a current-state projection and is reconciled exactly to the canonical workspace document, so a removed run cannot survive as hidden query state. Receipt identifiers and proof-bundle identifiers are immutable: retrying identical input is idempotent, while reusing an identifier for changed input fails closed.

Review decisions keep two representations: an append-only transition history and the latest evidence-scoped projection used by the UI. Updating or deleting the current decision never erases the earlier operator action. A timestamp cannot move backward or represent two different states.

Every successful import, decision update, and decision deletion also appends one canonical payload to the local trust ledger in the same SQLite transaction. Each row hashes its sequence, workspace, event identity, payload digest, prior ledger hash, and timestamp. Health verification recomputes the complete chain and fails closed on changed payloads, reordering, missing links, or altered hashes. This is local integrity evidence, not a digital signature: it can reveal accidental or partial tampering but does not prove who created the database or defend against an attacker who can rewrite the entire chain.

## Backup

Choose an explicit destination outside the active database path:

```bash
npm run state -- backup backups/halba-$(date +%Y%m%d).sqlite
```

The command uses SQLite's online backup API, so the result is a consistent database even when the active file uses WAL. New proof imports verify every declared source path, size, and SHA-256 digest before storing its bytes as a deduplicated content-addressed object. Those objects are part of the SQLite backup, allowing exact-source review after restore into a different directory even when the original source root is gone.

## Portable trust packs

Export one workspace with its complete local ledger witness, import and decision histories, proof records, and exact content-addressed proof bytes:

```bash
npm run trust:pack -- export \
  --state .halba/halba.sqlite \
  --workspace operator-lab \
  --output exports/operator-lab.trust-pack.json

npm run trust:pack -- verify \
  --input exports/operator-lab.trust-pack.json
```

Export refuses to replace an existing file unless `--overwrite` is explicit, writes mode `0600`, validates the complete local ledger before reading evidence, builds the pack in memory, verifies it independently, and then renames it into place. Verification needs no SQLite database. It checks strict schema and bounds, canonical section and full-pack digests, the complete hash-linked ledger, history-to-ledger coverage, proof declarations, and every decoded source byte count and SHA-256 hash.

Trust packs are deliberately labeled `unsigned-local` and `integrity-only-no-identity-authenticity`. They demonstrate internal consistency and portability, not who authored the events. Because the current pack includes the complete global ledger payloads needed to verify a contiguous chain, an export can contain metadata and decision notes from other local workspaces. Treat it as private operator data and inspect its scope before sharing.

## Restore

Restore refuses to overwrite an existing state file by default:

```bash
HALBA_STATE_FILE=.halba/restored.sqlite npm run state -- restore backups/halba-20260717.sqlite
```

Replacing an existing target requires the explicit `--overwrite` flag. Stop the Halba server before replacing its active database.

```bash
npm run state -- restore backups/halba-20260717.sqlite --overwrite
```

After copying the backup, Halba opens it, applies any pending migrations, verifies the schema, and closes it before reporting success.

## Retention and privacy

Import receipt projections are capped per workspace; the current default is 50 and the supported range is 1–1000. Append-only import events remain available for audit. Each proof source is capped at 4 MiB and one imported proof packet at 64 MiB. Legacy schema-v1 records whose external roots are no longer available remain readable as metadata but are reported as non-portable until the evidence is imported again.

The state directory is ignored by Git and excluded from public packages. A state backup or trust pack can contain private source bytes, source references, import metadata, and review notes; treat it as private operator data.
