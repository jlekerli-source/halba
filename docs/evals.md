# Proof-quality evals

Halba evaluates the proof workflow as two separate systems:

1. GPT-5.6 structured inference proposes claims, citations, an assessment, confidence, and a reasoning boundary.
2. Deterministic guards validate paths, line ranges, exact quotes, receipts, structured fields, and proof freshness before producing the final verdict.

The split matters. A model can be useful without being allowed to silently verify itself.

The agent workspace has a separate boundary corpus. It verifies that local imports cannot smuggle unknown channels, agents, event types, duplicate or out-of-range events, unsafe ids, inconsistent review counts, inverted timestamps, or mismatched proof bundles into the interface.

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

The report also records total, mean, p50, and p95 deterministic replay time. These figures are machine-dependent and informational rather than thresholded. Gold-source grounding evaluates the checked-in replay contract; it does not stand in for live-model citation quality.

## Live eval

Live eval is opt-in:

```bash
HALBA_EVAL_LIVE=1 npm run eval
```

It requires a local `OPENAI_API_KEY`. The report records the returned model id, latency, and safe token-usage metadata. Cost stays `null` unless an independently maintained pricing source is added; mutable pricing is not hardcoded into the eval.

When no key is configured, live status is `not_run`. Replay success must never be presented as a live model result.
