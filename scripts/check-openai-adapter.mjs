import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadProofBundle } from "../src/proof/bundle.js";
import {
  buildOpenAIProofRequest,
  openAIProofModel,
  runOpenAIProof
} from "../src/proof/openai.js";
import { runProof } from "../src/proof/run.js";

const bundle = await loadProofBundle();
const recorded = JSON.parse(await readFile(new URL("../data/demo/recorded/gpt-5.6-sol-proof.json", import.meta.url), "utf8"));
const request = buildOpenAIProofRequest(bundle);

assert.equal(request.model, "gpt-5.6-sol");
assert.equal(request.model, openAIProofModel);
assert.equal(request.reasoning.effort, "max");
assert.equal(request.store, false);
assert.equal(request.text.format.type, "json_schema");
assert.equal(request.text.format.strict, true);
assert.ok(request.input[0].content[0].text.includes("SOURCE sources/agent-report.md"));
assert.ok(request.input[0].content[0].text.includes("3|Review gate staleness now accepts an explicit evaluation time."));

let capturedRequest;
const live = await runOpenAIProof(bundle, {
  apiKey: "test-key-never-logged",
  now: () => new Date("2026-07-13T12:00:00.000Z"),
  fetchImpl: async (url, options) => {
    capturedRequest = { url, options };
    return jsonResponse({
      id: "resp_test",
      model: "gpt-5.6-sol-2026-07-01",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(recorded.output) }]
      }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens_details: { reasoning_tokens: 30 }
      }
    });
  }
});

assert.equal(capturedRequest.url, "https://api.openai.com/v1/responses");
assert.equal(capturedRequest.options.method, "POST");
assert.equal(capturedRequest.options.headers.authorization, "Bearer test-key-never-logged");
assert.equal(JSON.parse(capturedRequest.options.body).store, false);
assert.equal(live.execution.mode, "live");
assert.equal(live.execution.responseId, "resp_test");
assert.deepEqual(live.execution.usage, {
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  cachedInputTokens: 20,
  reasoningTokens: 30
});

await assert.rejects(runOpenAIProof(bundle, { apiKey: "" }), (error) => error.code === "live_unavailable" && error.status === 503);
await assert.rejects(runOpenAIProof(bundle, {
  apiKey: "test",
  fetchImpl: async () => jsonResponse({
    output: [{ type: "message", content: [{ type: "refusal", refusal: "declined" }] }]
  })
}), (error) => error.code === "model_refusal" && error.status === 422);
await assert.rejects(runOpenAIProof(bundle, {
  apiKey: "test",
  fetchImpl: async () => jsonResponse({
    output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }]
  })
}), (error) => error.code === "invalid_model_output");
await assert.rejects(runOpenAIProof(bundle, {
  apiKey: "test",
  fetchImpl: async () => {
    throw new DOMException("timed out", "TimeoutError");
  }
}), (error) => error.code === "model_timeout" && error.status === 504);

const replay = await runProof({ mode: "recorded" });
assert.equal(replay.execution.mode, "recorded");
assert.equal(replay.execution.model, "gpt-5.6-sol");
assert.equal(replay.findings.length, 6);

console.log("check passed: GPT-5.6 adapter enforces max reasoning, strict schema, no storage, and labeled replay");

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    }
  };
}
