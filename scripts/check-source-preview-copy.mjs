import assert from "node:assert/strict";
import { sourcePreviewCopyText, sourcePreviewScope } from "../src/domain/source-preview.js";

assert.equal(sourcePreviewScope({ text: "one", lineCount: 1, truncated: false }), "1 line");
assert.equal(sourcePreviewScope({ text: "one\ntwo", lineCount: 2, truncated: true }), "2 lines / truncated");
assert.equal(sourcePreviewScope({}), "");

assert.equal(
  sourcePreviewCopyText("projects/demo.md", { text: "one\ntwo", lineCount: 2, truncated: false }),
  "Source preview: projects/demo.md\nScope: 2 lines\n\none\ntwo"
);

console.log("check passed: source preview copy text is contextual");
