# Halba contracts

Status: canonical product contract, July 18, 2026

Halba is a local-first evidence control plane for AI-agent work. The workspace is an index over bounded agent runs; Proof Mode is the authority path for material completion claims; human decisions close review gates without changing source truth.

This document outranks the historical private proof-feed roadmap. The current implementation plan is [`agent-workspace-plan.md`](agent-workspace-plan.md); the runtime boundary is [`architecture.md`](architecture.md).

## Workspace and run

The canonical browser-safe validator is `public/shared/workspace-contract.js`. Node loaders and browser imports both use that exact implementation.

A workspace contains:

- one stable workspace identity;
- bounded channels used to organize operational contexts;
- explicit agent identities;
- typed run threads with timestamps, status, proof state, claim counts, review gates, and events.

The canonical validator caps workspaces at 64 channels, 128 agents, 2,000 threads, and 256 events per thread, with explicit text and evidence-identity limits. Oversized state fails before a database transaction.

Allowed events are `run_started`, `note`, `file_changed`, `check_completed`, `claim_made`, `proof_completed`, `human_gate`, and `run_completed`. Free text can describe work but cannot create a verified verdict.

Every proof-ready thread names one `proofBundleId`. A thread may include `reviewEvidence`, mapping each review claim id to the evidence identity used when a human made a decision. Older schema-v1 imports without this optional map remain navigable, but their gates cannot be treated as durably closed from workspace metadata alone.

## Proof bundle and source identity

A proof bundle is bounded to one run. It declares its sources, claims, receipts, generated time, and limits. The loader resolves only declared relative paths, rejects traversal and symlinks, and records SHA-256 hashes plus exact line maps. Durable bundle records retain the deterministic adjudication result alongside bundle metadata so a `proof-ready` run can be reconstructed without borrowing the current demo result.

Proof APIs must select sources through the active bundle. A workspace reference never authorizes access to a different bundle, even when paths or claim ids happen to match.

GPT output is untrusted inference. Deterministic source, quote, receipt, freshness, JSON-field, and contradiction guards remain authoritative.

## Human review decision

The canonical browser-safe contract is `public/shared/review-contract.js`.

A decision is scoped by all of:

- workspace id;
- thread id;
- proof bundle id;
- claim id;
- evidence identity derived from the claim text, final verdict, exact ranges, and source hashes.

`approved`, `rejected`, and `resolved` close a gate. `more-proof` records a response but keeps the gate open. A different workspace, thread, bundle, claim, verdict, range, path, or source hash makes the stored decision inapplicable and reopens the gate. Legacy claim-id-only browser decisions are intentionally not migrated as authoritative decisions.

Browser storage remains the static Pages adapter. The Node durable store and decision endpoints persist the same scope and invalidation rules across process restarts, backup, restore, bounded receipt retention, and schema migrations. The browser hydrates those decisions when durable state is enabled and refuses to apply them when the current run's evidence identity differs.

The durable store preserves every decision transition as an append-only event and maintains a separate latest-state projection for current UI reads. Updating or deleting that projection cannot erase the historical action. Decision timestamps are monotonic per evidence scope, and one timestamp cannot name two different states.

Every successful import, decision update, and decision deletion appends one canonical event to a global local trust ledger in the same transaction. Each row hashes its full sequence and event identity, the canonical payload digest, prior row hash, and recorded time. Recomputed chain failure makes local health fail closed. The chain is explicitly unsigned local integrity evidence: it detects partial mutation but does not authenticate an operator or claim resistance to a complete malicious rewrite.

## Claim history and staleness

History identity is the agent id, channel id, and claim id together. A newer proof packet with that identity supersedes the older observation. The latest supported observation needs fresh proof when it is older than the configured history window or when a newer run from the same agent in the same channel advances beyond it without replacement proof. An adjudication already marked `stale` remains stale. The exact age boundary is current; staleness begins only after it.

History analysis never rewrites the stored adjudication. It adds an attention state with the reason, replacement bundle when known, and newer run boundary when known. This preserves the evidence record while preventing an old `supported` label from being presented as current operational truth.

## Trust policy and explicit lineage

The optional workspace `trust` packet uses evidence-policy schema v2 while the surrounding workspace remains schema v1. Older workspaces without this packet remain valid and navigable, but Halba does not infer stable claim identity, dependencies, criticality, or decision policy for them.

