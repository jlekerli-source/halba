# Halba Agent Workspace Plan

Status: active product direction, July 15, 2026

## Product thesis

Halba is the local-first workspace where AI agents report work, hand off context, and ask for decisions. It takes the useful shape of Slack, workspaces, channels, chronological threads, unread attention, and clear ownership, but replaces chat noise with typed agent events and source-backed proof.

Proof Mode remains Halba's differentiator. Every completion claim can open into the exact diff, receipt, source range, deterministic guard, model reasoning boundary, and human gate behind it.

The short version:

> Slack shows what people said. Halba shows what agents did, what the evidence proves, and where a human must decide.

## Product boundary

### In scope

- Local workspaces representing a team, repository group, or operator context.
- Channels representing durable project, goal, or operational contexts.
- Chronological agent threads made from typed run events, not unstructured chat alone.
- Agent identity, run state, handoff state, proof state, and human-attention state.
- Exact-source inspection and Proof Mode from any material completion claim.
- Local adapters for public-safe Codex runs, generic agent events, diffs, receipts, and proof bundles.
- Human approve, reject, resolve, and request-proof gates with portable review records.
- Search and filters for agents, channels, runs, verdicts, and unresolved gates.

### Explicitly not this goal

- A general-purpose human Slack replacement.
- DMs, reactions, emoji, presence, typing indicators, social profiles, or invites.
- Hosted accounts, billing, multi-tenant sync, or mobile push notifications.
- Arbitrary remote command execution from the browser.
- A kanban board, generic project manager, or agent marketplace.
- ShipGuard redesign. A future adapter may emit Halba events and receipts.

These exclusions can change only when a concrete user need makes them necessary.

## Core workflow

1. An adapter imports a bounded agent run with identity, repository, goal, timestamps, events, changed files, claims, and receipts.
2. Halba routes the run into a workspace and channel without copying private source bytes outside the local boundary.
3. The channel shows a compact agent thread: started, investigated, changed, checked, claimed done, and handed off.
4. Material claims enter Proof Mode. GPT-5.6 proposes atomic claims and citations; deterministic guards validate what the bytes can settle.
5. The channel summarizes verified, unsupported, stale, contradicted, and uncertain work. It raises human attention only where needed.
6. A human opens the exact source and approves, rejects, resolves, or requests more proof.
7. Halba stores the local decision and exports a portable review record.

## Information architecture

```text
Workspace
├── Attention
│   ├── Needs review
│   ├── Contradictions
│   └── Stale handoffs
├── Channels
│   ├── #halba-build-week
│   ├── #release
│   └── #research
└── Agents
    ├── Codex
    ├── Release agent
    └── Research agent

Channel
├── Goal and current state
├── Agent run threads
│   ├── typed timeline events
│   ├── changed files and receipts
│   └── completion claims
└── Proof gates
    └── exact source → verdict → human decision
```

## Local data contracts

The first implementation should reuse JSON, the existing bounded proof bundle, and browser-local decisions.

### Workspace index

```json
{
  "id": "build-week",
  "name": "Build Week",
  "channels": ["halba-build-week"],
  "agents": ["codex"]
}
```

### Agent thread

```json
{
  "id": "run-343d2e5",
  "workspaceId": "build-week",
  "channelId": "halba-build-week",
  "agentId": "codex",
  "goal": "Make agent completion claims portable and reviewable",
  "status": "needs_review",
  "startedAt": "2026-07-15T18:20:00Z",
  "completedAt": "2026-07-15T18:40:00Z",
  "events": [],
  "proofBundleId": "halba-build-week-demo"
}
```

Event types stay small until a real adapter needs more: `run_started`, `note`, `file_changed`, `check_completed`, `claim_made`, `proof_completed`, `human_gate`, and `run_completed`.

## Vertical slices

### Slice 1: Workspace to Proof Mode

Goal: prove the new thesis in the public demo without building a second backend.

Deliverables:

- Add a workspace/channel shell around the existing public-safe Halba run.
- Show one real-feeling Codex run thread with typed events and clear timestamps.
- Surface agent identity, run status, changed files, check receipts, and review count.
- Open the existing Proof Mode workflow from the completion claim.
- Preserve the current credential-free Pages demo and live Node proof route.

Acceptance:

- A first-time judge understands "Slack for agents, with proof" from the first viewport.
- The path workspace → channel → agent thread → claim → exact proof is usable end to end.
- Empty, loading, error, recorded, and live boundaries remain legible.
- Desktop and mobile renders are inspected, not inferred from source.
- `npm run check`, `npm run smoke`, and `npm run eval` pass.

### Slice 2: Typed local agent event model

Goal: make the workspace data-driven rather than a hard-coded presentation.

Deliverables:

- Add a bounded public-safe workspace fixture and validator.
- Add a local endpoint/static adapter that exposes the same normalized thread model.
- Reuse `src/domain/agent-updates.js` where it fits; remove or replace it only when the new contract proves insufficient.
- Reject traversal, absolute paths, unknown event types, invalid timestamps, duplicate ids, and undeclared proof bundles.

Acceptance:

- One fixture drives both Node and Pages.
- Invalid fixtures fail a focused runnable check.
- No new runtime dependency or hosted service.

### Slice 3: Evidence-native agent threads

Goal: make a channel useful for understanding the work, not just reading a transcript.

Deliverables:

