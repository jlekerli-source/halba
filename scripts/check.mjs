import { readFile } from "node:fs/promises";
import { assertFeedContract } from "./feed-validation.mjs";

const feed = JSON.parse(await readFile(new URL("../data/sample-feed.json", import.meta.url), "utf8"));

assertFeedContract(feed, {
  expectedSource: "Sample",
  requiredProjectIds: ["sample-research", "sample-build"]
});

console.log("check passed: feed is internally consistent");
