# Halba v1 pre-Trust-Operations baseline

- Captured: 2026-07-18T01:00:07.000Z
- Commit: `d4a6417c1a562490787e5482191210043e32d71c`
- Tree: `4500c92e87ab5630d563344c10bb6c9c4b176372`
- Reconstruction: `git archive HEAD` into an isolated temporary directory
- Runtime: Node `v22.23.0`; package minimum `>=20`
- Working-tree v2 changes included: no

## Reconstructed result

| Command | Result | Scope |
| --- | --- | --- |
| `npm run check` | PASS | Legacy source, proof, workspace, Pages, public-manifest, and privacy checks |
| `npm run smoke` | PASS | Sample server and Proof Mode HTTP loop |
| `npm run eval` | PASS | 9 proof cases and 10 workspace-boundary cases |

The committed proof corpus recorded 100% verdict accuracy, 100% grounding precision and recall, and a 0% false-positive rate. The workspace corpus recorded 100% outcome accuracy, 0% unsafe acceptance, and 0% false rejection.

## Frozen capability boundary

This v1 tree had the local Proof Mode and browser workspace, but did not have durable SQLite state, the shared incremental adapter protocol, evidence-policy v2, explicit lineage, the cross-workspace Trust Inbox, changed-since checkpoints, the hash-linked ledger, portable trust packs, bounded 2,000-run browser proof, or a human Trust Inbox comprehension measurement.

This artifact freezes the actual before-state. The newer `trust-operations-baseline` artifact is a v2 synthetic regression corpus and must not be used as a substitute for the pre-v2 baseline.