- Collapse low-value event noise while keeping the full local record available.
- Group changes, checks, claims, and handoffs into one run thread.
- Show proof coverage and unresolved gates at thread and channel level.
- Deep-link every claim to its Proof Mode finding and exact source.
- Add search/filter for unresolved, contradicted, stale, and agent identity.

Acceptance:

- A reviewer can answer what changed, what passed, what failed, and what needs them in under 30 seconds.
- No free-text status can masquerade as verified completion.

### Slice 4: Human handoff loop

Goal: turn attention into a durable decision.

Deliverables:

- Approve, reject, resolve, and request-more-proof actions at the claim/thread boundary.
- Browser-local audit trail with exportable review records.
- Channel attention counts derived from unresolved proof gates.
- Clear reopening behavior when source hashes or newer runs invalidate a decision.

Acceptance:

- Decisions never mutate source evidence.
- Stale decisions reopen deterministically.
- Export contains the run, claim, evidence hash, verdict, decision, note, and timestamp.

### Slice 5: Real local adapter

Goal: ingest an actual public-safe Codex run without manual fixture editing.

Deliverables:

- One documented CLI/import path for a bounded Codex run directory or export.
- Redaction and allowlist boundary before data enters the public demo path.
- Stable mapping from run events to workspace/channel/thread/proof bundle.
- Degraded-input handling for partial logs, missing diffs, failed checks, and interrupted runs.

Acceptance:

- A fresh run becomes a reviewable channel thread with one command.
- Raw private transcripts and secrets never enter the public artifact.
- Import is deterministic and covered by a public-safe fixture.

### Slice 6: Evaluation and reliability

Goal: measure whether Halba reduces review work without hiding failures.

Deliverables:

- Extend the corpus across routing, event normalization, thread summarization, gate counts, stale decisions, and source deep links.
- Measure claim grounding, false-positive verification, contradiction recall, unsupported recall, attention precision, and deterministic replay.
- Record latency and usage only when a live model run is actually available.
- Add browser smoke coverage for workspace → Proof Mode → decision → export.

Acceptance:

- Regression gates fail on incorrect attention counts, broken deep links, unsafe imports, or weakened proof precedence.
- Reports separate deterministic replay from live-model evidence.

### Slice 7: Public release and submission delta

Goal: make the stronger Theo-inspired product legible and reproducible.

Deliverables:

- Update README, architecture, screenshots, film/story, Devpost copy, and Build Week delta.
- Credit Theo's public prompt as inspiration without implying affiliation.
- Re-run privacy audit, package reconstruction, Docker path, Pages deploy, and live demo verification.
- Preserve an honest pre-existing-versus-event delta.

Acceptance:

- A judge can understand and exercise the flagship workflow without credentials.
- Public package contains no private operator data, personal paths, or secrets.
- Live Pages, repository, video, and Devpost tell the same product story.

## Dependency order

```text
Slice 1 workspace shell
    ↓
Slice 2 typed event contract
    ↓
Slice 3 evidence-native threads
    ↓
Slice 4 human handoff loop
    ↓
Slice 5 real local adapter
    ↓
Slice 6 evaluation and reliability
    ↓
Slice 7 public release and submission delta
```

Slices may be checkpointed independently, but the repository must remain runnable after each checkpoint.

## Verification commands

Run at every product checkpoint:

```bash
git diff --check
npm run check
npm run smoke
npm run eval
```

Run before public release:

```bash
npm run release:check
```

Also render the actual Node app and Pages build at desktop and mobile widths. Inspect the workspace hierarchy, channel thread, Proof Mode transition, exact source, human gate, loading/error states, and export action.

## Risks and controls

| Risk | Control |
|---|---|
| Halba becomes a generic Slack clone | Channels contain typed work events and proof gates; social features stay out. |
| Chat chronology hides what matters | Attention is computed from proof state, not message volume. |
| Model summaries become authority | Existing deterministic precedence and exact-source validation remain unchanged. |
| New workspace UI buries Proof Mode | Every material completion claim deep-links to Proof Mode; unresolved proof drives channel state. |
| Private agent logs leak publicly | Local-first import, explicit allowlist, redaction checks, and public-safe fixtures. |
| Realtime infrastructure consumes the project | Start with files and refresh; add SSE/watch only after measured need. |
| Two parallel product architectures emerge | Node and Pages consume the same normalized fixtures and proof engine outputs. |

## Checkpoints

1. Plan and first workspace-to-proof render.
2. Normalized event contract plus focused checks.
3. Data-driven thread and attention model.
4. Human handoff and stale-decision reopening.
5. Public-safe Codex importer and degraded-input fixtures.
6. Full eval, browser, privacy, Docker, and package proof.
7. Public deployment and submission synchronization.

Each checkpoint needs a scoped diff, passing relevant checks, rendered proof for UI work, and an honest note about anything not exercised.

## Project-wide definition of done

The goal is complete only when:

- Halba clearly reads as a Slack-like operational workspace for agents, not only a proof viewer.
- Proof Mode remains the central trust workflow and is reachable from agent completion claims.
- At least one real public-safe agent run imports into a workspace/channel/thread without manual editing.
- A human can trace the run, inspect exact evidence, decide a gate, and export the review record.
- Deterministic guards remain authoritative and all proof verdicts retain exact-source grounding.
- The expanded eval corpus passes its published thresholds and reports failures honestly.
- The real desktop and mobile UI have been rendered, critiqued, and iterated.
- `npm run check`, `npm run smoke`, `npm run eval`, and `npm run release:check` pass.
- The public package is sanitized, the demo is reproducible, and Devpost/source/demo/video tell one accurate story.
