import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { analyzeClaimHistory } from "../src/domain/claim-history.js";
import { buildWeeklyReview, weeklyReviewMarkdown } from "../src/domain/weekly-review.js";
import { defaultStateFile, openLocalStore } from "../src/storage/local-store.js";

const options = parseOptions(process.argv.slice(2));
const format = options.format || "markdown";
if (!["markdown", "json"].includes(format)) throw new Error("weekly review format must be markdown or json");
const generatedAt = options.at || new Date().toISOString();
const windowDays = Number(options.windowDays || 7);
const maxAgeDays = Number(options.maxAgeDays || 7);
const store = await openLocalStore(options.state || process.env.HALBA_STATE_FILE || defaultStateFile);
try {
  const workspaceId = options.workspace || store.listWorkspaces()[0]?.id;
  const workspace = workspaceId ? store.getWorkspace(workspaceId) : null;
  if (!workspace) throw new Error("weekly review workspace is unavailable");
  const claimHistory = analyzeClaimHistory({ workspace, proofRecords: store.listProofBundleRecords(workspaceId), evaluatedAt: generatedAt, maxAgeDays });
  const review = buildWeeklyReview({
    workspace,
    claimHistory,
    decisions: store.listWorkspaceReviewDecisions(workspaceId),
    receipts: store.listImportReceipts(workspaceId),
    generatedAt,
    windowDays
  });
  const output = format === "json" ? `${JSON.stringify(review, null, 2)}\n` : weeklyReviewMarkdown(review);
  if (options.output) {
    const target = path.resolve(options.output);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, output, "utf8");
    console.log(JSON.stringify({ workspaceId, format, output: target, counts: review.counts }, null, 2));
  } else {
    process.stdout.write(output);
  }
} finally {
  store.close();
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) throw new Error(`unexpected argument ${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}
