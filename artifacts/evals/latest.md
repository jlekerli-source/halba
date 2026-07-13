# Halba proof eval report

Replay corpus: Halba proof-quality regression corpus

- Cases: 9/9 passed
- Replay digest: `d93e5aebe74e7e997c62c1c97cbebddb8195a8a562d22c7b77cb11911281f2b9`
- Live GPT eval: not_run — Live eval was not requested.
- Live cost: not measured; Halba does not hardcode mutable pricing.

## Metrics

| Metric | Result |
| --- | ---: |
| verdictAccuracy | 100.0% |
| normalCitationValidity | 100.0% |
| sourceGroundingPrecision | 100.0% |
| sourceGroundingRecall | 100.0% |
| unsupportedRecall | 100.0% |
| contradictionRecall | 100.0% |
| reviewGateRecall | 100.0% |
| falsePositiveRate | 0.0% |
| degradedBehaviorPassRate | 100.0% |
| deterministicReplay | true |

## Replay timing

Timing is informational and machine-dependent; it is not a regression threshold.

| Metric | Result |
| --- | ---: |
| totalMs | 1.062 ms |
| meanCaseMs | 0.118 ms |
| p50CaseMs | 0.044 ms |
| p95CaseMs | 0.553 ms |

## Cases

| Result | Case | Purpose |
| --- | --- | --- |
| PASS | baseline-five-verdicts | Recorded run covers supported, unsupported, contradictory, stale, and uncertain findings. |
| PASS | invalid-quote-fails-closed | A fabricated quote cannot support an otherwise supported claim. |
| PASS | unknown-source-fails-closed | A citation to a source outside the bundle is rejected. |
| PASS | model-overclaim-stays-stale | Model support cannot override an expired proof window. |
| PASS | guard-can-confirm-model-doubt | A deterministic zero-exit receipt can confirm a claim the model marked uncertain. |
| PASS | failed-receipt-detects-contradiction | A non-zero command receipt contradicts a passing-check claim. |
| PASS | freshness-boundary-is-current | Proof exactly seven days old remains inside a seven-day window. |
| PASS | prompt-injection-text-has-no-authority | Instructions embedded in evidence do not change deterministic verdicts. |
| PASS | malformed-model-output-rejected | Missing required structured-output fields stop adjudication. |

## Interpretation

Replay results prove Halba's deterministic ingestion, source grounding, citation validation, guard authority, degraded-input behavior, and UI-safe result contract. They do not prove a live GPT request. Live latency, usage, and cost remain unmeasured until a local API key is intentionally configured and the live eval is run.
