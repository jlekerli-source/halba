export function sourcePreviewScope(preview) {
  if (!preview?.text) return "";
  const count = Number(preview.lineCount || 0);
  return `${count} ${count === 1 ? "line" : "lines"}${preview.truncated ? " / truncated" : ""}`;
}

export function sourcePreviewCopyText(path, preview) {
  const scope = sourcePreviewScope(preview);
  if (!scope) return "";
  return [
    `Source preview: ${path || "unknown source"}`,
    `Scope: ${scope}`,
    "",
    preview.text
  ].join("\n");
}
