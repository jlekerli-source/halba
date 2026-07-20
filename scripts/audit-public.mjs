import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readPublicManifest, root } from "./public-manifest.mjs";

const manifest = await readPublicManifest();
const binaryManifest = JSON.parse(await readFile(path.join(root, "artifacts", "public-binary-assets.json"), "utf8"));
const findings = [];
const publicFiles = [];
const auditedBinaryPaths = new Set();
const approvedBinaries = new Map(binaryManifest.assets.map((asset) => [asset.path, asset]));

assert.equal(binaryManifest.schemaVersion, 1, "unsupported public binary manifest schema");
assert.equal(approvedBinaries.size, binaryManifest.assets.length, "public binary approvals must have unique paths");

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
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (isBinary(relative)) {
    const bytes = await readFile(file);
    auditBinary(relative, bytes);
    continue;
  }
  if (!isPermittedText(relative)) {
    findings.push({ file: relative, rule: "unapproved public file type" });
    continue;
  }
  const text = await readFile(file, "utf8");
  for (const [rule, pattern] of contentRules) {
    if (pattern.test(text)) findings.push({ file: relative, rule });
  }
}

for (const approved of approvedBinaries.keys()) {
  if (!auditedBinaryPaths.has(approved)) findings.push({ file: approved, rule: "approved binary is not in the public package" });
}

if (findings.length) {
  for (const finding of findings) {
    console.error(`public audit finding: ${finding.file} (${finding.rule})`);
  }
}

assert.equal(findings.length, 0, `public audit found ${findings.length} issue(s)`);
console.log(`check passed: public audit scanned ${publicFiles.length} allowlisted files, verified ${auditedBinaryPaths.size} explicit binary hashes, and rejected metadata-bearing images`);

async function collectFiles(target) {
  const entries = await readdir(target, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    publicFiles.push(target);
    return;
  }
  for (const entry of entries) {
    if ([".git", "node_modules", ".playwright-cli"].includes(entry.name)) continue;
    const child = path.join(target, entry.name);
    if (entry.isSymbolicLink()) findings.push({ file: path.relative(root, child), rule: "public symlink is not allowed" });
    if (entry.isDirectory()) await collectFiles(child);
    if (entry.isFile()) publicFiles.push(child);
  }
}

function isBinary(relative) {
  return /\.(?:png|jpe?g|m4a|mp4|wav)$/i.test(relative);
}

function isPermittedText(relative) {
  if (["Dockerfile", "LICENSE"].includes(relative)) return true;
  return /(?:\.dockerignore|\.env\.example|\.gitattributes|\.gitignore|\.prettierrc|\.(?:css|html|js|json|jsonl|md|mjs|patch|svg|ts|tsx|txt|ya?ml))$/i.test(relative);
}

function auditBinary(relative, bytes) {
  const approval = approvedBinaries.get(relative);
  if (!approval) {
    findings.push({ file: relative, rule: "binary lacks explicit hash approval" });
    return;
  }
  auditedBinaryPaths.add(relative);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (approval.sha256 !== digest) findings.push({ file: relative, rule: "approved binary SHA-256 changed" });
  if (approval.bytes !== bytes.length) findings.push({ file: relative, rule: "approved binary byte count changed" });
  if (approval.review !== "content-and-metadata-reviewed") findings.push({ file: relative, rule: "binary approval lacks content and metadata review" });

  const raw = bytes.toString("latin1");
  for (const [rule, pattern] of contentRules) {
    if (pattern.test(raw)) findings.push({ file: relative, rule: `binary ${rule}` });
  }
  if (/\.png$/i.test(relative)) auditPng(relative, bytes);
  if (/\.jpe?g$/i.test(relative)) auditJpeg(relative, bytes);
  if (/\.wav$/i.test(relative) && /(?:IART|INAM|ICMT|ICOP|ISBJ|IKEY)/.test(raw)) findings.push({ file: relative, rule: "WAV descriptive metadata is not allowed" });
  if (/\.(?:m4a|mp4)$/i.test(relative) && /(?:©nam|©ART|©day|©xyz|loci)/.test(raw)) findings.push({ file: relative, rule: "media descriptive or location metadata is not allowed" });
}

function auditPng(relative, bytes) {
  const signature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== signature) {
    findings.push({ file: relative, rule: "invalid PNG signature" });
    return;
  }
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (offset + 12 + length > bytes.length) {
      findings.push({ file: relative, rule: "invalid PNG chunk boundary" });
      return;
    }
    if (["tEXt", "zTXt", "iTXt", "eXIf"].includes(type)) findings.push({ file: relative, rule: `PNG metadata chunk ${type} is not allowed` });
    offset += 12 + length;
    if (type === "IEND") break;
  }
}

function auditJpeg(relative, bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    findings.push({ file: relative, rule: "invalid JPEG signature" });
    return;
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) {
      findings.push({ file: relative, rule: "invalid JPEG segment boundary" });
      return;
    }
    if ([0xe1, 0xed, 0xfe].includes(marker)) findings.push({ file: relative, rule: `JPEG metadata marker 0x${marker.toString(16)} is not allowed` });
    offset += 2 + length;
  }
}
