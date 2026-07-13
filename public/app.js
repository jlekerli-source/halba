import { isStale } from "/domain/stale.js";
import { importDeltaCopyText, importReceiptSummary, latestPostTime, reviewGateReceipt, reviewGateStatus, reviewGateSummary } from "/domain/feed.js";
import { reviewExport, reviewExportCopyText } from "/domain/review-export.js";
import { sourcePreviewCopyText, sourcePreviewScope } from "/domain/source-preview.js";
import { findSavedEvidence, findSavedNotice, normalizeSavedView, snapshotView, viewStorageKey } from "/domain/view-state.js";

const state = {
  feed: null,
  importDelta: null,
  roadmap: null,
  lane: "all",
  kind: "all",
  query: "",
  selectedProjectId: null,
  selectedEvidence: null,
  selectedNotice: null,
  sourcePreview: null,
  sourcePreviewKey: null,
  focusExpanded: false
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function cssToken(value) {
  return String(value || "UNKNOWN").replace(/[^a-z0-9_-]/gi, "-");
}

function formatDate(value) {
  return String(value || "").slice(0, 10);
}

function initials(value) {
  return String(value || "?").trim().slice(0, 1).toUpperCase();
}

function proofSummary(project) {
  if (!project) return "";
  const status = isStale(project) ? "STALE" : "CURRENT";
  return `${formatDate(project.lastProofDate)} / ${status} / ${project.proofWindowDays}d window`;
}

function projectById(feed) {
  return new Map((feed?.projects || []).map((project) => [project.id, project]));
}

function evidenceRows(feed) {
  const projects = projectById(feed);
  return (feed?.posts || []).flatMap((post) => post.evidence.map((evidence, evidenceIndex) => {
    const project = projects.get(post.projectId);
    return { post, evidence, evidenceIndex, project };
  }));
}

function visibleProjects(feed) {
  return (feed?.projects || []).filter((project) => {
    const laneMatch = state.lane === "all" || project.lane === state.lane;
    const projectMatch = !state.selectedProjectId || project.id === state.selectedProjectId;
    return laneMatch && projectMatch;
  });
}

function scopedFeed(feed) {
  const projects = visibleProjects(feed);
  const ids = new Set(projects.map((project) => project.id));
  return {
    ...feed,
    projects,
    posts: (feed?.posts || []).filter((post) => ids.has(post.projectId)),
    focus: (feed?.focus || []).filter((item) => ids.has(item.projectId)),
    qa: (feed?.qa || []).filter((item) => ids.has(item.projectId))
  };
}

function projectSearchFields(project) {
  return [
    project?.name,
    project?.lane,
    project?.health,
    project?.role,
    project?.ownerContext,
    project?.deadline,
    project?.claim,
    project?.successMetric,
    project?.stopCondition,
    project?.evidenceLabel,
    project?.statusFile,
    project?.review?.sourcePath,
    project?.review?.stateRecommendation,
    project?.review?.healthSummary,
    project?.review?.contradiction,
    project?.review?.nextGoal,
    project?.review?.whatToStop
  ];
}

function searchableText(row) {
  const { post, evidence, project } = row;
  return [
    ...projectSearchFields(project),
    post.title,
    post.body,
    post.author,
    evidence.kind,
    evidence.label,
    evidence.path,
    evidence.status,
    ...post.replies.flatMap((reply) => [reply.author, reply.body])
  ].join(" ").toLowerCase();
}

function filteredRows(feed) {
  const query = state.query.trim().toLowerCase();
  return filteredEvidenceRows(feed, query, false);
}

function filteredEvidenceRows(feed, query, includeAllProjects) {
  return evidenceRows(feed)
    .filter((row) => {
      const laneMatch = state.lane === "all" || row.project?.lane === state.lane;
      const kindMatch = state.kind === "all" || row.evidence.kind === state.kind;
      const projectMatch = includeAllProjects || !state.selectedProjectId || row.post.projectId === state.selectedProjectId;
      const queryMatch = !query || searchableText(row).includes(query);
      return laneMatch && kindMatch && projectMatch && queryMatch;
    })
    .sort((a, b) => latestPostTime(b.post) - latestPostTime(a.post));
}

function activeProjectCount(feed, includeAllProjects = false) {
  const query = state.query.trim().toLowerCase();
  if (!query && state.kind === "all") {
    return (includeAllProjects
      ? feed.projects.filter((project) => state.lane === "all" || project.lane === state.lane)
      : visibleProjects(feed)).length;
  }
  return new Set(filteredEvidenceRows(feed, query, includeAllProjects).map((row) => row.post.projectId)).size;
}

function filteredPosts(feed) {
  return [...new Map(filteredRows(feed).map((row) => [row.post.id, row.post])).values()];
}

function agentReceiptRows(feed) {
  return filteredRows(feed).filter(({ post, evidence }) => post.id.startsWith("agent-") && evidence.kind === "handoff");
}

function renderLaneFilter(feed) {
  const select = document.querySelector("#lane-filter");
  const lanes = [...new Set(feed.projects.map((project) => project.lane))].sort();
  select.innerHTML = [
    '<option value="all">All lanes</option>',
    ...lanes.map((lane) => `<option value="${escapeHtml(lane)}">${escapeHtml(lane)}</option>`)
  ].join("");
  select.value = lanes.includes(state.lane) ? state.lane : "all";
}

function renderKindFilter(feed) {
  const select = document.querySelector("#kind-filter");
  const kinds = [...new Set(evidenceRows(feed).map((row) => row.evidence.kind))].sort();
  select.innerHTML = [
    '<option value="all">All kinds</option>',
    ...kinds.map((kind) => `<option value="${escapeHtml(kind)}">${escapeHtml(kind)}</option>`)
  ].join("");
  select.value = kinds.includes(state.kind) ? state.kind : "all";
}

function renderSearch() {
  const input = document.querySelector("#search");
  if (input.value !== state.query) input.value = state.query;
}

function renderSummary(feed) {
  const projects = visibleProjects(feed);
  const qa = filteredQaItems(feed);
  const stale = projects.filter((project) => isStale(project)).length;
  const evidence = filteredRows(feed).length;
  const redQa = qa.filter((item) => item.severity === "red").length;
  const items = [
    ["Projects", activeProjectCount(feed), ""],
    ["Evidence", evidence, ""],
    ["Review Flags", filteredFocusItems(feed).length, ""],
    ["Stale", stale, stale ? "bad" : ""],
    ["QA", qa.length, redQa ? "bad" : ""]
  ];
  const max = Math.max(...items.map(([, value]) => Number(value) || 0), 1);
  document.querySelector("#summary").innerHTML = items.map(([label, value, tone]) => `
    <span class="${tone}">
      <small>${label}</small>
      <strong>${value}</strong>
      <i class="summary-bar" style="--size: ${Math.round((Number(value) || 0) / max * 100)}%" aria-hidden="true"></i>
    </span>
  `).join("");
}

function percent(value, max) {
  return Math.round((Number(value) || 0) / Math.max(Number(max) || 0, 1) * 100);
}

function renderMiniBars(items, max, filterType = "") {
  return items.map(([label, value, tone = ""]) => {
    const selected = filterType === "lane" ? state.lane === label : state.kind === label;
    const actionLabel = selected ? `Clear ${filterType} filter ${label}` : `Filter ${filterType} ${label}`;
    const filterAttributes = filterType
      ? `type="button" data-board-${filterType}="${escapeHtml(label)}" aria-pressed="${selected}" aria-label="${escapeHtml(actionLabel)}" title="${escapeHtml(actionLabel)}"`
      : "";
    return `
    <${filterType ? "button" : "span"} class="mini-bar mini-bar-${cssToken(tone || label)}" style="--size: ${percent(value, max)}%" ${filterAttributes}>
      <i aria-hidden="true"></i>
      <small>${escapeHtml(label)}</small>
      <b>${escapeHtml(value)}</b>
    </${filterType ? "button" : "span"}>
  `;
  }).join("");
}

function boardSignalButton(target, label, value, tone = "") {
  return `
    <button class="board-signal-button ${tone}" type="button" data-board-target="${target}" ${value ? "" : "disabled"} aria-label="Open ${escapeHtml(label)} detail">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
    </button>
  `;
}

function boardScopeActive() {
  return state.lane !== "all" || state.kind !== "all" || state.query.trim() || state.selectedProjectId;
}

function boardScopeItems(feed) {
  return [
    state.selectedProjectId ? ["Project", projectById(feed).get(state.selectedProjectId)?.name || state.selectedProjectId] : null,
    state.lane !== "all" ? ["Lane", state.lane] : null,
    state.kind !== "all" ? ["Kind", state.kind] : null,
    state.query.trim() ? ["Search", `"${state.query.trim()}"`] : null
  ].filter(Boolean);
}

function renderBoardScope(items) {
  if (!items.length) return "";
  return `
    <span class="board-scope" aria-hidden="true">
      ${items.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join("")}
    </span>
  `;
}

function renderInfoboard(feed) {
  const projects = visibleProjects(feed);
  const rows = filteredRows(feed);
  const qa = filteredQaItems(feed);
  const stale = projects.filter((project) => isStale(project)).length;
  const current = Math.max(projects.length - stale, 0);
  const focus = filteredFocusItems(feed).length;
  const redQa = qa.filter((item) => item.severity === "red").length;
  const { status } = gateContext(feed);
  const latestAgent = agentReceiptRows(feed)[0];
  const scopeItems = boardScopeItems(feed);
  const scoped = boardScopeActive();
  const scopeLabel = scopeItems.map(([label, value]) => `${label} ${value}`).join(", ");
  const lanes = [...projects.reduce((counts, project) => {
    counts.set(project.lane, (counts.get(project.lane) || 0) + 1);
    return counts;
  }, new Map())].sort((a, b) => b[1] - a[1]);
  const evidenceKinds = [...rows.reduce((counts, row) => {
    counts.set(row.evidence.kind, (counts.get(row.evidence.kind) || 0) + 1);
    return counts;
  }, new Map())].sort((a, b) => b[1] - a[1]);

  document.querySelector("#infoboard").innerHTML = `
    <button class="board-hero" type="button" data-board-reset ${scoped ? "" : "disabled"} aria-label="${scoped ? `Reset board filters: ${escapeHtml(scopeLabel)}` : "Review gate"}" title="${scoped ? `Reset board filters: ${escapeHtml(scopeLabel)}` : "Review gate"}">
      <span>Review Gate</span>
      <strong class="gate-${cssToken(status)}">${escapeHtml(status)}</strong>
      <p>${escapeHtml(focus)} focus / ${escapeHtml(qa.length)} QA / ${escapeHtml(stale)} stale</p>
      <small class="board-proof">${escapeHtml(percent(current, projects.length))}% proof current · ${escapeHtml(current)}/${escapeHtml(projects.length)} scoped</small>
      ${renderBoardScope(scopeItems)}
      <i class="pulse-ring" style="--size: ${percent(current, projects.length)}%" aria-hidden="true"></i>
    </button>
    <div class="board-panel">
      <h2>Lane Map</h2>
      <div class="mini-bars">${renderMiniBars(lanes, Math.max(...lanes.map(([, value]) => value), 1), "lane")}</div>
    </div>
    <div class="board-panel">
      <h2>Evidence Mix</h2>
      <div class="mini-bars">${renderMiniBars(evidenceKinds, Math.max(...evidenceKinds.map(([, value]) => value), 1), "kind")}</div>
    </div>
    <div class="board-panel board-signal">
      <h2>Signal</h2>
      ${boardSignalButton("focus", "Focus", focus)}
      ${boardSignalButton(redQa ? "red-qa" : "amber-qa", "QA", qa.length, qa.length ? "warn" : "")}
      ${boardSignalButton("red-qa", "Red", redQa, redQa ? "bad" : "")}
      ${latestAgent ? `
        <button class="board-agent" type="button" data-post-id="${escapeHtml(latestAgent.post.id)}" data-evidence-index="${escapeHtml(latestAgent.evidenceIndex)}">
          <small>Latest handoff</small>
          <strong>${escapeHtml(latestAgent.post.author)}</strong>
          <em>${escapeHtml(latestAgent.project?.name || latestAgent.post.projectId)}</em>
        </button>
      ` : ""}
    </div>
  `;
}

function renderReviewGate(feed) {
  const { gate, status } = gateContext(feed);
  const filterLabel = reviewSearchFilterLabel();
  document.querySelector("#review-gate").innerHTML = `
    <div class="gate-head">
      <h2>Review Gate</h2>
      ${filterLabel ? `<span class="gate-filter">Filtered by ${escapeHtml(filterLabel)}</span>` : ""}
      <span class="gate-actions">
        <button class="copy-action gate-copy" type="button" data-copy-gate-receipt>Copy receipt</button>
        <strong class="gate-status gate-${cssToken(status)}">${escapeHtml(status)}</strong>
      </span>
    </div>
    <div class="gate-grid">
      ${gateButton("stale", "Stale", gate.staleProjectCount, gate.staleProjectCount ? "bad" : "")}
      ${gateButton("red-qa", "Red QA", gate.redQaCount, gate.redQaCount ? "bad" : "")}
      ${gateButton("amber-qa", "Amber QA", gate.amberQaCount, gate.amberQaCount ? "warn" : "")}
      ${gateButton("focus", "Focus Shown", gate.visibleFocusCount, "")}
      ${gateButton("export", "Export", gate.weeklyExportProjectCount, "")}
    </div>
    ${renderGateChart(gate)}
  `;
}

function renderGateChart(gate) {
  const items = [
    ["stale", "stale", "Stale", gate.staleProjectCount],
    ["red", "red-qa", "Red QA", gate.redQaCount],
    ["amber", "amber-qa", "Amber QA", gate.amberQaCount],
    ["focus", "focus", "Focus", gate.visibleFocusCount],
    ["export", "export", "Export", gate.weeklyExportProjectCount]
  ];
  const max = Math.max(...items.map(([, , , value]) => Number(value) || 0), 1);
  return `
    <div class="gate-chart" aria-label="Review gate signal graph">
      ${items.map(([kind, target, label, value]) => `
        <button class="gate-bar gate-bar-${kind}" type="button" data-gate-target="${target}" ${value ? "" : "disabled"} aria-label="Show ${escapeHtml(label)} details" style="--size: ${Math.round((Number(value) || 0) / max * 100)}%">
          <i aria-hidden="true"></i>
          <small>${escapeHtml(label)}</small>
          <b>${escapeHtml(value)}</b>
        </button>
      `).join("")}
    </div>
  `;
}

function gateContext(feed) {
  const focusItems = filteredFocusItems(feed);
  const qaItems = filteredQaItems(feed);
  const scoped = scopedFeed(feed);
  const gateFeed = { ...scoped, focus: focusItems, qa: qaItems };
  const gate = reviewGateSummary(gateFeed, { visibleFocusCount: state.focusExpanded ? focusItems.length : Math.min(focusItems.length, 4) });
  return { gateFeed, gate, status: reviewGateStatus(gate) };
}

function gateButton(target, label, value, tone) {
  return `
    <button class="gate-cell ${tone}" type="button" data-gate-target="${target}" ${value ? "" : "disabled"} aria-label="Show ${escapeHtml(label)} details">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
    </button>
  `;
}

function filteredFocusItems(feed) {
  const focusFeed = scopedFeed(feed);
  const projects = projectById(feed);
  const query = state.query.trim().toLowerCase();
  return (focusFeed.focus || feed?.focus || []).filter((item) => {
    if (!query) return true;
    const project = projects.get(item.projectId);
    return [
      item.projectName,
      item.kind,
      item.text,
      item.path,
      ...projectSearchFields(project)
    ].join(" ").toLowerCase().includes(query);
  });
}

function filteredQaItems(feed) {
  const qaFeed = scopedFeed(feed);
  const projects = projectById(feed);
  const query = state.query.trim().toLowerCase();
  return (qaFeed.qa || []).filter((item) => {
    if (!query) return true;
    const project = projects.get(item.projectId);
    return [
      item.projectName,
      item.severity,
      item.kind,
      item.text,
      item.path,
      ...projectSearchFields(project)
    ].join(" ").toLowerCase().includes(query);
  });
}

function renderFocus(feed) {
  const target = document.querySelector("#focus-list");
  const items = filteredFocusItems(feed);
  const visibleItems = state.focusExpanded ? items : items.slice(0, 4);
  const toggle = document.querySelector("[data-focus-toggle]");
  const countText = visibleItems.length === items.length
    ? `${visibleItems.length} shown`
    : `${visibleItems.length} of ${items.length} shown`;
  const filterLabel = reviewSearchFilterLabel();
  document.querySelector("#focus-count").innerHTML = [
    countText,
    filterLabel ? `<span class="focus-filter">Filtered by ${escapeHtml(filterLabel)}</span>` : ""
  ].filter(Boolean).join(" &middot; ");
  toggle.hidden = items.length <= 4;
  toggle.textContent = state.focusExpanded ? "Show less" : "Show all";
  toggle.setAttribute("aria-expanded", String(state.focusExpanded));
  target.innerHTML = visibleItems.map((item, index) => `
    <button class="focus-item focus-${escapeHtml(item.kind)} ${selectedNotice("Review focus", item) ? "is-selected" : ""}" type="button" data-project-id="${escapeHtml(item.projectId)}" data-focus-index="${index}" aria-current="${selectedNotice("Review focus", item) ? "true" : "false"}">
      <span class="warn-dot"></span>
      <span>
        <strong>${escapeHtml(item.projectName)}</strong>
        <p>${escapeHtml(item.text)}</p>
      </span>
      <em>${escapeHtml(item.kind)}</em>
    </button>
  `).join("") || '<p class="empty">No review focus items.</p>';
}

function renderAgentWorkroom(feed) {
  const target = document.querySelector("#agent-list");
  const rows = agentReceiptRows(feed);
  const filterLabel = boardScopeItems(feed).map(([label, value]) => `${label.toLowerCase()} ${value}`).join(" / ");
  const countLabel = rows.length === 1 ? "1 receipt" : `${rows.length} receipts`;
  document.querySelector("#agent-count").textContent = filterLabel ? `${countLabel} · Filtered by ${filterLabel}` : countLabel;
  target.classList.toggle("agent-list-single", rows.length === 1);
  target.innerHTML = rows.slice(0, 3).map(({ post, evidence, evidenceIndex, project }) => `
    <button class="agent-item" type="button" data-post-id="${escapeHtml(post.id)}" data-evidence-index="${evidenceIndex}" aria-label="Open agent receipt: ${escapeHtml(evidence.label)}">
      <span class="agent-avatar">${escapeHtml(initials(post.author))}</span>
      <span class="agent-main">
        <strong>${escapeHtml(post.author)}</strong>
        <p>${escapeHtml(evidence.label)}</p>
        <small>${escapeHtml(project?.name || post.projectId)} / ${escapeHtml(evidence.status)} / ${escapeHtml(formatDate(post.createdAt))}</small>
      </span>
      <em>${escapeHtml(evidence.kind)}</em>
    </button>
  `).join("") || '<p class="empty">No agent receipts match the current filters.</p>';
}

function reviewSearchFilterLabel() {
  return state.query.trim() ? `search "${state.query.trim()}"` : "";
}

function receiptHeader(feed, title, scopeLabel = "", filterLabel = "") {
  return [
    title,
    scopeLabel ? `scope: ${scopeLabel}` : "",
    feed?.source ? `source: ${feed.source}` : "",
    feed?.generatedAt ? `generated: ${feed.generatedAt}` : "",
    filterLabel ? `filters: ${filterLabel}` : ""
  ];
}

function focusSummaryText(feed, scopeLabel = "", filterLabel = "") {
  const items = filteredFocusItems(feed);
  if (!items.length) return receiptHeader(feed, "Review Focus: no items", scopeLabel, filterLabel).filter(Boolean).join("\n");
  return [
    ...receiptHeader(feed, `Review Focus: ${items.length} ${items.length === 1 ? "item" : "items"}`, scopeLabel, filterLabel),
    ...items.map((item) => [
      `- ${(item.kind || "focus").toUpperCase()} / ${item.projectName}`,
      item.text,
      item.path || "no source path"
    ].join(" | "))
  ].filter(Boolean).join("\n");
}

function renderQa(feed) {
  const target = document.querySelector("#qa-list");
  const items = filteredQaItems(feed);
  const filterLabel = reviewSearchFilterLabel();
  document.querySelector("#qa-count").innerHTML = [
    items.length === 1 ? "1 issue" : `${items.length} issues`,
    filterLabel ? `<span class="qa-filter">Filtered by ${escapeHtml(filterLabel)}</span>` : ""
  ].filter(Boolean).join(" &middot; ");
  target.innerHTML = items.map((item, index) => `
    <button class="qa-item qa-${escapeHtml(item.severity)} ${selectedNotice("Import QA", item) ? "is-selected" : ""}" type="button" data-project-id="${escapeHtml(item.projectId)}" data-qa-index="${index}" aria-current="${selectedNotice("Import QA", item) ? "true" : "false"}">
      <span class="qa-severity">${escapeHtml(item.severity)}</span>
      <strong>${escapeHtml(item.projectName)}</strong>
      <p>${escapeHtml(item.text)}</p>
      <small>${escapeHtml(item.path || "no source path")}</small>
    </button>
  `).join("") || '<p class="empty">No import QA issues.</p>';
}

function qaSummaryText(feed, scopeLabel = "", filterLabel = "") {
  const items = filteredQaItems(feed);
  if (!items.length) return receiptHeader(feed, "Import QA: no issues", scopeLabel, filterLabel).filter(Boolean).join("\n");
  return [
    ...receiptHeader(feed, `Import QA: ${items.length} ${items.length === 1 ? "issue" : "issues"}`, scopeLabel, filterLabel),
    ...items.map((item) => [
      `- ${item.severity.toUpperCase()} / ${item.projectName} / ${item.kind || "issue"}`,
      item.text,
      item.path || "no source path"
    ].join(" | "))
  ].filter(Boolean).join("\n");
}

function selectedNotice(label, item) {
  return state.selectedNotice?.label === label && state.selectedNotice.item === item;
}

function renderProjects(feed) {
  const list = document.querySelector("#project-list");
  const counts = new Map();
  const query = state.query.trim().toLowerCase();
  const projects = feed.projects.filter((project) => state.lane === "all" || project.lane === state.lane);
  const filterLabel = ledgerFilterLabel();

  document.querySelector(".project-rail .panel-head").innerHTML = `
    <h2>Projects</h2>
    ${filterLabel ? `<span class="rail-filter">Filtered by ${escapeHtml(filterLabel)}</span>` : ""}
  `;

  filteredEvidenceRows(feed, query, true).forEach((row) => {
    counts.set(row.post.projectId, (counts.get(row.post.projectId) || 0) + 1);
  });

  list.innerHTML = [
    `
      <button class="project-row ${state.selectedProjectId ? "" : "is-selected"}" type="button" data-project-id="" aria-pressed="${state.selectedProjectId ? "false" : "true"}">
        <span class="avatar all">A</span>
        <span class="project-main">
          <strong>All projects</strong>
          <small>${escapeHtml(state.lane === "all" ? "Full proof stack" : state.lane)}</small>
        </span>
        <span class="project-count">${escapeHtml(activeProjectCount(feed, true))}</span>
      </button>
    `,
    ...projects.map((project) => {
      const stale = isStale(project);
      return `
        <button class="project-row ${stale ? "is-stale" : ""} ${state.selectedProjectId === project.id ? "is-selected" : ""}" type="button" data-project-id="${escapeHtml(project.id)}" aria-pressed="${state.selectedProjectId === project.id ? "true" : "false"}">
          <span class="avatar lane-${cssToken(project.lane)}">${escapeHtml(initials(project.name))}</span>
          <span class="project-main">
            <strong>${escapeHtml(project.name)}</strong>
            <small>${escapeHtml(project.lane)}</small>
          </span>
          <span class="project-meta">
            <em class="health-${cssToken(project.health)}"><i></i>${escapeHtml(project.health)}</em>
            <small>${escapeHtml(counts.get(project.id) || 0)}</small>
          </span>
        </button>
      `;
    })
  ].join("");
}

function renderSourceMeta(feed) {
  const receipt = importReceiptSummary(feed);
  document.querySelector("#source-meta").innerHTML = `
    <div class="receipt-head">
      <span>Import Receipt</span>
      <strong>${escapeHtml(receipt.source)}</strong>
      <small>${escapeHtml(receipt.generatedAt)}</small>
    </div>
    <div class="receipt-grid">
      <span><small>Projects</small><strong>${escapeHtml(receipt.projectCount)}</strong></span>
      <span><small>Evidence</small><strong>${escapeHtml(receipt.evidenceCount)}</strong></span>
      <span><small>Review</small><strong>${escapeHtml(receipt.focusCount)}</strong></span>
      <span><small>QA</small><strong>${escapeHtml(receipt.qaCount)}</strong></span>
      <span class="${receipt.redQaCount ? "bad" : ""}"><small>Red</small><strong>${escapeHtml(receipt.redQaCount)}</strong></span>
    </div>
    ${renderImportDelta()}
    ${renderRoadmap()}
  `;
}

function renderImportDelta() {
  const delta = state.importDelta?.delta || { status: "loading", changes: [] };
  const text = state.importDelta?.text || "Import delta: loading";
  const changeCount = Array.isArray(delta.changes) ? delta.changes.length : 0;
  return `
    <div class="delta-meta delta-${cssToken(delta.status)}">
      <div class="delta-head">
        <span>Import Delta</span>
        <strong>${escapeHtml(delta.status)}</strong>
      </div>
      <p>${escapeHtml(text)}</p>
      ${changeCount ? `<small>${escapeHtml(changeCount)} changed ${changeCount === 1 ? "field" : "fields"}</small>` : ""}
      <button class="copy-action delta-copy" type="button" data-copy-delta-detail>Copy details</button>
    </div>
  `;
}

function renderRoadmap() {
  const roadmap = state.roadmap;
  const next = roadmap?.next;
  if (!next) {
    return `
      <div class="delta-meta roadmap-meta">
        <div class="delta-head">
          <span>Roadmap Target</span>
          <strong>loading</strong>
        </div>
        <p>Roadmap target unavailable.</p>
        <button class="copy-action roadmap-copy" type="button" data-copy-roadmap-target>Copy target</button>
      </div>
    `;
  }
  return `
    <div class="delta-meta roadmap-meta">
      <div class="delta-head">
        <span>Roadmap Target</span>
        <strong>${escapeHtml(next.version)}</strong>
      </div>
      <p>${escapeHtml(next.title)}</p>
      ${next.target ? `<small>${escapeHtml(next.target)}</small>` : ""}
      <span class="roadmap-progress"><strong>${escapeHtml(roadmap.completedCount || 0)}</strong> completed versions tracked</span>
      ${renderRoadmapStatusTrack(roadmap.statusCounts)}
      ${roadmap.versionLadder?.length ? `
        <details class="roadmap-disclosure">
          <summary>Version ladder</summary>
          ${renderRoadmapLadder(roadmap.versionLadder)}
        </details>
      ` : ""}
      ${next.checks?.length ? `
        <span class="roadmap-gates">
          <strong>Gates</strong>
          ${next.checks.map((check) => `<code>${escapeHtml(check)}</code>`).join("")}
        </span>
      ` : ""}
      ${roadmap.recentCompleted?.length ? `
        <span class="roadmap-recent">
          <strong>Recent</strong>
          ${roadmap.recentCompleted.map((item) => `
            <span>
              <em>${escapeHtml(item.version)} ${escapeHtml(item.title)}</em>
              ${item.doneOn ? `<small>${escapeHtml(item.doneOn)}</small>` : ""}
            </span>
          `).join("")}
        </span>
      ` : ""}
      <button class="copy-action roadmap-copy" type="button" data-copy-roadmap-target>Copy target</button>
    </div>
  `;
}

function renderRoadmapStatusTrack(counts = {}) {
  const items = [
    ["complete", "Complete", counts.complete],
    ["active", "Active", counts.active],
    ["planned", "Planned", counts.planned],
    ["optional", "Optional", counts.optional]
  ].filter(([, , count]) => Number(count) > 0);
  if (!items.length) return "";
  return `
    <span class="roadmap-status-track" aria-label="Roadmap progress">
      ${items.map(([kind, label, count]) => `
        <span class="roadmap-status roadmap-status-${escapeHtml(cssToken(kind))}">
          <b>${escapeHtml(count)}</b>
          <small>${escapeHtml(label)}</small>
        </span>
      `).join("")}
    </span>
  `;
}

function renderRoadmapLadder(versions = []) {
  if (!versions.length) return "";
  return `
    <span class="roadmap-ladder">
      ${versions.map((item) => `
        <span class="roadmap-stage roadmap-stage-${escapeHtml(cssToken(item.statusKind))}">
          <b>${escapeHtml(item.version)}</b>
          <span>
            <em>${escapeHtml(item.title)}</em>
            ${item.status ? `<small class="roadmap-stage-status">${escapeHtml(item.status)}</small>` : ""}
          </span>
        </span>
      `).join("")}
    </span>
  `;
}

function roadmapTargetText(roadmap) {
  const next = roadmap?.next;
  if (!next) return [
    "Roadmap target: loading",
    "Source: docs/roadmap.md"
  ].join("\n");
  return [
    `Roadmap target: ${next.version} ${next.title}`,
    "Source: docs/roadmap.md",
    next.target ? `Target: ${next.target}` : "",
    roadmap.progressSummary ? `Progress: ${roadmap.progressSummary}` : "",
    `Completed versions tracked: ${roadmap.completedCount || 0}`,
    roadmap.statusCounts ? `Status counts: complete ${roadmap.statusCounts.complete || 0}, active ${roadmap.statusCounts.active || 0}, planned ${roadmap.statusCounts.planned || 0}, optional ${roadmap.statusCounts.optional || 0}` : "",
    ...(roadmap.versionLadder?.length ? [`Version ladder: ${roadmap.versionLadder.map((item) => `${item.version} ${item.status || item.title}`).join("; ")}`] : []),
    ...(roadmap.recentCompleted?.length ? [`Recent: ${roadmap.recentCompleted.map((item) => `${item.version} ${item.title}${item.doneOn ? ` (${item.doneOn})` : ""}`).join("; ")}`] : []),
    roadmap.lastCompleted ? `Last completed: ${roadmap.lastCompleted.version} ${roadmap.lastCompleted.title}` : "",
    next.checks?.length ? `Checks: ${next.checks.join(", ")}` : ""
  ].filter(Boolean).join("\n");
}

function renderFeed(feed) {
  const rows = filteredRows(feed);
  const filterLabel = ledgerFilterLabel();
  document.querySelector("#ledger-count").innerHTML = [
    `${rows.length} rows`,
    filterLabel ? `<span class="ledger-filter">Filtered by ${escapeHtml(filterLabel)}</span>` : ""
  ].filter(Boolean).join(" &middot; ");
  const target = document.querySelector("#feed");
  if (rows.length === 0) {
    target.innerHTML = '<p class="empty">No evidence matches the current filters.</p>';
    return;
  }

  target.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th>Evidence</th>
          <th>Kind / Status</th>
          <th>Source Path</th>
          <th>Updated</th>
          <th aria-label="Open detail"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ post, evidence, evidenceIndex, project }) => {
          const selected = state.selectedEvidence?.post.id === post.id
            && state.selectedEvidence?.evidence === evidence;
          return `
            <tr class="${selected ? "is-selected" : ""}" role="button" tabindex="0" aria-current="${selected ? "true" : "false"}" aria-label="Open evidence detail: ${escapeHtml(evidence.label)}" data-post-id="${escapeHtml(post.id)}" data-evidence-index="${evidenceIndex}">
              <td>
                <span class="project-cell">
                  <span class="mini-avatar lane-${cssToken(project?.lane)}">${escapeHtml(initials(project?.name))}</span>
                  <span>${escapeHtml(project?.name || post.projectId)}</span>
                </span>
              </td>
              <td>
                <strong>${escapeHtml(evidence.label)}</strong>
                <small>${escapeHtml(post.title)}</small>
              </td>
              <td>
                <span class="kind-label">${escapeHtml(evidence.kind)}</span>
                <mark class="status-${cssToken(evidence.status)}">${escapeHtml(evidence.status)}</mark>
              </td>
              <td class="path-cell">${escapeHtml(evidence.path)}</td>
              <td class="date-cell">${escapeHtml(formatDate(post.createdAt))}</td>
              <td><span class="row-arrow">&rsaquo;</span></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function ledgerFilterLabel() {
  return [
    state.kind !== "all" ? `kind ${state.kind}` : "",
    state.query.trim() ? `search "${state.query.trim()}"` : ""
  ].filter(Boolean).join(" / ");
}

function ledgerSummaryText(feed, scopeLabel = "", filterLabel = "") {
  if (!feed) return receiptHeader(feed, "Evidence Ledger: loading", scopeLabel, filterLabel).filter(Boolean).join("\n");
  const rows = filteredRows(feed);
  if (!rows.length) return receiptHeader(feed, "Evidence Ledger: no rows", scopeLabel, filterLabel).filter(Boolean).join("\n");
  return [
    ...receiptHeader(feed, `Evidence Ledger: ${rows.length} ${rows.length === 1 ? "row" : "rows"}`, scopeLabel, filterLabel),
    ...rows.map(({ post, evidence, project }) => [
      `- ${project?.name || post.projectId}`,
      `${evidence.kind} / ${evidence.status}`,
      evidence.label,
      evidence.path,
      formatDate(post.createdAt)
    ].join(" | "))
  ].filter(Boolean).join("\n");
}

function selectedProject(feed) {
  return state.selectedProjectId ? projectById(feed).get(state.selectedProjectId) : null;
}

function projectSourcePath(project) {
  return project?.review?.sourcePath || project?.statusFile || "";
}

function renderSourcePreview(path, preview) {
  const lineLabel = sourcePreviewScope(preview);
  return `
    <details class="source-preview">
      <summary class="source-preview-head">
        <span class="source-preview-title">
          <strong>Source preview</strong>
          ${lineLabel ? `<small class="source-preview-meta">${escapeHtml(lineLabel)}</small>` : ""}
        </span>
      </summary>
      <div class="source-preview-body">
        <span class="source-preview-actions">
          <a class="copy-action" href="/source?path=${encodeURIComponent(path)}" target="_blank" rel="noreferrer">Open source</a>
          <button class="copy-action" type="button" data-copy-source-path="${escapeHtml(path)}">Copy path</button>
          ${preview?.text ? '<button class="copy-action" type="button" data-copy-source-preview>Copy preview</button>' : ""}
        </span>
        ${preview?.loading ? '<p>Loading source...</p>' : ""}
        ${preview?.error ? `<p>${escapeHtml(preview.error)}</p>` : ""}
        ${preview?.text ? `<pre>${escapeHtml(preview.text)}</pre>${preview.truncated ? '<small>Preview truncated.</small>' : ""}` : ""}
      </div>
    </details>
  `;
}

function detailSummaryText(feed, scopeLabel = "", filterLabel = "") {
  if (!feed) return receiptHeader(feed, "Evidence Detail: loading", scopeLabel, filterLabel).filter(Boolean).join("\n");
  const project = selectedProject(feed);
  if (state.selectedEvidence) {
    const { post, evidence } = state.selectedEvidence;
    const evidenceProject = projectById(feed).get(post.projectId);
    const claim = evidenceProject?.claim || "";
    const distinctClaim = claim.trim() && claim.trim() !== String(post.body || "").trim();
    return [
      ...receiptHeader(feed, `Evidence Detail: ${evidence.label}`, scopeLabel, filterLabel),
      `Project: ${evidenceProject?.name || post.projectId}`,
      `Kind/status: ${evidence.kind} / ${evidence.status}`,
      `Post: ${post.title}`,
      distinctClaim ? `Claim: ${claim}` : "",
      `Proof: ${proofSummary(evidenceProject)}`,
      `Source: ${evidence.path}`,
      `Stop condition: ${evidenceProject?.review?.whatToStop || evidenceProject?.stopCondition || ""}`
    ].filter(Boolean).join("\n");
  }

  if (state.selectedNotice) {
    const { label, item } = state.selectedNotice;
    return [
      ...receiptHeader(feed, `Evidence Detail: ${label}`, scopeLabel, filterLabel),
      `Project: ${item.projectName}`,
      `Kind/status: ${item.kind || item.severity || "issue"}`,
      `Text: ${item.text}`,
      `Source: ${item.path || "no source path"}`
    ].filter(Boolean).join("\n");
  }

  if (project) {
    const sourcePath = projectSourcePath(project);
    return [
      ...receiptHeader(feed, `Project Detail: ${project.name}`, scopeLabel, filterLabel),
      `Lane/health: ${project.lane} / ${project.health}`,
      `Claim: ${project.claim}`,
      `Owner context: ${project.ownerContext || ""}`,
      `Deadline: ${project.deadline || "none"}`,
      `Proof: ${proofSummary(project)}`,
      `Success metric: ${project.successMetric || ""}`,
      `Stop condition: ${project.review?.whatToStop || project.stopCondition || ""}`,
      `Source: ${sourcePath}`
    ].filter(Boolean).join("\n");
  }

  if (filteredRows(feed).length === 0) return [
    ...receiptHeader(feed, "Evidence Detail: no evidence matches the current filters", scopeLabel, filterLabel)
  ].filter(Boolean).join("\n");
  const firstFocus = filteredFocusItems(feed)[0];
  if (!firstFocus) return receiptHeader(feed, "Evidence Detail: select a project or evidence row", scopeLabel, filterLabel).filter(Boolean).join("\n");
  return [
    ...receiptHeader(feed, "Evidence Detail: Review focus", scopeLabel, filterLabel),
    `Project: ${firstFocus.projectName}`,
    `Kind/status: ${firstFocus.kind}`,
    `Text: ${firstFocus.text}`,
    `Source: ${firstFocus.path || "no source path"}`
  ].filter(Boolean).join("\n");
}

function renderSourceDetail(feed) {
  const target = document.querySelector("#source-detail");
  const detailFilter = document.querySelector("#detail-filter");
  const filterLabel = ledgerFilterLabel();
  detailFilter.textContent = filterLabel ? `Filtered by ${filterLabel}` : "";
  detailFilter.hidden = !filterLabel;
  const project = selectedProject(feed);
  if (state.selectedEvidence) {
    const { post, evidence } = state.selectedEvidence;
    const evidenceProject = projectById(feed).get(post.projectId);
    const preview = state.sourcePreview;
    const claim = evidenceProject?.claim || "";
    const distinctClaim = claim.trim() && claim.trim() !== String(post.body || "").trim();
    target.innerHTML = `
      <div class="detail-block">
        <div class="detail-tags">
          <span>${escapeHtml(evidence.kind)}</span>
          <mark class="status-${cssToken(evidence.status)}">${escapeHtml(evidence.status)}</mark>
        </div>
        <h3>${escapeHtml(evidence.label)}</h3>
        <p class="detail-subtitle">${escapeHtml(post.title)}</p>
        <dl>
          <dt>Source</dt><dd>${escapeHtml(evidence.path)}</dd>
          <dt>Proof</dt><dd>${escapeHtml(proofSummary(evidenceProject))}</dd>
          <dt>Project</dt><dd>${escapeHtml(evidenceProject?.name || post.projectId)}</dd>
          <dt>Post body</dt><dd>${escapeHtml(post.body)}</dd>
          ${distinctClaim ? `<dt>Claim</dt><dd>${escapeHtml(claim)}</dd>` : ""}
          <dt>Stop condition</dt><dd>${escapeHtml(evidenceProject?.review?.whatToStop || evidenceProject?.stopCondition || "")}</dd>
        </dl>
        ${post.replies.length ? `
          <details class="reply-list">
            <summary>Post replies <small>${escapeHtml(post.replies.length)}</small></summary>
            ${post.replies.map((reply) => `
              <p>
                <span>${escapeHtml(reply.author)} / ${escapeHtml(formatDate(reply.createdAt))}</span>
                ${escapeHtml(reply.body)}
              </p>
            `).join("")}
          </details>
        ` : ""}
        ${renderSourcePreview(evidence.path, preview)}
      </div>
    `;
    return;
  }

  if (state.selectedNotice) {
    const { label, item } = state.selectedNotice;
    target.innerHTML = `
      <div class="detail-block">
        <div class="detail-tags">
          <span>${escapeHtml(label)}</span>
          <span>${escapeHtml(item.kind || item.severity || "issue")}</span>
        </div>
        <h3>${escapeHtml(item.projectName)}</h3>
        <p>${escapeHtml(item.text)}</p>
        <dl>
          <dt>Source</dt><dd>${escapeHtml(item.path || "no source path")}</dd>
        </dl>
        ${item.path ? renderSourcePreview(item.path, state.sourcePreview) : ""}
      </div>
    `;
    return;
  }

  if (project) {
    const sourcePath = projectSourcePath(project);
    target.innerHTML = `
      <div class="detail-block">
        <div class="detail-tags">
          <span>${escapeHtml(project.lane)}</span>
          <mark class="health-${cssToken(project.health)}">${escapeHtml(project.health)}</mark>
        </div>
        <h3>${escapeHtml(project.name)}</h3>
        <p class="detail-subtitle">${escapeHtml(project.role || "Project proof lane")}</p>
        <dl>
          <dt>Claim</dt><dd>${escapeHtml(project.claim)}</dd>
          <dt>Owner context</dt><dd>${escapeHtml(project.ownerContext || "")}</dd>
          <dt>Deadline</dt><dd>${escapeHtml(project.deadline || "none")}</dd>
          <dt>Proof</dt><dd>${escapeHtml(proofSummary(project))}</dd>
          <dt>Success metric</dt><dd>${escapeHtml(project.successMetric || "")}</dd>
          <dt>Stop condition</dt><dd>${escapeHtml(project.review?.whatToStop || project.stopCondition || "")}</dd>
          <dt>Source</dt><dd>${escapeHtml(sourcePath)}</dd>
        </dl>
        ${sourcePath ? renderSourcePreview(sourcePath, state.sourcePreview) : ""}
      </div>
    `;
    return;
  }

  if (filteredRows(feed).length === 0) {
    target.innerHTML = '<p class="empty">No evidence matches the current filters.</p>';
    return;
  }

  const firstFocus = filteredFocusItems(feed)[0];
  target.innerHTML = firstFocus ? `
    <div class="detail-block">
      <div class="detail-tags"><span>${escapeHtml(firstFocus.kind)}</span></div>
      <h3>${escapeHtml(firstFocus.projectName)}</h3>
      <p>${escapeHtml(firstFocus.text)}</p>
      <small>${escapeHtml(firstFocus.path)}</small>
    </div>
  ` : '<p class="empty">Select a project or evidence row.</p>';
}

function renderReview(feed) {
  document.querySelector("#review-scope").textContent = reviewScopeLabel(feed);
  document.querySelector("#review-output").textContent = weeklyExportText(feed);
}

function reviewScopeLabel(feed) {
  const scoped = scopedFeed(feed);
  const project = selectedProject(feed);
  const scope = project
    ? project.name
    : state.lane === "all"
      ? "All projects"
      : `${state.lane} lane`;
  const count = scoped.projects.length;
  return `${scope} / ${count} ${count === 1 ? "project" : "projects"}`;
}

function weeklyExportText(feed) {
  return feed ? reviewExport(scopedFeed(feed)) : "";
}

function weeklyExportCopyText(feed) {
  return reviewExportCopyText(scopedFeed(feed), reviewScopeLabel(feed));
}

function readShellFlag(key) {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeShellFlag(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function setMenuCollapsed(collapsed) {
  document.body.classList.toggle("menu-collapsed", collapsed);
  const toggle = document.querySelector("#menu-toggle");
  toggle?.setAttribute("aria-expanded", String(!collapsed));
  toggle?.setAttribute("aria-label", collapsed ? "Expand menu" : "Collapse menu");
  toggle?.setAttribute("title", collapsed ? "Expand menu" : "Collapse menu");
  writeShellFlag("halba:menu-collapsed", collapsed);
}

function setProjectsHidden(hidden) {
  document.body.classList.toggle("projects-hidden", hidden);
  document.querySelector("#projects-toggle")?.setAttribute("aria-pressed", String(!hidden));
  writeShellFlag("halba:projects-hidden", hidden);
}

function setInspectorHidden(hidden) {
  document.body.classList.toggle("inspector-hidden", hidden);
  document.querySelector("#inspector-toggle")?.setAttribute("aria-pressed", String(!hidden));
  writeShellFlag("halba:inspector-hidden", hidden);
}

function setActiveMenuLink(activeLink) {
  document.querySelectorAll("#side-menu [data-menu-section]").forEach((link) => {
    if (link === activeLink) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

async function copyWithFeedback(button, text) {
  if (!button || !text) return;
  const label = button.textContent;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => {
    button.textContent = label;
  }, 900);
}

function render() {
  renderSearch();
  renderSummary(state.feed);
  renderInfoboard(state.feed);
  renderReviewGate(state.feed);
  renderAgentWorkroom(state.feed);
  renderFocus(state.feed);
  renderQa(state.feed);
  renderLaneFilter(state.feed);
  renderKindFilter(state.feed);
  renderProjects(state.feed);
  renderSourceMeta(state.feed);
  renderFeed(state.feed);
  renderSourceDetail(state.feed);
  renderReview(state.feed);
}

function readStoredView() {
  try {
    return JSON.parse(localStorage.getItem(viewStorageKey) || "null") || {};
  } catch {
    return {};
  }
}

function persistViewState() {
  try {
    localStorage.setItem(viewStorageKey, JSON.stringify(snapshotView(state)));
  } catch {}
}

function clearEvidenceSelection() {
  state.selectedEvidence = null;
  state.selectedNotice = null;
  state.sourcePreview = null;
  state.sourcePreviewKey = null;
}

function selectProject(projectId) {
  state.selectedProjectId = projectId || null;
  state.lane = "all";
  if (!state.selectedProjectId) {
    refreshEvidenceSelection();
    return;
  }
  clearEvidenceSelection();
  persistViewState();
  render();
  const sourcePath = projectSourcePath(selectedProject(state.feed));
  if (sourcePath) loadSourcePreview(sourcePath);
}

function selectNotice(projectId, label, item) {
  state.selectedProjectId = projectId || null;
  state.lane = "all";
  clearEvidenceSelection();
  state.selectedNotice = { label, item };
  persistViewState();
  render();
  if (item.path) loadSourcePreview(item.path);
}

function scrollToTarget(selector) {
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  document.querySelector(selector)?.scrollIntoView({ block: "start", behavior });
}

function focusGateTarget(target) {
  if (target === "export") {
    scrollToTarget(".export-section");
    document.querySelector("#review-output")?.focus({ preventScroll: true });
    return;
  }

  if (target === "focus") {
    const item = filteredFocusItems(state.feed)[0];
    if (item) selectNotice(item.projectId, "Review focus", item);
    scrollToTarget("#source-detail");
    return;
  }

  if (target === "red-qa" || target === "amber-qa") {
    const severity = target === "red-qa" ? "red" : "amber";
    const item = filteredQaItems(state.feed).find((qa) => qa.severity === severity);
    if (item) selectNotice(item.projectId, "Import QA", item);
    scrollToTarget("#source-detail");
    return;
  }

  if (target === "stale") {
    const project = visibleProjects(state.feed).find((item) => isStale(item));
    if (project) selectProject(project.id);
    scrollToTarget("#source-detail");
  }
}

async function loadSourcePreview(path) {
  const key = path || "";
  state.sourcePreviewKey = key;
  state.sourcePreview = { loading: true };
  renderSourceDetail(state.feed);

  try {
    const response = await fetch(`/api/source?path=${encodeURIComponent(key)}`);
    const body = await response.json();
    if (state.sourcePreviewKey !== key) return;
    state.sourcePreview = response.ok
      ? { text: body.text, lineCount: body.lineCount, truncated: body.truncated }
      : { error: body.error || "Source preview unavailable." };
  } catch {
    if (state.sourcePreviewKey !== key) return;
    state.sourcePreview = { error: "Source preview unavailable." };
  }
  renderSourceDetail(state.feed);
}

function selectInitialEvidence(feed) {
  const rows = filteredRows(feed);
  const row = rows.find((item) => item.evidence.kind === "metric") || rows[0];
  if (!row) return "";
  state.selectedEvidence = { post: row.post, evidence: row.evidence, evidenceIndex: row.evidenceIndex };
  return row.evidence.path;
}

function refreshEvidenceSelection() {
  clearEvidenceSelection();
  const sourcePath = selectInitialEvidence(state.feed);
  persistViewState();
  render();
  if (sourcePath) loadSourcePreview(sourcePath);
}

function restoreViewState(feed) {
  const saved = normalizeSavedView(feed, readStoredView());
  state.lane = saved.lane;
  state.kind = saved.kind;
  state.query = saved.query;
  state.selectedProjectId = saved.selectedProjectId;
  clearEvidenceSelection();

  if (saved.selection?.type === "project") {
    state.selectedProjectId = saved.selection.projectId;
    return projectSourcePath(selectedProject(feed));
  }

  const savedEvidence = findSavedEvidence(filteredRows(feed), saved.selection);
  if (savedEvidence) {
    state.selectedEvidence = {
      post: savedEvidence.post,
      evidence: savedEvidence.evidence,
      evidenceIndex: savedEvidence.evidenceIndex
    };
    return savedEvidence.evidence.path;
  }

  const savedNotice = findSavedNotice(feed, saved.selection);
  if (savedNotice) {
    state.selectedProjectId = savedNotice.projectId || null;
    state.selectedNotice = { label: saved.selection.label, item: savedNotice };
    return savedNotice.path || "";
  }

  return selectInitialEvidence(feed);
}

document.querySelector("#lane-filter").addEventListener("change", (event) => {
  state.lane = event.target.value;
  state.selectedProjectId = null;
  refreshEvidenceSelection();
});

document.querySelector("#kind-filter").addEventListener("change", (event) => {
  state.kind = event.target.value;
  refreshEvidenceSelection();
});

document.querySelector("#search").addEventListener("input", (event) => {
  state.query = event.target.value;
  refreshEvidenceSelection();
});

document.querySelector("#clear-selection").addEventListener("click", () => selectProject(null));

document.querySelector("[data-focus-toggle]").addEventListener("click", (event) => {
  state.focusExpanded = !state.focusExpanded;
  event.currentTarget.blur();
  render();
});

setMenuCollapsed(readShellFlag("halba:menu-collapsed"));
setProjectsHidden(readShellFlag("halba:projects-hidden"));
setInspectorHidden(readShellFlag("halba:inspector-hidden"));

document.querySelector("#menu-toggle").addEventListener("click", () => {
  setMenuCollapsed(!document.body.classList.contains("menu-collapsed"));
});

document.querySelector("#projects-toggle").addEventListener("click", () => {
  setProjectsHidden(!document.body.classList.contains("projects-hidden"));
});

document.querySelector("#inspector-toggle").addEventListener("click", () => {
  setInspectorHidden(!document.body.classList.contains("inspector-hidden"));
});

document.querySelector("#side-menu").addEventListener("click", (event) => {
  const link = event.target.closest("[data-scroll-target]");
  if (!link) return;
  event.preventDefault();
  setActiveMenuLink(link);
  scrollToTarget(link.dataset.scrollTarget);
});

document.querySelector("[data-copy-focus-summary]").addEventListener("click", (event) => {
  copyWithFeedback(event.currentTarget, focusSummaryText(state.feed, reviewScopeLabel(state.feed), reviewSearchFilterLabel()));
});

document.querySelector("#review-gate").addEventListener("click", (event) => {
  const copyButton = event.target.closest("[data-copy-gate-receipt]");
  if (copyButton) {
    const { gateFeed, gate } = gateContext(state.feed);
    copyWithFeedback(copyButton, reviewGateReceipt(gateFeed, {
      visibleFocusCount: gate.visibleFocusCount,
      scopeLabel: reviewScopeLabel(state.feed),
      filterLabel: reviewSearchFilterLabel()
    }));
    return;
  }
  const button = event.target.closest("[data-gate-target]");
  if (!button || button.disabled) return;
  focusGateTarget(button.dataset.gateTarget);
});

document.querySelector("#source-meta").addEventListener("click", async (event) => {
  const roadmapButton = event.target.closest("[data-copy-roadmap-target]");
  if (roadmapButton) {
    await copyWithFeedback(roadmapButton, roadmapTargetText(state.roadmap));
    return;
  }
  const button = event.target.closest("[data-copy-delta-detail]");
  if (!button) return;
  await copyWithFeedback(button, importDeltaCopyText(state.feed, state.importDelta?.detailText || state.importDelta?.text || "Import delta: loading"));
});

document.querySelector("#project-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-project-id]");
  if (button) selectProject(button.dataset.projectId);
});

document.querySelector("#infoboard").addEventListener("click", (event) => {
  const resetButton = event.target.closest("[data-board-reset]");
  if (resetButton && !resetButton.disabled) {
    state.lane = "all";
    state.kind = "all";
    state.query = "";
    state.selectedProjectId = null;
    refreshEvidenceSelection();
    scrollToTarget("#infoboard");
    return;
  }

  const targetButton = event.target.closest("[data-board-target]");
  if (targetButton && !targetButton.disabled) {
    focusGateTarget(targetButton.dataset.boardTarget);
    return;
  }

  const laneButton = event.target.closest("[data-board-lane]");
  if (laneButton) {
    state.lane = state.lane === laneButton.dataset.boardLane ? "all" : laneButton.dataset.boardLane;
    state.selectedProjectId = null;
    refreshEvidenceSelection();
    scrollToTarget("#feed");
    return;
  }

  const kindButton = event.target.closest("[data-board-kind]");
  if (kindButton) {
    state.kind = state.kind === kindButton.dataset.boardKind ? "all" : kindButton.dataset.boardKind;
    refreshEvidenceSelection();
    scrollToTarget("#feed");
    return;
  }

  selectEvidenceRow(event.target.closest("[data-post-id]"));
});

document.querySelector("#agent-list").addEventListener("click", (event) => {
  selectEvidenceRow(event.target.closest("[data-post-id]"));
});

document.querySelector("#focus-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-project-id]");
  if (!button) return;
  const item = filteredFocusItems(state.feed)[Number(button.dataset.focusIndex)];
  if (item) selectNotice(button.dataset.projectId, "Review focus", item);
});

document.querySelector("#qa-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-project-id]");
  if (!button) return;
  const item = filteredQaItems(state.feed)[Number(button.dataset.qaIndex)];
  if (item) selectNotice(button.dataset.projectId, "Import QA", item);
});

document.querySelector("[data-copy-qa-summary]").addEventListener("click", (event) => {
  copyWithFeedback(event.currentTarget, qaSummaryText(state.feed, reviewScopeLabel(state.feed), reviewSearchFilterLabel()));
});

function selectEvidenceRow(row) {
  if (!row) return;
  const post = state.feed.posts.find((item) => item.id === row.dataset.postId);
  const evidence = post?.evidence[Number(row.dataset.evidenceIndex)];
  if (!post || !evidence) return;
  state.selectedEvidence = { post, evidence, evidenceIndex: Number(row.dataset.evidenceIndex) };
  state.selectedNotice = null;
  state.sourcePreview = null;
  state.sourcePreviewKey = null;
  persistViewState();
  render();
  loadSourcePreview(evidence.path);
}

document.querySelector("#feed").addEventListener("click", (event) => {
  selectEvidenceRow(event.target.closest("[data-post-id]"));
});

document.querySelector("#feed").addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const row = event.target.closest("[data-post-id]");
  if (!row) return;
  event.preventDefault();
  selectEvidenceRow(row);
});

document.querySelector("[data-copy-ledger-summary]").addEventListener("click", (event) => {
  copyWithFeedback(event.currentTarget, ledgerSummaryText(state.feed, reviewScopeLabel(state.feed), ledgerFilterLabel()));
});

document.querySelector("#source-detail").addEventListener("click", async (event) => {
  const pathButton = event.target.closest("[data-copy-source-path]");
  const previewButton = event.target.closest("[data-copy-source-preview]");
  const text = pathButton?.dataset.copySourcePath || (previewButton ? sourcePreviewCopyText(state.sourcePreviewKey, state.sourcePreview) : "");
  await copyWithFeedback(pathButton || previewButton, text);
});

document.querySelector("[data-copy-detail-summary]").addEventListener("click", (event) => {
  copyWithFeedback(event.currentTarget, detailSummaryText(state.feed, reviewScopeLabel(state.feed), ledgerFilterLabel()));
});

document.querySelector("#export-review").addEventListener("click", () => {
  copyWithFeedback(document.querySelector("#export-review"), weeklyExportCopyText(state.feed));
});

document.querySelector("[data-copy-weekly-export]").addEventListener("click", (event) => {
  copyWithFeedback(event.currentTarget, weeklyExportCopyText(state.feed));
});

fetch("/api/feed")
  .then((response) => response.json())
  .then((feed) => {
    state.feed = feed;
    const sourcePath = restoreViewState(feed);
    persistViewState();
    render();
    if (sourcePath) loadSourcePreview(sourcePath);
  });

fetch("/api/import-delta")
  .then((response) => response.json())
  .then((delta) => {
    state.importDelta = delta;
    if (state.feed) renderSourceMeta(state.feed);
  })
  .catch(() => {
    state.importDelta = {
      delta: { status: "unavailable", changes: [] },
      text: "Import delta: unavailable"
    };
    if (state.feed) renderSourceMeta(state.feed);
  });

fetch("/api/roadmap")
  .then((response) => response.json())
  .then((roadmap) => {
    state.roadmap = roadmap;
    if (state.feed) renderSourceMeta(state.feed);
  })
  .catch(() => {
    state.roadmap = { next: null, lastCompleted: null };
    if (state.feed) renderSourceMeta(state.feed);
  });

export { filteredPosts, importReceiptSummary, isStale, latestPostTime, reviewExport, reviewExportCopyText, reviewGateReceipt, reviewGateSummary };
