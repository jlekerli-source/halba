# Proof bundle contract

A Halba proof bundle is a local, bounded packet of agent claims and the source material needed to review them.

The public demo lives at `data/demo/bundle.json`.

## Bundle fields

- `schemaVersion`: currently `1`.
- `id`: stable bundle identifier.
- `title`: review title.
- `generatedAt`: run timestamp.
- `evaluationDate`: date used by deterministic freshness guards.
- `agent`: source agent label.
- `reportPath`: source containing the agent's completion claims.
- `sources`: allowlisted relative files with label and kind.
- `guards`: deterministic checks associated with extracted claim ids.

## Source boundary

All paths are relative to the directory containing `bundle.json`. The loader rejects absolute paths, URI-shaped paths, traversal segments, missing files, oversized files, duplicate paths, and sources that escape the bundle root.

Each loaded source receives:

- SHA-256 content hash;
- byte count;
- line count;
- stable line-addressable text.

## Model boundary

GPT-5.6 turns the report and source packet into structured candidate claims and citations. It does not decide final truth.

Halba validates every citation path, line range, and quoted excerpt. Deterministic guards can confirm support, identify a contradiction, mark old proof stale, or reject a claim with no evidence. A model/guard disagreement always remains a human-review item.

## Recorded responses

Recorded responses make the demo and evals reproducible without a credential. The UI and API must label them `recorded`; they are not proof that a live model request ran.
