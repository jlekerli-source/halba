import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reviewExport, reviewExportCopyText } from "../src/domain/review-export.js";

const feed = JSON.parse(await readFile(new URL("../data/sample-feed.json", import.meta.url), "utf8"));
const now = new Date("2026-06-23T12:00:00Z");
const output = reviewExport(feed, now);

for (const project of feed.projects) {
  const section = output.split("\n\n").find((item) => item.startsWith(`## ${project.name}\n`));
  assert.ok(section, `missing project ${project.id}`);
  const source = project.review?.sourcePath || project.statusFile;
  assert.ok(source, `missing source path for ${project.id}`);
  for (const label of ["evidence:", "source:", "health:", "next measurable goal:", "what to stop:", "lane status:"]) {
    assert.ok(section.includes(label), `missing ${label} for ${project.id}`);
  }
  assert.ok(section.includes(`source: ${source}`), `missing source path for ${project.id}`);
}

const scopeLabel = `All projects / ${feed.projects.length} projects`;
const copyText = reviewExportCopyText(feed, scopeLabel, now);
assert.ok(copyText.startsWith([
  "Weekly Export",
  `scope: ${scopeLabel}`,
  `source: ${feed.source}`,
  `generated: ${feed.generatedAt}`,
  `projects: ${feed.projects.length}`,
  "",
  "## "
].join("\n")), "copy text should start with source-backed scope receipt");
assert.ok(copyText.includes(output), "copy text should include weekly export body");

console.log("check passed: weekly review export has required fields");
