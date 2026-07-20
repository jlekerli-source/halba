# Run import protocol

Halba imports external work through one bounded `inspect -> preview -> commit` protocol. The source-specific inspector extracts only structured operational evidence. The shared planner computes the exact state transition. The SQLite store commits the workspace projection, immutable evidence, retained receipt, and append-only event atomically.

## Preview first

Add `--dry-run` to any import command:

```bash
npm run import:run -- \
  --adapter codex \
  --manifest path/to/codex-routing.json \
  --source path/to/rollout.jsonl \
  --dry-run \
  --state .halba/halba.sqlite
```

Preview emits `halba.import.preview` JSON containing:

- the adapter and exact target workspace, channel, agent, and run;
- base and expected workspace SHA-256 digests;
- add, update, reuse, proof, count, review-gate, and reopened-decision deltas;
- accepted or degraded source quality with bounded warnings;
- an explicit privacy list of stored and excluded data;
- the proposed full-digest receipt identity;
- a SHA-256 `planDigest` over the complete canonical preview.

Preview is zero-write. Existing state is opened read-only; missing state uses an in-memory store. It does not create `.halba`, SQLite, WAL/SHM files, receipts, proof objects, or output files.

Commit by removing `--dry-run`. To require the commit-time plan to match an inspected plan, add:

```bash
--expect-plan-digest <64-character-plan-digest>
```

The CLI reinspects every input before commit. SQLite checks the previewed workspace digest again inside `BEGIN IMMEDIATE`. A changed source, artifact, proof packet, routing manifest, or base workspace aborts before any durable write. Degraded metadata requires `--allow-degraded`.

## Bounded adapters

### Codex session

```bash
npm run import:run -- \
  --adapter codex \
  --manifest path/to/codex-routing.json \
  --source path/to/rollout.jsonl \
  --state .halba/halba.sqlite
```

`codex-session-v1` reads a regular non-symlink JSONL descriptor up to 64 MB and 200,000 records. It retains the validated session id, source basename and digest, first/last timestamps, aggregate record/type/tool counts, completion boundary, and safe typed events. Message bodies, reasoning, commands, arguments, output, environment values, absolute paths, and raw transcripts are excluded. Incomplete or malformed input is degraded operational evidence. It cannot carry a proof attachment.

Optional `--bundle` and `--proof-output` must be provided together. The proof output must say `execution.mode` is `recorded` or `imported` and `execution.store` is `false`. A clean completed source is required; proof title, agent, time boundary, declared paths, source hashes, and deterministic adjudication are validated before planning.

### CI receipt

```bash
npm run import:run -- \
  --adapter ci \
  --source path/to/ci-receipt.json \
  --state .halba/halba.sqlite
```

`ci-manifest-v1` is standalone: its exact schema contains bounded workspace/channel/agent routing, source provider/workflow/external run/revision/commit identity, run labels/timestamps, and 1-64 structured checks. Check ids are unique and sorted. Status, completion, readiness, warnings, and typed events are derived from the checks. Unknown fields reject, so logs, commands, URLs, environment values, and arbitrary bodies cannot leak through the receipt.

### Release packet

```bash
npm run import:run -- \
  --adapter release \
  --manifest path/to/release-routing.json \
  --source path/to/release-manifest.json \
  --root path/to/release-root \
  --state .halba/halba.sqlite
```

`release-manifest-v1` accepts one release identity, up to 32 explicitly declared artifacts, and up to 64 structured checks. It performs no discovery and accepts no glob. Every artifact path must be a normalized relative path contained within `--root`; traversal, symlinks, special files, duplicates, size drift, and SHA-256 drift reject. Artifact bytes are hashed but never returned or stored by this adapter. The allowlist is re-hashed immediately before commit.

### Compatibility manifest

`--adapter manifest --manifest path/to/run.json` accepts operator-authored canonical routing and run metadata through `run-manifest-v1`. It remains useful for migration and local fixtures, but it is not independent CI or release evidence and cannot create Proof Mode authority.

### Evidence-policy v2 packet

A routing manifest may carry one bounded root-level `evidencePolicy` packet with `schemaVersion: 2`, an explicit policy, and bindings for the manifest run. The packet is validated before source inspection, included in the preview digest, merged with durable policy state, and validated again against the combined workspace graph before commit.

Existing binding ids are immutable. Reusing an id with changed criticality, guards, dependencies, claim identity, or any other policy field rejects. A changed observation must append a new binding id and explicitly name the prior binding in `supersedes`; both observations remain in durable history. This prevents a later import from rewriting lineage in place.

The focused end-to-end gate is:

```bash
npm run check:evidence-policy-v2
```

It also proves that a changed proof reopens an evidence-scoped decision through preview and commit, and that the receipt records the reopened count.

## Idempotency, ordering, and privacy

Receipt ids contain the full canonical packet digest. An exact retry returns an `idempotent` receipt and performs zero state, receipt, proof, or event writes. An old packet replay cannot regress a newer run. Older run timestamps reject; the same timestamp with different normalized content is a revision conflict.

Only source basenames enter state. Absolute input paths are never included in previews, receipts, or SQLite. CI check and release artifact arrays are canonicalized by identity, so harmless JSON formatting or input ordering does not change semantic packet identity. Raw artifact bytes, Codex bodies, CI logs, undeclared release files, and secret-bearing environment data remain outside Halba state and public artifacts.

Run the focused gates with:

```bash
npm run check:run-importers
npm run check:ci-manifest
npm run check:release-manifest
npm run check:adapter-conformance
```
