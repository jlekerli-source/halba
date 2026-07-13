# GPT-5.6 integration

Proof Mode uses GPT-5.6 for the part deterministic code cannot reliably do alone: extracting the atomic claims in an agent report, connecting them to precise evidence spans, and expressing bounded uncertainty.

The server sends a Responses API request with:

- model `gpt-5.6-sol`;
- reasoning effort `max`;
- `store: false`;
- a strict JSON Schema in `text.format`;
- only the bounded text from the selected proof bundle.

The returned object is a candidate analysis, not the final verdict. Halba then verifies every referenced file, line range, and quote, and runs deterministic receipt, freshness, and required-citation guards. The guards remain authoritative.

## Run modes

`recorded` is the default public demo. Its checked-in structured-inference fixture is visibly labeled and exists so the full review workflow is reproducible without credentials. It is not presented as evidence of a live or credentialed model call.

`live` requires a server-side environment variable:

```bash
OPENAI_API_KEY=... npm start
```

Then select **Run live GPT-5.6** in the interface. The key is never returned by an endpoint or bundled into browser JavaScript.

## Failure behavior

Missing credentials, timeouts, refusals, HTTP errors, malformed JSON, and schema-invalid output fail closed. They do not silently fall back to the recording or produce an approved result.

See the [OpenAI latest-model guide](https://developers.openai.com/api/docs/guides/latest-model) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) for the platform features used here.
