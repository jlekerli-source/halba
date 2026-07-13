export const viewStorageKey = "halba:view:v1";

export function evidenceSelection(postId, evidenceIndex) {
  if (!postId || !Number.isInteger(Number(evidenceIndex))) return null;
  return { type: "evidence", postId, evidenceIndex: Number(evidenceIndex) };
}

export function noticeSelection(label, item) {
  if (!label || !item) return null;
  return {
    type: "notice",
    label,
    projectId: item.projectId || null,
    path: item.path || "",
    kind: item.kind || item.severity || "",
    text: item.text || ""
  };
}

export function projectSelection(projectId) {
  return projectId ? { type: "project", projectId } : null;
}

export function snapshotView(state) {
  const selectedEvidence = state.selectedEvidence;
  const selectedNotice = state.selectedNotice;
  return {
    lane: state.lane || "all",
    kind: state.kind || "all",
    query: state.query || "",
    selectedProjectId: state.selectedProjectId || null,
    selection: selectedEvidence
      ? evidenceSelection(selectedEvidence.post?.id, selectedEvidence.evidenceIndex)
      : selectedNotice
        ? noticeSelection(selectedNotice.label, selectedNotice.item)
        : projectSelection(state.selectedProjectId)
  };
}

export function findSavedEvidence(rows, selection) {
  if (selection?.type !== "evidence") return null;
  return rows.find((row) => row.post.id === selection.postId && row.evidenceIndex === selection.evidenceIndex) || null;
}

export function findSavedNotice(feed, selection) {
  if (selection?.type !== "notice") return null;
  const items = selection.label === "Import QA" ? feed.qa || [] : feed.focus || [];
  return items.find((item) => (
    item.projectId === selection.projectId
    && (item.path || "") === selection.path
    && (item.kind || item.severity || "") === selection.kind
    && (item.text || "") === selection.text
  )) || null;
}

export function normalizeSavedView(feed, saved = {}) {
  const lanes = new Set((feed.projects || []).map((project) => project.lane));
  const kinds = new Set((feed.posts || []).flatMap((post) => (post.evidence || []).map((item) => item.kind)));
  const projectIds = new Set((feed.projects || []).map((project) => project.id));
  const selectedProjectId = projectIds.has(saved.selectedProjectId) ? saved.selectedProjectId : null;
  return {
    lane: saved.lane === "all" || lanes.has(saved.lane) ? saved.lane : "all",
    kind: saved.kind === "all" || kinds.has(saved.kind) ? saved.kind : "all",
    query: typeof saved.query === "string" ? saved.query.slice(0, 200) : "",
    selectedProjectId,
    selection: normalizeSelection(feed, saved.selection)
  };
}

function normalizeSelection(feed, selection) {
  if (selection?.type === "project") {
    return (feed.projects || []).some((project) => project.id === selection.projectId)
      ? projectSelection(selection.projectId)
      : null;
  }
  if (selection?.type === "notice") {
    return findSavedNotice(feed, selection) ? selection : null;
  }
  if (selection?.type !== "evidence") return null;
  const post = (feed.posts || []).find((item) => item.id === selection.postId);
  return post?.evidence?.[selection.evidenceIndex]
    ? evidenceSelection(selection.postId, selection.evidenceIndex)
    : null;
}
