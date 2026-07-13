import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";

import { readPublicManifest, root } from "./public-manifest.mjs";

const manifest = await readPublicManifest();
const paths = [...manifest.include, ...manifest.review];

assert.ok(manifest.include.length, "public package manifest has no include paths");

for (const item of paths) {
  await access(path.join(root, item));
}

console.log(`check passed: public package manifest references ${paths.length} releasable paths`);
