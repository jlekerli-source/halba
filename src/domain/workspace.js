import { readFile } from "node:fs/promises";
import { validateWorkspace } from "../../public/shared/workspace-contract.js";

export { validateWorkspace } from "../../public/shared/workspace-contract.js";

const defaultWorkspaceUrl = new URL("../../data/demo/workspace.json", import.meta.url);

export async function loadWorkspace(file = defaultWorkspaceUrl, options = {}) {
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text) > 64 * 1024) throw new Error("invalid workspace: file exceeds 64 KB");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("invalid workspace: file must contain JSON");
  }
  return validateWorkspace(data, options);
}
