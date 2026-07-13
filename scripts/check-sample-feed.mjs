import { readFile } from "node:fs/promises";
import { assertFeedContract } from "./feed-validation.mjs";

const feed = JSON.parse(await readFile(new URL("../data/sample-feed.json", import.meta.url), "utf8"));
const sampleProjectIds = ["sample-research", "sample-build"];

assertFeedContract(feed, { expectedSource: "Sample", requiredProjectIds: sampleProjectIds });

console.log(`check passed: sample feed maps ${feed.projects.length} projects and ${feed.posts.length} posts`);
