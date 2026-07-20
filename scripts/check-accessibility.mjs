import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, styles] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8")
]);

const palette = Object.fromEntries([...styles.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]));
const contrastPairs = [
  [palette.muted, palette.paper, "muted text on page"],
  [palette.muted, palette["paper-raised"], "muted text on raised cards"],
  [palette.muted, palette["paper-muted"], "muted text on muted panels"],
  [palette.muted, palette["teal-soft"], "muted text on teal attention panels"],
  [palette.muted, palette["amber-soft"], "muted text on amber attention panels"],
  [palette.red, palette["red-soft"], "red status text on red panels"],
  [palette["teal-dark"], palette["teal-soft"], "teal status text"],
  ["#ffffff", palette.teal, "white text on teal controls"],
  ["#ffffff", palette.amber, "white text on amber controls"],
  ["#ffffff", palette.red, "white text on red controls"]
];
for (const [foreground, background, label] of contrastPairs) {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= 4.5, `${label} must meet 4.5:1; received ${ratio.toFixed(2)}:1`);
}

assert.match(html, /class="skip-link" href="#main-content"/);
assert.match(app, /id="main-content"[^>]*tabindex="-1"/);
assert.match(app, /aria-labelledby="\$\{headingId\}"/);
assert.match(app, /aria-current="true"/);
assert.match(app, /workspaceRunRenderLimit = 100/);
assert.match(styles, /button:focus-visible,[\s\S]*summary:focus-visible/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(styles, /@media \(forced-colors: active\)/);
assert.match(html, /id="status-region"[^>]*aria-live="polite"/);
assert.match(styles, /\.skip-link:focus\s*\{[\s\S]*translateY\(0\)/);

console.log("check passed: operational UI source preserves skip navigation, polite announcements, visible focus, reduced motion, forced colors, bounded run rendering, named Trust items, and AA text contrast pairs");

function contrast(left, right) {
  const first = luminance(left);
  const second = luminance(right);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
