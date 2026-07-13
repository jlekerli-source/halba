import { performance } from "node:perf_hooks";
import { proofInputText, proofInstructions } from "./prompt.js";
import { assertProofOutput, proofOutputJsonSchema } from "./schema.js";

export const openAIProofModel = "gpt-5.6-sol";
export const openAIReasoningEffort = "max";
export const openAIResponsesUrl = "https://api.openai.com/v1/responses";
export const defaultOpenAITimeoutMs = 90_000;

export function buildOpenAIProofRequest(bundle) {
  return {
    model: openAIProofModel,
    store: false,
    reasoning: {
      effort: openAIReasoningEffort
    },
    instructions: proofInstructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: proofInputText(bundle)
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "halba_proof_analysis",
        strict: true,
        schema: proofOutputJsonSchema
      }
    }
  };
}

export async function runOpenAIProof(bundle, {
  apiKey = process.env.OPENAI_API_KEY,
  responsesUrl = process.env.OPENAI_RESPONSES_URL || openAIResponsesUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = defaultOpenAITimeoutMs,
  now = () => new Date()
} = {}) {
  if (!apiKey) throw modelError("live_unavailable", "Live GPT analysis requires a local OPENAI_API_KEY.", 503);
  if (typeof fetchImpl !== "function") throw modelError("live_unavailable", "No fetch implementation is available for live GPT analysis.", 503);

  const request = buildOpenAIProofRequest(bundle);
  const startedAt = performance.now();
  let response;

  try {
    response = await fetchImpl(responsesUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw modelError("model_timeout", "GPT analysis timed out before a response completed.", 504);
    }
    throw modelError("model_unavailable", "GPT analysis could not reach the Responses API.", 502);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const upstreamCode = typeof payload?.error?.code === "string" ? payload.error.code : null;
    throw modelError("model_request_failed", "The Responses API rejected the proof-analysis request.", 502, upstreamCode);
  }

  const refusal = extractRefusal(payload);
  if (refusal) throw modelError("model_refusal", "GPT declined to analyze this proof bundle.", 422);

  const outputText = extractOutputText(payload);
  if (!outputText) throw modelError("invalid_model_output", "GPT returned no structured proof output.", 502);

  let output;
  try {
    output = JSON.parse(outputText);
    assertProofOutput(output);
  } catch {
    throw modelError("invalid_model_output", "GPT returned proof output that did not match Halba's schema.", 502);
  }

  return {
    execution: {
      mode: "live",
      model: payload.model || openAIProofModel,
      reasoningEffort: openAIReasoningEffort,
      store: false,
      recordedAt: now().toISOString(),
      responseId: payload.id || null,
      latencyMs: Math.round(performance.now() - startedAt),
      usage: safeUsage(payload.usage)
    },
    output
  };
}

export function extractOutputText(payload) {
  return (payload?.output || [])
    .flatMap((item) => item?.type === "message" ? item.content || [] : [])
    .filter((content) => content?.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("");
}

function extractRefusal(payload) {
  return (payload?.output || [])
    .flatMap((item) => item?.type === "message" ? item.content || [] : [])
    .find((content) => content?.type === "refusal");
}

function safeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return {
    inputTokens: numberOrNull(usage.input_tokens),
    outputTokens: numberOrNull(usage.output_tokens),
    totalTokens: numberOrNull(usage.total_tokens),
    cachedInputTokens: numberOrNull(usage.input_tokens_details?.cached_tokens),
    reasoningTokens: numberOrNull(usage.output_tokens_details?.reasoning_tokens)
  };
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function modelError(code, message, status, upstreamCode = null) {
  const error = new Error(message);
  error.name = "ProofModelError";
  error.code = code;
  error.status = status;
  error.upstreamCode = upstreamCode;
  return error;
}
