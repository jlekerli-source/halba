import { access } from "node:fs/promises";
import path from "node:path";

import { readPublicManifest, root } from "./public-manifest.mjs";

const manifest = await readPublicManifest();

async function missing(items) {
  const missingItems = [];
  for (const item of items) {
    try {
      await access(path.join(root, item));
    } catch {
      missingItems.push(item);
    }
  }
  return missingItems;
}

const missingInclude = await missing(manifest.include);
const missingReview = await missing(manifest.review);

function displayItem(item) {
  return item.replaceAll(/`([^`]+)`/g, "$1");
}

console.log("Public package dry run");
console.log("");
console.log(`Include (${manifest.include.length})`);
for (const item of manifest.include) console.log(`- ${item}`);
console.log("");
console.log(`Exclude / private (${manifest.excludeItems.length})`);
for (const item of manifest.excludeItems) console.log(`- ${displayItem(item)}`);
console.log("");
console.log(`Review before including (${manifest.review.length})`);
for (const item of manifest.review) console.log(`- ${item}`);
console.log("");

if (missingInclude.length || missingReview.length) {
  console.log("Missing");
  for (const item of missingInclude) console.log(`- include: ${item}`);
  for (const item of missingReview) console.log(`- review: ${item}`);
  process.exitCode = 1;
} else {
  console.log("Missing: none");
}

console.log("No files copied, archived, deleted, or published.");
