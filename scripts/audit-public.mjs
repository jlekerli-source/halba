import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readPublicManifest, root } from "./public-manifest.mjs";

const manifest = await readPublicManifest();
const findings = [];
const publicFiles = [];

const forbiddenPaths = new Set([
  "AGENTS.md",
  "data/seed.json",
  "data/import-runs.json",
  "data/agent-updates.json",
  "docs/roadmap.md",
  "src/importers/le-brain.js",
  "scripts/import-le-brain.mjs",
  "scripts/check-importer.mjs",
  "scripts/smoke.mjs"
]);

const contentRules = [
  ["personal absolute path", /\/Users\/[A-Za-z0-9._-]+\//],
  ["Windows user path", /[A-Za-z]:\\Users\\[^\\]+\\/i],
  ["private source marker", new RegExp(`\\b${["Le", "Brain"].join(" ")}\\b`, "i")],
  ["private operator marker", new RegExp(`\\b${["Om", "ar"].join("")}(?:'s)?\\b`, "i")],
  ["OpenAI-style secret", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["GitHub-style secret", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
];

for (const item of manifest.include) {
  const normalized = item.replace(/\/$/, "");
  if (forbiddenPaths.has(normalized)) {
    findings.push({ file: normalized, rule: "forbidden public path" });
    continue;
  }
  await collectFiles(path.join(root, normalized));
}

for (const file of publicFiles) {
  const relative = path.relative(root, file);
  if (isBinary(relative)) continue;
  const text = await readFile(file, "utf8");
  for (const [rule, pattern] of contentRules) {
    if (pattern.test(text)) findings.push({ file: relative, rule });
  }
}

if (findings.length) {
  for (const finding of findings) {
    console.error(`public audit finding: ${finding.file} (${finding.rule})`);
  }
}

assert.equal(findings.length, 0, `public audit found ${findings.length} issue(s)`);
console.log(`check passed: public audit scanned ${publicFiles.length} allowlisted files`);

async function collectFiles(target) {
  const entries = await readdir(target, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    publicFiles.push(target);
    return;
  }
  for (const entry of entries) {
    if ([".git", "node_modules", ".playwright-cli"].includes(entry.name)) continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) await collectFiles(child);
    if (entry.isFile()) publicFiles.push(child);
  }
}

function isBinary(relative) {
  return /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?)$/i.test(relative);
}
