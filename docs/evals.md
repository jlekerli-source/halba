# Proof-quality evals

Halba evaluates the proof workflow as two separate systems:

1. GPT-5.6 structured inference proposes claims, citations, an assessment, confidence, and a reasoning boundary.
2. Deterministic guards validate paths, line ranges, exact quotes, receipts, structured fields, and proof freshness before producing the final verdict.

The split matters. A model can be useful without being allowed to silently verify itself.

The agent workspace has a separate boundary corpus. It verifies that local imports cannot smuggle unknown channels, agents, event types, duplicate or out-of-range events, unsafe ids, inconsistent review counts, inverted timestamps, or mismatched proof bundles into the interface.

The adapter conformance gate applies one adversarial protocol to Codex, CI, and release inputs. It repeats fixed inspections and previews 100 times, proves absent-state and existing-state preview are byte-level zero-write, proves exact retries are idempotent, rejects stale plan digests, duplicate identities, traversal, symlinks, and changed release artifacts, blocks proof on malformed Codex input, and scans preview, receipt, and SQLite bytes for private source sentinels. CI checks and release manifests also prove semantic identity is invariant to harmless JSON formatting and unordered check arrays.

Trust Operations has a third corpus. It evaluates explicit claim lineage and deterministic attention policy over three workspaces and 120 runs. Gold cases cover contradictions, unsupported and uncertain proof, expired decisions, missing required guards, evidence changed since trust, downstream dependency impact, degraded imports, failed runs, and freshness expiry. Model assessment text is deliberately unable to overrule a deterministic verdict.

Proof findings now declare `verdictAuthority`. Deterministic guards can produce authoritative final verdicts; an otherwise unguarded model assessment is preserved for inspection but becomes fail-closed `uncertain`, requires review, and cannot close a gate. Stored legacy findings without deterministic authority become a `non_authoritative_verdict` Trust Inbox reason.

The pre-v2 reference is a separate artifact, not the v2 corpus: `artifacts/evals/trust-operations-v1-baseline.json` pins commit `d4a6417c`, tree `4500c92e`, reconstructed check/smoke/eval results, legacy corpus metrics, and the absent v2 capabilities. It was produced from `git archive HEAD` in an isolated directory while the v2 worktree remained excluded.

## Public replay corpus

Run:

```bash
npm run eval
```

Write the current public report:

```bash
npm run eval:report
```

The versioned corpus covers:

- all five final verdict classes;
- supported and unsupported claims;
- explicit contradictions;
- stale proof and the exact freshness boundary;
- invalid quotes and unknown source paths;
- gold source-path and exact line-range grounding;
- model/guard disagreement;
- a failed command receipt;
- prompt-injection text inside an evidence file;
- malformed structured model output;
- deterministic replay stability.

The workspace corpus covers:

- a valid public-safe Codex workspace;
- unknown channel, agent, and event references;
- duplicate and out-of-thread event ids;
- wrong proof-bundle linkage and review-gate drift;
- unsafe identifiers and inverted time boundaries.

Regression thresholds are 100% for verdict accuracy, normal citation validity, gold-source grounding precision and recall, unsupported recall, contradiction recall, review-gate recall, and degraded-input behavior, with a 0% tolerated final-verdict false-positive rate on this compact golden corpus.

The workspace boundary gate requires 0% unsafe acceptance and 0% false rejection on its compact corpus. Browser-state regressions also prove that requesting more proof does not close or advance the active gate, while approve, reject, and resolve do.

The Trust Operations gate requires at least 90% attention precision, 100% gold recall, correct highest-risk ordering, byte-stable replay for fixed inputs and time, and evaluation p95 below 100 ms on the synthetic 120-run corpus. Priority is the sum of inspectable declared-criticality and deterministic-reason components. No model text or free-form event content contributes authority. Run `npm run benchmark:trust` to regenerate the versioned JSON and Markdown baseline.

The rendered browser check uses an isolated headless Chrome profile against the seeded three-workspace corpus. Run `npm run state:seed-trust -- --state /tmp/halba-trust.sqlite`, start durable Halba, then run `npm run browser:trust-inbox -- --origin http://127.0.0.1:4177`. It proves the exact top-three DOM order, checkpoint save/reload and changed filtering, stale-link refusal, exact degraded-receipt disclosure, keyboard entry into Proof Mode, request-proof then resolve transitions, queue/focus updates, bounded cross-workspace recent-decision history, skip-to-main behavior, accessibility-tree names and landmarks, polite and assertive announcements, no duplicate ids or nested controls, 40-pixel targets, 320-pixel reflow, 200% page scale, forced-colors focus/boundaries, desktop/mobile overflow, and a clean console/network. Static accessibility checks cover visible focus, reduced motion, forced-colors rules, and key AA text-contrast pairs. `npm run browser:workspace-scale` loads the maximum 2,000-run state and proves the browser caps the run-index DOM at 100; the current observed render is below one second on the local test machine. These are operational WCAG 2.2 AA gates, not a third-party accessibility certification. The checked-in captures are `artifacts/screenshots/trust-inbox-desktop.png`, `trust-inbox-mobile.png`, and `trust-inbox-proof.png`.

The synthetic and automated browser corpus does not prove the product's under-60-second human identification target. That gate stays `not_run` until an uninterrupted human-timed usability protocol records the selected highest-risk item, contradiction, deterministic authority, required current human decision, interruption status, and elapsed time. Automation proves ordering and mechanics, not comprehension time.

Run the facilitator harness only with a real participant who has no advance answer disclosure:

```bash
npm run eval:human-trust -- --participant participant-01 --facilitator facilitator-01 --launch-browser
```

The participant sees the seeded three-workspace Trust Inbox but not the rubric. The facilitator starts the timer when the page is first visible, stops it when the participant states the first issue, reason, and action, and only then records the structured observations. The harness requires an interactive TTY, refuses to overwrite prior evidence, writes private `0600` JSON and Markdown, and binds the result to the exact corpus/report digest. `npm run eval:goal` fails unless a passing record exists. The record is local facilitator attestation with edit detection; it is neither independent identity proof nor permission to discard failed attempts.

The release pipeline runs the browser Trust Inbox and 2,000-run checks against both the reconstructed tree and extracted archive when Chrome is installed. When Chrome is unavailable, `dist/release-evidence.json` records `not_run_chrome_unavailable` instead of silently presenting browser proof as current.

The report also records total, mean, p50, and p95 deterministic replay time. These figures are machine-dependent and informational rather than thresholded. Gold-source grounding evaluates the checked-in replay contract; it does not stand in for live-model citation quality.

## Live eval

Live eval is opt-in:

```bash
HALBA_EVAL_LIVE=1 npm run eval
```

It requires a local `OPENAI_API_KEY`. The report records the returned model id, latency, and safe token-usage metadata. Cost stays `null` unless an independently maintained pricing source is added; mutable pricing is not hardcoded into the eval.

When no key is configured, live status is `not_run`. Replay success must never be presented as a live model result.
