import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sectionItems(markdown, title) {
  const start = markdown.indexOf(`## ${title}\n`);
  if (start === -1) return [];

  const afterHeading = markdown.slice(start).split("\n").slice(1).join("\n");
  const nextHeading = afterHeading.search(/\n## /);
  const body = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);

  return body
    .split("\n")
    .map((line) => line.match(/^- (.+)$/)?.[1])
    .filter(Boolean);
}

function codePaths(items) {
  return items.flatMap((item) => [...item.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
}

export async function readPublicManifest() {
  const markdown = await readFile(path.join(root, "docs", "public-package-manifest.md"), "utf8");
  const includeItems = sectionItems(markdown, "Include");
  const excludeItems = sectionItems(markdown, "Exclude");
  const reviewItems = sectionItems(markdown, "Review Before Including");

  return {
    include: codePaths(includeItems),
    exclude: codePaths(excludeItems),
    excludeItems,
    review: codePaths(reviewItems),
  };
}
