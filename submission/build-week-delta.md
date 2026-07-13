# Build Week disclosure

## Before Build Week

Halba already existed as a local proof-feed MVP. It could load a JSON evidence feed, preview contained source files, sort proof updates, detect stale claims, and export a weekly review. It also contained local-only operator data and adapters and had no normal reachable Git history.

Before product changes, the full working tree and Git metadata were preserved in a timestamped, read-only local archive outside the repository. That private baseline is intentionally absent from the public artifact.

## Built during Build Week

- Proof Mode as the flagship end-to-end workflow.
- A portable proof-bundle format with bounded files, hashes, and line maps.
- GPT-5.6 Sol/max structured claim-and-citation inference.
- Deterministic quote, receipt, freshness, and citation guards.
- Supported, unsupported, stale, contradicted, and uncertain adjudication.
- Exact source inspection and persistent human approve/reject/resolve gates.
- A new responsive evidence-examiner interface and public screenshots.
- A regression eval corpus with report artifacts and release gates.
- A synthetic public demo bundle and recorded-response mode.
- Privacy audit, Apache-2.0 license, public documentation, container, and clean-package reconstruction.
- A proper fix and boundary tests for the date-sensitive stale-count regression.

## Honest limitations

- The checked-in structured-inference fixture is a recording and is labeled in the product; it is not evidence of a live API call.
- Live GPT execution requires the judge or operator to provide an API key; it is not represented as tested when no credential was available.
- Review decisions live in one browser profile; there is no hosted identity or team sync.
- The public release imports the documented bundle format. Additional adapters are future work.
