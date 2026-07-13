import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultProofBundlePath, loadProofBundle } from "./bundle.js";
import { adjudicateProof } from "./engine.js";
import { runOpenAIProof } from "./openai.js";
import { assertProofOutput } from "./schema.js";

export const defaultRecordedProofPath = path.join(
  path.dirname(defaultProofBundlePath),
  "recorded",
  "gpt-5.6-sol-proof.json"
);

export async function runProof({
  mode = "recorded",
  bundlePath = process.env.HALBA_PROOF_BUNDLE || defaultProofBundlePath,
  recordedPath = process.env.HALBA_RECORDED_PROOF || defaultRecordedProofPath,
  openAIOptions = {}
} = {}) {
  const bundle = await loadProofBundle(bundlePath);
  let modelRun;

  if (mode === "recorded") {
    modelRun = JSON.parse(await readFile(recordedPath, "utf8"));
    if (modelRun?.execution?.mode !== "recorded") {
      throw runError("invalid_recording", "Recorded proof fixture is not labeled recorded.", 500);
    }
    assertProofOutput(modelRun.output);
  } else if (mode === "live") {
    modelRun = await runOpenAIProof(bundle, openAIOptions);
  } else {
    throw runError("invalid_mode", "Proof mode must be recorded or live.", 400);
  }

  return adjudicateProof(bundle, modelRun);
}

function runError(code, message, status) {
  const error = new Error(message);
  error.name = "ProofRunError";
  error.code = code;
  error.status = status;
  return error;
}