Each binding declares a stable claim key, an exact thread/claim observation, class, criticality, required deterministic guards, downstream dependencies, and explicit prior binding ids that it supersedes. Binding ids are immutable across imports: a changed observation must append a new id and explicitly supersede its predecessor, preserving both records. A second observation for the same stable key must name an older observation. Unknown claim ids, implicit lineage, dependency cycles, self-dependencies, oversized graphs, and unsafe identifiers fail at the shared Node/browser validator.

Policy declares bounded freshness and decision-expiry windows plus the criticalities that require a human decision. The Trust Operations evaluator uses only the validated policy, final adjudicated verdict, deterministic guard results, evidence identity, stored human decision, typed run state, and import receipt state. Model assessment text and free-form run content contribute no authority.

Every attention item exposes its deterministic reasons, a structured local navigation target, and the exact declared-criticality and reason components that form its priority score. The evaluator can inherit an unexpired decision only across explicitly linked observations with an identical evidence identity. Changed evidence, expired decisions, ambiguous lineage, failed required guards, and affected dependencies reopen attention without rewriting old proof or decisions. A human acknowledgement can close direct operator attention but cannot erase deterministic upstream health from dependency propagation. Failed bound runs retain an explicit failure reason, and every duplicate guard matching a required type must pass. Policy evaluation never writes or closes a human gate.

## Import boundary

An importer translates an external run into the canonical workspace, proof-bundle, source, and receipt contracts. Importers must:

- use explicit local configuration and bounded roots;
- normalize deterministically;
- keep raw private transcripts and secrets outside public artifacts;
- represent partial, interrupted, missing-diff, and failed-check states honestly;
- never infer verified completion from free text alone.

Every bounded adapter follows one `inspect -> preview -> commit` protocol. Inspection is state-free. Preview opens existing SQLite state read-only, or uses memory when no state exists, and emits a deterministic JSON plan with entity/count deltas, proof and review-gate effects, privacy exclusions, quality warnings, a base-state digest, and a full SHA-256 plan digest. Preview never creates a database, state directory, WAL, receipt, proof object, or output file. Commit revalidates mutable source inputs, checks the base-state digest again inside `BEGIN IMMEDIATE`, and writes the workspace projection, receipt projection, immutable proof data, and append-only import event as one transaction. Degraded input requires explicit `--allow-degraded` acknowledgement.

The bounded registry contains `codex-session-v1`, `ci-manifest-v1`, and `release-manifest-v1`. Codex inspection hashes a real rollout JSONL descriptor while excluding transcript, reasoning, tool arguments, command text, command output, environment values, and absolute paths; malformed or incomplete source metadata can be imported as degraded operational evidence but cannot carry a proof attachment. CI inspection accepts an exact structured schema, derives run status from sorted check records, and rejects arbitrary logs, commands, URLs, bodies, or environment fields. Release inspection verifies only an explicit artifact allowlist beneath an operator-declared root, rejects traversal, symlinks, globs, duplicate identities, and undeclared fields, and re-hashes every declared artifact immediately before commit. `run-manifest-v1` remains a compatibility adapter for operator-authored routing metadata; it is not treated as independent CI or release evidence. The older `codex-proof` adapter remains only for reproducing the Build Week demonstration fixture.

The durable store treats receipt ids and proof-bundle ids as immutable identities. Receipt ids contain the full canonical packet digest. Identical retries are idempotent and perform zero projection or history writes; replaying an old receipt after a newer revision cannot regress current state. Older run timestamps and same-timestamp/different-content revisions are rejected. Current run rows are a projection of the canonical workspace document and must match it exactly after every transaction. Import events, immutable proof revisions, and content-addressed source objects preserve the historical evidence needed for audit and relocated restore.

An explicit operator export can package one canonical workspace, its import and decision histories, proof records, exact content-addressed proof bytes, and the complete ledger witness into a bounded portable trust pack. The pack verifies its section digests, source-byte hashes, ledger payloads and links, and whole-pack digest without opening Halba state. It carries an `unsigned-local-integrity` assurance label and never claims identity, authorship, or signature authenticity.

## Legacy proof-feed compatibility

The earlier feed, roadmap, import-delta, and source-preview endpoints are not part of the default v1 runtime. They are available only when the server starts with:

```bash
HALBA_ENABLE_LEGACY_FEED=1 npm start
```

This compatibility mode exists to preserve old local fixtures while their useful ingestion and delta concepts are migrated into the canonical run model. It must not become a second product architecture.

## Explicit exclusions

The v1 contract does not include DMs, reactions, presence, invites, hosted sync, billing, arbitrary agent command execution, or speculative realtime infrastructure.
