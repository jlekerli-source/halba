# Importer Template

Use this when a second local source is ready. Do not add a real importer until there is a real source folder to map.

Start from:

- `docs/feed-contract.md` for required fields and controlled values.
- `data/sample-feed.json` for a compact valid feed.
- `scripts/check-sample-feed.mjs` for the smallest validation loop.

## Mapping Checklist

1. Pick stable project ids.
2. Map each project to `id`, `name`, `lane`, `health`, `claim`, `lastProofDate`, `proofWindowDays`, and a safe source path.
3. Map each proof item to a post with `id`, `projectId`, `title`, `author`, `createdAt`, `body`, `evidence`, and `replies`.
4. Give every post at least one evidence record with `kind`, `label`, `path`, and `status`.
5. Add replies only when the source has real follow-up context; keep `replies` as an empty array otherwise.
6. Add `focus` records for contradictions or stop-work notes that should be reviewed.
7. Add `qa` records for importer uncertainty; use `red` only for blockers that should fail health checks.
8. Run the feed through `assertFeedContract()` with source-specific required project ids.

## Guardrails

- Source paths must be relative to the local source root.
- Do not store full source files in the feed; store source paths and short proof text.
- Do not add a config system before two real importers need one.
- Do not add hosted sync, accounts, realtime behavior, command execution, or dependencies for an importer.
