import { validateWorkspace } from "./shared/workspace-contract.js";

export function validateImportedWorkspace(data) {
  try {
    return validateWorkspace(data);
  } catch (error) {
    const message = String(error?.message || "workspace is invalid").replace(/^invalid workspace:\s*/, "");
    throw new Error(`Workspace rejected: ${message}`);
  }
}
