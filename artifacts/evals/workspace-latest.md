# Halba agent-workspace boundary eval

Corpus: halba-agent-workspace-boundaries-v1

- Cases: 10/10 passed
- Scope: deterministic workspace validation; this report does not represent a live model call.

## Metrics

| Metric | Result |
| --- | ---: |
| outcomeAccuracy | 100.0% |
| unsafeAcceptanceRate | 0.0% |
| falseRejectionRate | 0.0% |

## Cases

| Result | Case | Purpose |
| --- | --- | --- |
| PASS | valid-public-codex-run | Accept the checked-in public-safe Codex workspace fixture. |
| PASS | unknown-channel | Reject a thread routed to a channel outside the workspace. |
| PASS | unknown-agent | Reject a thread attributed to an agent outside the workspace. |
| PASS | unknown-event-type | Reject chat-like or otherwise untyped agent activity. |
| PASS | duplicate-event-id | Reject ambiguous evidence timelines with duplicate event identifiers. |
| PASS | event-outside-thread | Reject events whose timestamps fall outside the bounded run. |
| PASS | wrong-proof-bundle | Reject a run that points at a different proof bundle than the loaded evidence. |
| PASS | review-gate-mismatch | Reject attention counts that do not match their concrete review claims. |
| PASS | unsafe-id | Reject identifiers that are unsafe to route through URLs or DOM selectors. |
| PASS | inverted-time-boundary | Reject runs that claim to complete before they started. |
