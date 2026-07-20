import { validateImportedWorkspace } from "./workspace-import.js";
import { decisionClosesGate, shouldAdvanceReviewSelection } from "./workspace-state.js";
import {
  createReviewDecision,
  evidenceIdentity,
  reviewDecisionKey,
  reviewDecisionMatches
} from "./shared/review-contract.js";
import { filterTrustItems, trustInboxFilters, trustInboxSummary, trustPrimaryReason, trustReasonLabel, validateTrustOperationsReport } from "./trust-inbox.js";

const decisionStorageKey = "halba:proof-decisions:v2";
const workspaceUiStorageKey = "halba:workspace-ui:v1";
const activeWorkspaceStorageKey = "halba:active-workspace:v1";
const trustCheckpointStorageKey = "halba:trust-checkpoint:v1";
const workspaceRunRenderLimit = 100;

const state = {
  phase: "boot",
  bundle: null,
  workspace: null,
  workspaces: [],
  importReceipts: [],
  importReceipt: null,
  recentDecisions: null,
  operatorPanelStatus: "idle",
  operatorPanelError: null,
  claimHistory: null,
  proof: null,
  error: null,
  activeRunMode: null,
  selectedClaimId: null,
  selectedCitationIndex: 0,
  source: null,
  sourceStatus: "idle",
  sourceError: null,
  reviewError: null,
  filter: "review",
  mobileView: "summary",
  decisions: readDecisions(),
  selectedThreadId: null,
  activeProofThreadId: null,
  workspaceScope: { kind: "channel", id: null },
  workspaceFilter: "all",
  workspaceQuery: "",
  workspaceNotice: null,
  workspaceImported: false,
  durableState: false,
  trustOperations: null,
  trustStatus: "idle",
  trustError: null,
  trustFilter: "all",
  trustCheckpointAt: readTrustCheckpoint(),
  announcement: ""
};

let sourceRequest = 0;
let staticDemoRequest = null;

const staticDemoMode = document.documentElement.dataset.staticDemo === "true";

const app = document.querySelector("#app");
const statusRegion = document.querySelector("#status-region");
const executionBadge = document.querySelector("#execution-badge");
const mobileTabs = document.querySelector("#mobile-tabs");

initialize();

async function initialize() {
  render();
  try {
    const runtime = await requestRuntime();
    state.durableState = runtime.durableState;
    if (state.durableState) {
      state.workspaces = await requestWorkspaces();
      const savedWorkspaceId = readActiveWorkspace();
      const route = readRoute();
      const requestedWorkspaceId = route.workspaceId || savedWorkspaceId;
      const workspaceId = state.workspaces.some((workspace) => workspace.id === requestedWorkspaceId) ? requestedWorkspaceId : state.workspaces[0]?.id;
      if (!workspaceId) throw new Error("No durable workspace has been imported yet.");
      await loadWorkspaceState(await requestWorkspace(workspaceId));
      persistActiveWorkspace(workspaceId);
      await refreshTrustOperations();
      state.phase = "ready";
      await applyInitialRoute(route);
    } else {
      await loadWorkspaceState(await requestWorkspace());
      state.phase = "ready";
    }
  } catch (error) {
    state.phase = "error";
    state.error = {
      code: "workspace_unavailable",
      message: error.message || "The public agent workspace could not be loaded."
    };
  }
  render();
}

async function loadWorkspaceState(workspace, { resetUi = false } = {}) {
  state.workspace = workspace;
  state.bundle = null;
  state.proof = null;
  state.activeProofThreadId = null;
  state.claimHistory = null;
  state.importReceipts = [];
  state.importReceipt = null;
  state.recentDecisions = null;
  state.operatorPanelStatus = "idle";
  state.operatorPanelError = null;
  if (state.durableState) {
    state.decisions = {};
    [state.claimHistory, state.importReceipts] = await Promise.all([
      requestClaimHistory(workspace.workspace.id),
      requestImportReceipts(workspace.workspace.id),
      hydrateDurableDecisions()
    ]);
  }
  hydrateWorkspaceUi({ reset: resetUi });
  const selectedThread = workspace.threads.find((thread) => thread.id === state.selectedThreadId);
  const proofThread = selectedThread?.proofState === "ready" && selectedThread.proofBundleId
    ? selectedThread
    : workspace.threads.find((thread) => thread.proofState === "ready" && thread.proofBundleId);
  state.bundle = proofThread ? await requestBundle(proofThread.proofBundleId) : null;
}

function render() {
  document.body.dataset.phase = state.phase;
  document.body.dataset.mobileView = state.mobileView;
  app.setAttribute("aria-busy", String(state.phase === "boot" || state.phase === "loading"));
  updateHeader();

  if (state.phase === "boot") app.innerHTML = renderBoot();
  if (state.phase === "ready") app.innerHTML = renderOnboarding();
  if (state.phase === "loading") app.innerHTML = renderLoading();
  if (state.phase === "error") app.innerHTML = renderError();
  if (state.phase === "proof") app.innerHTML = renderProof();
}

function updateHeader() {
  const proofReady = state.phase === "proof";
  mobileTabs.hidden = !proofReady;

  const execution = state.proof?.execution;
  executionBadge.className = `execution-badge${execution ? ` mode-${execution.mode}` : ""}`;
  const executionLabel = { recorded: "Recorded replay", imported: "Imported adjudication", live: "Live response" }[execution?.mode];
  executionBadge.textContent = execution
    ? `${executionLabel || execution.mode} · ${execution.model}`
    : state.durableState ? "Durable local state" : "Public demo";

  for (const step of document.querySelectorAll("[data-process-step]")) {
    const name = step.dataset.processStep;
    const current = (
      (state.phase === "ready" && name === "workspace")
      || (state.phase === "loading" && name === "thread")
      || (state.phase === "proof" && name === "proof")
    );
    const complete = (
      (state.phase === "loading" && name === "workspace")
      || (state.phase === "proof" && ["workspace", "thread"].includes(name))
    );
    step.classList.toggle("is-current", current);
    step.classList.toggle("is-complete", complete);
  }

  for (const tab of document.querySelectorAll("[data-mobile-view]")) {
    tab.setAttribute("aria-pressed", String(tab.dataset.mobileView === state.mobileView));
  }

  statusRegion.textContent = state.phase === "loading"
    ? `${state.activeRunMode === "live" ? "Running live GPT-5.6 Sol" : "Replaying recorded GPT-5.6 Sol output"} and validating citations.`
    : state.announcement;
}

function renderBoot() {
  return `
    <section class="boot-state" aria-label="Loading Halba">
      <span class="boot-mark" aria-hidden="true"></span>
      <p>Indexing the public proof bundle…</p>
    </section>
  `;
}

function renderOnboarding() {
  const workspace = state.workspace.workspace;
  const visibleThreads = visibleWorkspaceThreads();
  const threads = visibleThreads.slice(0, workspaceRunRenderLimit);
  const thread = selectedWorkspaceThread(visibleThreads);
  const scope = workspaceScopeDetails();
  const operatorView = state.durableState && ["trust", "receipt", "decisions"].includes(state.workspaceScope.kind);
  const trustView = operatorView && state.workspaceScope.kind === "trust";
  const trustSummary = trustInboxSummary(state.trustOperations);
  const attentionCount = workspaceTotalAttention();
  const openReviewCount = workspaceOpenReviewCount();
  const latestReceipt = state.importReceipts[0];
  const importIssueCount = state.importReceipts.filter((receipt) => receipt.status === "degraded" || receipt.warnings.length > 0).length;
  return `
    <section class="workspace-shell">
      <aside class="workspace-rail" aria-label="${escapeHtml(workspace.name)} workspace">
        <div class="workspace-switcher">
          <span class="workspace-mark">${escapeHtml(initials(workspace.name))}</span>
          <div><strong>${escapeHtml(workspace.name)}</strong><small>${state.workspaceImported ? "Imported browser session" : state.durableState ? "Durable local workspace" : "Public-safe local sample"}</small>${state.durableState && state.workspaces.length > 1 ? `<label class="workspace-select"><span class="sr-only">Active workspace</span><select data-workspace-select>${state.workspaces.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === workspace.id ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>` : ""}</div>
          <span class="local-dot">Local</span>
        </div>

        <nav class="workspace-nav" aria-label="Workspace navigation">
          <p>Attention</p>
          ${state.durableState ? workspaceNavButton({ kind: "trust", id: "inbox", iconName: trustSummary.attention ? "guard" : "check", label: "Trust Inbox", count: trustSummary.attention, meta: `Across ${trustSummary.workspaceCount} workspaces`, alert: trustSummary.attention > 0 }) : ""}
          ${state.durableState ? workspaceNavButton({ kind: "decisions", id: "recent", iconName: "trace", label: "Recent decisions", meta: "Current state + history" }) : ""}
          ${workspaceNavButton({ kind: "attention", id: "review", iconName: openReviewCount ? "alert" : "check", label: openReviewCount ? "Needs review" : "Review complete", count: openReviewCount, alert: openReviewCount > 0 })}
          ${workspaceNavButton({ kind: "attention", id: "stale", iconName: workspaceStaleCount() ? "clock" : "check", label: "Stale claims", count: workspaceStaleCount(), alert: workspaceStaleCount() > 0 })}
          <p>Channels</p>
          ${state.workspace.channels.map((channel) => workspaceNavButton({ kind: "channel", id: channel.id, hash: true, label: channel.name, count: state.workspace.threads.filter((item) => item.channelId === channel.id).length })).join("")}
          <p>Agents</p>
          ${state.workspace.agents.map((agent) => { const count = state.workspace.threads.filter((item) => item.agentId === agent.id).length; return workspaceNavButton({ kind: "agent", id: agent.id, initial: agent.initial, label: agent.name, meta: `${count} ${pluralize(count, "run")}` }); }).join("")}
        </nav>

        <div class="workspace-boundary">
          ${icon("guard")}
          <p><strong>Source stays local</strong><span>Agent claims are not proof.</span></p>
        </div>
        <button class="workspace-import" type="button" data-import-workspace>${icon("download")}<span><strong>Import workspace JSON</strong><small>Validated in this browser only</small></span></button>
        ${state.durableState && !state.workspaceImported ? `<button class="workspace-import" type="button" data-refresh-workspace>${icon("pulse")}<span><strong>Refresh local state</strong><small>${latestReceipt ? `${importIssueCount ? `${importIssueCount} degraded ${pluralize(importIssueCount, "receipt")} · ` : ""}latest ${escapeHtml(latestReceipt.adapter)} · ${escapeHtml(latestReceipt.status)}` : "No import receipt"}</small></span></button>` : ""}
        ${state.durableState && !state.workspaceImported ? `<a class="workspace-import" href="/api/weekly-review?${new URLSearchParams({ workspaceId: workspace.id, format: "markdown" })}" download="halba-${escapeHtml(workspace.id)}-weekly-review.md">${icon("download")}<span><strong>Export weekly review</strong><small>Runs, gates, stale proof, decisions</small></span></a>` : ""}
      </aside>

      <main id="main-content" class="channel-thread" tabindex="-1">
        ${state.workspaceNotice ? `<div class="workspace-notice notice-${escapeHtml(state.workspaceNotice.tone)}" role="status">${icon(state.workspaceNotice.tone === "error" ? "alert" : "check")}<span>${escapeHtml(state.workspaceNotice.message)}</span><button type="button" data-dismiss-notice aria-label="Dismiss">×</button></div>` : ""}
        ${operatorView ? state.workspaceScope.kind === "receipt" ? renderImportReceipt() : state.workspaceScope.kind === "decisions" ? renderRecentDecisions() : renderTrustInbox() : `
        <header class="channel-head">
          <div>
            <p class="eyebrow">${escapeHtml(scope.eyebrow)}</p>
            <h1>${scope.kind === "channel" ? "<span>#</span>" : ""}${escapeHtml(scope.title)}</h1>
            <p>${escapeHtml(scope.description)}</p>
          </div>
          <span class="channel-status${attentionCount ? "" : " is-complete"}"><i></i>${attentionCount ? `${attentionCount} ${pluralize(attentionCount, "item")} ${attentionCount === 1 ? "needs" : "need"} attention` : "Review complete"}</span>
        </header>

        <section class="workspace-toolbar" aria-label="Run controls">
          <label class="workspace-search">${icon("search")}<input type="search" data-workspace-search placeholder="Search runs and evidence" value="${escapeHtml(state.workspaceQuery)}" aria-label="Search runs and evidence"></label>
          <div class="workspace-filters" aria-label="Filter runs">
            ${workspaceFilterButton("all", "All")}
            ${workspaceFilterButton("review", "Needs review")}
            ${workspaceFilterButton("completed", "Completed")}
          </div>
        </section>

        ${visibleThreads.length > workspaceRunRenderLimit ? `<p class="workspace-limit" role="status">Showing the newest ${workspaceRunRenderLimit} of ${visibleThreads.length} matching runs. Search or filter to narrow the local index.</p>` : ""}

        ${threads.length ? `
          <div class="run-index" role="list" aria-label="Runs in this view">
            ${threads.map(renderRunIndexItem).join("")}
          </div>
          ${renderSelectedThread(thread)}
        ` : renderEmptyWorkspace()}
        `}
      </main>

      ${operatorView ? trustView ? renderTrustSummary() : renderOperatorBoundary() : renderRunInspector(thread)}
    </section>
  `;
}

function workspaceNavButton({ kind, id, iconName, hash = false, initial, label, count, meta, alert = false }) {
  const active = state.workspaceScope.kind === kind && state.workspaceScope.id === id;
  const leading = hash ? '<span class="channel-hash">#</span>' : initial ? `<span class="agent-presence">${escapeHtml(initial)}</span>` : icon(iconName);
  return `<button class="workspace-nav-item${active ? " is-active" : ""}${alert ? " is-alert" : ""}${!alert && kind === "attention" ? " is-complete" : ""}" type="button" data-workspace-scope="${escapeHtml(kind)}" data-workspace-scope-id="${escapeHtml(id)}" aria-pressed="${active}">${leading}<span>${escapeHtml(label)}</span>${Number.isInteger(count) ? `<strong>${count}</strong>` : `<small>${escapeHtml(meta || "")}</small>`}</button>`;
}

function workspaceFilterButton(value, label) {
  return `<button type="button" data-workspace-filter="${value}" aria-pressed="${state.workspaceFilter === value}">${label}</button>`;
}

function renderRunIndexItem(thread) {
  const agent = workspaceAgent(thread.agentId);
  const openCount = workspaceAttentionCount(thread);
  const selected = thread.id === state.selectedThreadId;
  return `
    <div class="run-index-entry" role="listitem"><button class="run-index-item status-${escapeHtml(thread.status)}${selected ? " is-selected" : ""}" type="button" data-thread-id="${escapeHtml(thread.id)}" aria-pressed="${selected}">
      <span class="agent-presence">${escapeHtml(agent.initial)}</span>
      <span class="run-index-copy"><strong>${escapeHtml(thread.title)}</strong><small>${escapeHtml(agent.name)} · ${formatRelativeDate(thread.updatedAt)}</small></span>
      <span class="run-index-status">${openCount ? `${openCount} open` : threadStatusLabel(thread.status)}</span>
    </button></div>
  `;
}

function renderSelectedThread(thread) {
  const agent = workspaceAgent(thread.agentId);
  const timestamp = thread.completedAt || thread.updatedAt;
  return `
    <div class="thread-date"><span>${escapeHtml(agent.name)} run · ${formatTimestamp(timestamp)}</span></div>
    <article class="agent-thread-card">
      <div class="agent-avatar" aria-hidden="true">${escapeHtml(agent.initial)}</div>
      <div class="agent-thread-body">
        <header>
          <div><strong>${escapeHtml(agent.name)}</strong><span>${escapeHtml(agent.role)}</span></div>
          <time datetime="${escapeHtml(timestamp)}">${formatTime(timestamp)}</time>
        </header>
        <h2 class="agent-run-title">${escapeHtml(thread.title)}</h2>
        <p class="agent-message">${escapeHtml(thread.summary)}</p>
        <ol class="run-timeline" aria-label="Agent run events">
          ${thread.events.map((event) => `<li class="${eventNeedsReview(event.type) ? "is-review" : "is-complete"}">${icon(eventIcon(event.type))}<div><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail)}</span></div><time datetime="${escapeHtml(event.at)}">${formatTime(event.at)}</time></li>`).join("")}
        </ol>
        ${renderThreadHistoryWarning(thread)}
        ${renderThreadHandoff(thread)}
      </div>
    </article>
  `;
}

function renderThreadHandoff(thread) {
  const openCount = workspaceAttentionCount(thread);
  if (threadProofAvailable(thread)) {
    return `
      <section class="proof-handoff">
        <div class="proof-handoff-head"><span class="proof-seal">${icon("guard")}</span><div><p class="eyebrow">Proof handoff</p><h2>Agent says “done.” Halba asks for proof.</h2></div></div>
        <p>GPT-5.6 extracted atomic claims. Deterministic guards checked exact paths, line ranges, freshness, receipts, and contradictions before routing unresolved gates to a human.</p>
        <div class="handoff-metrics"><span><strong>${thread.verdictCounts.supported}</strong> verified</span><span><strong>${thread.verdictCounts.contradictory}</strong> contradiction</span><span><strong>${openCount}</strong> open gates</span></div>
        <button class="button button-primary button-large" type="button" data-run-mode="recorded" data-proof-thread="${escapeHtml(thread.id)}">${icon("trace", "button-icon")}<span class="button-copy"><strong>Open Proof Mode</strong><span>Trace every claim to exact evidence</span></span></button>
      </section>
    `;
  }
  const unavailable = thread.proofState === "ready";
  return `
    <section class="run-outcome${unavailable ? " is-unavailable" : ""}">
      <span class="run-outcome-mark">${icon(unavailable ? "alert" : "check")}</span>
      <div><p class="eyebrow">${unavailable ? "Proof packet unavailable" : "Deterministic run receipt"}</p><h2>${unavailable ? "Load the matching evidence bundle to inspect these claims." : "This run closed without a human evidence gate."}</h2><p>${unavailable ? "The imported workspace remains navigable, but Halba will not pretend that a different local bundle proves it." : "No completion claim from this operational run was handed to Proof Mode. Its typed event history remains inspectable here."}</p></div>
    </section>
  `;
}

function renderThreadHistoryWarning(thread) {
  const staleClaims = threadStaleClaims(thread);
  if (!staleClaims.length) return "";
  const reasons = [...new Set(staleClaims.flatMap((claim) => claim.reasons))];
  return `<section class="history-warning" role="status">${icon("clock")}<div><p class="eyebrow">History check</p><h2>${staleClaims.length} ${pluralize(staleClaims.length, "claim")} need fresh proof</h2><p>${escapeHtml(reasons[0] || "A newer run or the proof-age policy made this evidence stale.")}</p></div></section>`;
}

function renderRunInspector(thread) {
  const agent = workspaceAgent(thread.agentId);
  const channel = state.workspace.channels.find((item) => item.id === thread.channelId);
  const openCount = workspaceAttentionCount(thread);
  const proofAvailable = threadProofAvailable(thread);
  return `
    <aside class="run-inspector" aria-label="Selected agent run">
      <div class="run-inspector-head"><p class="eyebrow">Selected run</p><span class="mode-pill ${proofAvailable ? "mode-recorded" : "mode-local"}">${proofAvailable ? "Proof ready" : "Local receipt"}</span></div>
      <h2>${escapeHtml(thread.title)}</h2>
      <p class="run-goal">${escapeHtml(thread.goal)}</p>
      <dl class="workspace-run-meta">
        <div><dt>Channel</dt><dd><span class="channel-hash">#</span>${escapeHtml(channel.name)}</dd></div>
        <div><dt>Agent</dt><dd><span class="agent-presence">${escapeHtml(agent.initial)}</span>${escapeHtml(agent.name)}</dd></div>
        <div><dt>Status</dt><dd class="${openCount ? "attention-value" : ""}">${openCount ? `${openCount} need review` : threadStatusLabel(thread.status)}</dd></div>
        <div><dt>Events</dt><dd>${thread.events.length} typed</dd></div>
        <div><dt>Claims</dt><dd>${thread.claimCount ? `${thread.claimCount} extracted` : "None handed off"}</dd></div>
        <div><dt>Duration</dt><dd>${formatDuration(thread.startedAt, thread.completedAt || thread.updatedAt)}</dd></div>
      </dl>
      ${proofAvailable ? `
        <section class="source-manifest"><h3>Attached evidence</h3><ul>${state.bundle.sources.slice(0, 4).map((source) => `<li>${sourceKindIcon(source.kind)}<span><strong>${escapeHtml(source.label)}</strong><small>${escapeHtml(shortPath(source.path))}</small></span></li>`).join("")}</ul><small>+ ${Math.max(0, state.bundle.sourceCount - 4)} more in Proof Mode</small></section>
        <button class="button button-primary" type="button" data-run-mode="recorded" data-proof-thread="${escapeHtml(thread.id)}">${icon("trace", "button-icon")}Open recorded proof</button>
        <button class="button button-secondary" type="button" data-run-mode="live" data-proof-thread="${escapeHtml(thread.id)}">${icon("pulse", "button-icon")}Run live locally</button>
      ` : `<section class="inspector-events"><h3>Run receipt</h3>${thread.events.map((event) => `<div>${icon(eventIcon(event.type))}<span><strong>${escapeHtml(event.title)}</strong><small>${formatTime(event.at)}</small></span></div>`).join("")}</section>`}
      <p class="mode-disclosure">${state.workspaceImported ? "Imported data stays in this browser session and is never uploaded." : state.durableState ? "Review decisions are evidence-scoped and persisted in local Halba state." : "The public sample is synthetic and bounded. Only the selected proof-ready run can open the checked-in evidence packet."}</p>
    </aside>
  `;
}

function renderEmptyWorkspace() {
  return `<section class="workspace-empty"><span>${icon("search")}</span><h2>No runs match this view.</h2><p>Clear the search or choose a different status, channel, or agent.</p><button class="text-action" type="button" data-clear-workspace-filters>Clear filters</button></section>`;
}

function renderTrustInbox() {
  if (state.trustStatus === "loading" && !state.trustOperations) {
    return `<section class="trust-empty" aria-label="Loading Trust Inbox"><span class="boot-mark" aria-hidden="true"></span><h1>Loading Trust Inbox…</h1><p>Evaluating deterministic evidence across local workspaces.</p></section>`;
  }
  if (state.trustStatus === "error") {
    return `<section class="trust-empty is-error" role="alert">${icon("alert")}<h1>Trust Inbox is unavailable.</h1><p>${escapeHtml(state.trustError || "The cross-workspace trust read model could not be loaded.")}</p><button class="button button-secondary" type="button" data-refresh-trust>Try again</button></section>`;
  }
  const report = state.trustOperations;
  const summary = trustInboxSummary(report);
  const items = filterTrustItems(report?.items, state.trustFilter);
  const page = report?.page;
  return `
    <header class="trust-head">
      <div><p class="eyebrow">Cross-workspace trust operations</p><h1>Trust Inbox</h1><p>Deterministically ranked evidence changes, failed guards, expired decisions, and degraded imports. Human decisions can acknowledge risk; they cannot rewrite evidence.</p></div>
      <div class="trust-head-score"><strong>${summary.attention}</strong><span>need attention</span><small>${summary.newCount} subject ${pluralize(summary.newCount, "change")} since checkpoint</small></div>
    </header>
    <section class="trust-toolbar" aria-label="Filter Trust Inbox">
      ${trustInboxFilters.map((filter) => `<button type="button" data-trust-filter="${filter}" aria-pressed="${state.trustFilter === filter}">${escapeHtml(trustFilterLabel(filter))}</button>`).join("")}
    </section>
    ${page?.truncated ? `<p class="trust-limit" role="status">Showing the highest-priority ${page.returned} of ${page.totalItems} matching items. Narrow the server query before treating this as a complete export.</p>` : ""}
    ${items.length ? `<ol class="trust-list" aria-label="Ranked trust attention">
      ${items.map((item, index) => renderTrustItem(item, index)).join("")}
    </ol>` : `<section class="trust-empty">${icon("check")}<h2>No items match this view.</h2><p>The filter is clear at ${formatTimestamp(report.evaluatedAt)}. This does not certify workspaces outside the loaded local state.</p></section>`}
  `;
}

function renderTrustItem(item, index) {
  const primary = trustPrimaryReason(item);
  const workspaceName = state.workspaces.find((workspace) => workspace.id === item.workspaceId)?.name || item.workspaceId;
  const routedItem = readRoute().view === "trust" && readRoute().item === item.id;
  const subject = item.stableKey || item.evidence?.adapter || item.threadId || item.id;
  const headingId = `trust-item-heading-${index + 1}`;
  return `<li>
    <article class="trust-item criticality-${escapeHtml(item.criticality)}${item.subjectUpdatedSinceCheckpoint ? " is-new" : ""}${routedItem ? " is-routed" : ""}" data-trust-item="${escapeHtml(item.id)}" aria-labelledby="${headingId}">
      <div class="trust-rank" aria-label="Priority rank ${index + 1}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${item.priority.score}</strong></div>
      <div class="trust-item-copy">
        <div class="trust-item-meta"><span class="criticality-pill">${escapeHtml(item.criticality)}</span>${item.subjectUpdatedSinceCheckpoint ? '<span class="new-pill">Subject changed</span>' : ""}<span>${escapeHtml(workspaceName)}</span></div>
        <h2 id="${headingId}">${escapeHtml(subject)}</h2>
        <p class="trust-why"><strong>${escapeHtml(trustReasonLabel(primary.code))}</strong><span>${escapeHtml(primary.explanation)}</span></p>
        <div class="trust-reasons" aria-label="All deterministic reasons">${item.reasons.map((reason) => `<span>${escapeHtml(trustReasonLabel(reason.code))}</span>`).join("")}</div>
        <details class="trust-trace"><summary>Inspect priority trace</summary><ul>${item.priority.components.map((component) => `<li><span>${escapeHtml(trustReasonLabel(component.code))}</span><strong>+${component.value}</strong><small>${escapeHtml(component.authority)}</small></li>`).join("")}</ul></details>
      </div>
      <a class="trust-open" data-trust-link href="${escapeHtml(trustItemHref(item))}" aria-label="${escapeHtml(trustActionLabel(item))}: ${escapeHtml(subject)}"${routedItem ? ' aria-current="true"' : ""}><span>${escapeHtml(trustActionLabel(item))}</span>${icon("arrow")}</a>
    </article>
  </li>`;
}

function renderTrustSummary() {
  const report = state.trustOperations;
  const summary = trustInboxSummary(report);
  const counts = report?.counts?.byCriticality || {};
  return `<aside class="run-inspector trust-summary" aria-label="Trust Inbox summary">
    <div class="run-inspector-head"><p class="eyebrow">Evaluation boundary</p><span class="mode-pill mode-local">Deterministic</span></div>
    <h2>${summary.workspaceCount} local ${pluralize(summary.workspaceCount, "workspace")}</h2>
    <p class="run-goal">Rank comes from declared claim criticality, deterministic run/import defaults, and inspectable evidence-policy reasons. Model prose has zero authority.</p>
    <dl class="trust-criticality">
      ${["critical", "high", "medium", "low"].map((value) => `<div><dt>${value}</dt><dd>${counts[value] || 0}</dd></div>`).join("")}
    </dl>
    <section class="trust-checkpoint">
      <h3>Review checkpoint</h3>
      <p>${state.trustCheckpointAt ? `Subjects updated after ${escapeHtml(formatTimestamp(state.trustCheckpointAt))} are marked changed.` : "No checkpoint is set; every loaded subject is marked changed."}</p>
      <button class="button button-secondary" type="button" data-mark-trust-reviewed>Mark current inbox reviewed</button>
    </section>
    <p class="mode-disclosure">Evaluated ${report ? escapeHtml(formatTimestamp(report.evaluatedAt)) : "not available"}. “Subject changed” is a timestamp fact, not proof that the attention condition first emerged after the checkpoint.</p>
  </aside>`;
}

function trustReturnHref() {
  const route = readRoute();
  const parameters = new URLSearchParams({ view: "trust" });
  if (route.item) parameters.set("item", route.item);
  if (route.at) parameters.set("at", route.at);
  return `?${parameters}`;
}

function renderImportReceipt() {
  if (state.operatorPanelStatus === "loading") return `<section class="trust-empty" aria-label="Loading import receipt"><span class="boot-mark" aria-hidden="true"></span><h1>Loading exact import receipt…</h1></section>`;
  if (state.operatorPanelError || !state.importReceipt) return `<section class="trust-empty is-error" role="alert">${icon("alert")}<h1>Import receipt is unavailable.</h1><p>${escapeHtml(state.operatorPanelError || "The exact routed receipt could not be loaded.")}</p><a class="button button-secondary" href="${escapeHtml(trustReturnHref())}">Back to Trust Inbox</a></section>`;
  const receipt = state.importReceipt;
  const counts = receipt.counts || {};
  const warnings = Array.isArray(receipt.warnings) ? receipt.warnings : [];
  return `
    <header class="trust-head receipt-head">
      <div><a class="workspace-back" href="${escapeHtml(trustReturnHref())}">${icon("arrow")}Back to Trust Inbox</a><p class="eyebrow">Exact local import receipt</p><h1>${escapeHtml(receipt.adapter)}</h1><p>This is the receipt named by the ranked import item, not a substitute from the same workspace or adapter.</p></div>
      <div class="trust-head-score receipt-status status-${escapeHtml(receipt.status)}"><strong>${escapeHtml(receipt.status)}</strong><span>import status</span><small>${warnings.length} ${pluralize(warnings.length, "warning")}</small></div>
    </header>
    <article class="operator-panel receipt-panel" data-import-receipt="${escapeHtml(receipt.id)}">
      <section>
        <h2>Receipt identity</h2>
        <dl class="operator-fields">
          <div><dt>Receipt ID</dt><dd><code>${escapeHtml(receipt.id)}</code></dd></div>
          <div><dt>Adapter</dt><dd>${escapeHtml(receipt.adapter)}</dd></div>
          <div><dt>Source reference</dt><dd>${escapeHtml(shortPath(receipt.sourceRef))}</dd></div>
          <div><dt>Source digest</dt><dd><code class="digest-value">${escapeHtml(receipt.sourceDigest)}</code></dd></div>
          <div><dt>Source observed</dt><dd>${escapeHtml(formatTimestamp(receipt.importedAt))}</dd></div>
          <div><dt>Committed locally</dt><dd>${receipt.recordedAt ? escapeHtml(formatTimestamp(receipt.recordedAt)) : "Not recorded by this store version"}</dd></div>
        </dl>
      </section>
      <section>
        <h2>Imported counts</h2>
        <dl class="receipt-counts">
          ${["channels", "agents", "runs", "proofSources", "reviewGates"].map((key) => `<div><dt>${escapeHtml(countLabel(key))}</dt><dd>${Number.isInteger(counts[key]) ? counts[key] : 0}</dd></div>`).join("")}
        </dl>
      </section>
      <section class="receipt-warnings">
        <h2>Warnings</h2>
        ${warnings.length ? `<ul>${warnings.map((warning) => `<li>${icon("alert")}<span>${escapeHtml(warning)}</span></li>`).join("")}</ul>` : `<p class="operator-clear">${icon("check")}This receipt recorded no import warnings.</p>`}
      </section>
    </article>`;
}

function countLabel(key) {
  return { channels: "Channels", agents: "Agents", runs: "Runs", proofSources: "Proof sources", reviewGates: "Review gates" }[key] || key;
}

function renderRecentDecisions() {
  if (state.operatorPanelStatus === "loading") return `<section class="trust-empty" aria-label="Loading recent decisions"><span class="boot-mark" aria-hidden="true"></span><h1>Loading recent decisions…</h1></section>`;
  if (state.operatorPanelError) return `<section class="trust-empty is-error" role="alert">${icon("alert")}<h1>Recent decisions are unavailable.</h1><p>${escapeHtml(state.operatorPanelError)}</p></section>`;
  const report = state.recentDecisions;
  const items = report?.items || [];
  return `
    <header class="trust-head decisions-head">
      <div><p class="eyebrow">Cross-workspace operator record</p><h1>Recent decisions</h1><p>Current decision projections are shown with their append-only transition history. Human decisions remain evidence-scoped and never change source evidence.</p></div>
      <div class="trust-head-score"><strong>${items.length}</strong><span>recent transitions</span><small>${report?.page?.truncated ? `${report.page.totalItems} total · bounded view` : "bounded to 30"}</small></div>
    </header>
    ${items.length ? `<ol class="decision-history" aria-label="Recent review decision transitions">${items.map(renderDecisionEvent).join("")}</ol>` : `<section class="trust-empty">${icon("check")}<h2>No durable review decisions yet.</h2><p>Decisions will appear here after an operator responds to an evidence-scoped review gate.</p></section>`}`;
}

function renderDecisionEvent(event) {
  const parameters = new URLSearchParams({ view: "run", workspaceId: event.workspaceId, threadId: event.threadId });
  return `<li><article class="decision-event${event.current ? " is-current" : ""}" data-recent-decision="${escapeHtml(event.eventId)}">
    <div class="decision-event-status"><span class="mode-pill ${event.current ? "mode-local" : ""}">${event.current ? "Current" : "History"}</span><strong>${escapeHtml(event.action === "deleted" ? "cleared" : event.status)}</strong></div>
    <div class="decision-event-copy"><p class="eyebrow">${escapeHtml(event.workspaceName || event.workspaceId)} · ${escapeHtml(event.threadId)}</p><h2>${escapeHtml(event.claimId)}</h2><p>${event.note ? escapeHtml(event.note) : "No operator note supplied."}</p><small>Decision ${escapeHtml(formatTimestamp(event.updatedAt))} · recorded ${escapeHtml(formatTimestamp(event.recordedAt))} · ${escapeHtml(event.origin || "operator")}</small></div>
    <a class="trust-open" href="?${parameters}" aria-label="Open run for ${escapeHtml(event.claimId)}"><span>Open run</span>${icon("arrow")}</a>
  </article></li>`;
}

function renderOperatorBoundary() {
  const receiptView = state.workspaceScope.kind === "receipt";
  return `<aside class="run-inspector trust-summary operator-boundary" aria-label="${receiptView ? "Import receipt" : "Decision history"} boundary">
    <div class="run-inspector-head"><p class="eyebrow">Privacy boundary</p><span class="mode-pill mode-local">Local only</span></div>
    <h2>${receiptView ? "Receipt metadata, not raw session content" : "Operator transitions, not rewritten evidence"}</h2>
    <p class="run-goal">${receiptView ? "Source references are disclosed as basenames. Exact declared proof bytes, when present, remain private in content-addressed local SQLite." : "The current projection supports fast review; the append-only events preserve the transition sequence for inspection."}</p>
    <p class="mode-disclosure">${receiptView ? "Run adapters do not store raw transcripts, command text, arguments, output, environment values, or absolute paths." : "This view is bounded and includes transition history for decisions that still have a current projection. Cleared-only histories remain in the trust ledger and exports."}</p>
  </aside>`;
}

function trustFilterLabel(filter) {
  return { all: "All", new: "Subject changed", critical: "Critical", contradiction: "Contradictions", expired: "Expired or stale", imports: "Imports" }[filter] || filter;
}

function trustActionLabel(item) {
  if (item.kind === "claim") return item.target.bundleId && item.target.evidenceIdentity ? "Review exact claim" : "Open claim run";
  if (item.kind === "run") return "Open run";
  if (item.kind === "import") return "Inspect receipt";
  return "Open workspace";
}

function trustItemHref(item) {
  const target = item.target;
  const parameters = new URLSearchParams({ workspaceId: target.workspaceId, from: "trust", item: item.id });
  const route = readRoute();
  if (route.at) parameters.set("at", route.at);
  if (item.kind === "claim" && target.bundleId && target.evidenceIdentity) {
    parameters.set("view", "proof");
    parameters.set("threadId", target.threadId);
    parameters.set("claimId", target.claimId);
  } else if (item.kind === "run" || item.kind === "claim") {
    parameters.set("view", "run");
    parameters.set("threadId", target.threadId);
  } else if (item.kind === "import" && target.receiptId) {
    parameters.set("view", "receipt");
    parameters.set("receiptId", target.receiptId);
  } else {
    parameters.set("view", "run");
  }
  return `?${parameters}`;
}

function hydrateWorkspaceUi({ reset = false } = {}) {
  const saved = reset ? {} : readWorkspaceUi();
  const defaultThread = state.workspace.threads.find((thread) => workspaceAttentionCount(thread) > 0) || state.workspace.threads[0];
  const savedThread = state.workspace.threads.find((thread) => thread.id === saved.selectedThreadId);
  state.selectedThreadId = savedThread?.id || defaultThread.id;
  const selected = savedThread || defaultThread;
  const scopeIsValid = (
    (saved.scopeKind === "channel" && state.workspace.channels.some((channel) => channel.id === saved.scopeId))
    || (saved.scopeKind === "agent" && state.workspace.agents.some((agent) => agent.id === saved.scopeId))
    || (saved.scopeKind === "attention" && ["review", "stale"].includes(saved.scopeId))
    || (state.durableState && saved.scopeKind === "trust" && saved.scopeId === "inbox")
    || (state.durableState && saved.scopeKind === "decisions" && saved.scopeId === "recent")
  );
  state.workspaceScope = scopeIsValid
    ? { kind: saved.scopeKind, id: saved.scopeId }
    : { kind: "channel", id: selected.channelId };
  state.workspaceFilter = ["all", "review", "completed"].includes(saved.filter) ? saved.filter : "all";
  state.workspaceQuery = typeof saved.query === "string" ? saved.query.slice(0, 120) : "";
  ensureVisibleThread();
}

function visibleWorkspaceThreads() {
  const query = state.workspaceQuery.trim().toLowerCase();
  return state.workspace.threads
    .filter((thread) => {
      if (state.workspaceScope.kind === "channel") return thread.channelId === state.workspaceScope.id;
      if (state.workspaceScope.kind === "agent") return thread.agentId === state.workspaceScope.id;
      if (state.workspaceScope.id === "stale") return threadStaleClaims(thread).length > 0;
      return workspaceOpenReviewClaimIds(thread).length > 0;
    })
    .filter((thread) => {
      if (state.workspaceFilter === "review") return workspaceAttentionCount(thread) > 0;
      if (state.workspaceFilter === "completed") return thread.status === "completed";
      return true;
    })
    .filter((thread) => {
      if (!query) return true;
      const agent = workspaceAgent(thread.agentId);
      const channel = state.workspace.channels.find((item) => item.id === thread.channelId);
      const haystack = [thread.title, thread.goal, thread.summary, agent.name, channel?.name, ...thread.events.flatMap((event) => [event.title, event.detail])].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function selectedWorkspaceThread(visible = visibleWorkspaceThreads()) {
  return visible.find((thread) => thread.id === state.selectedThreadId) || visible[0] || state.workspace.threads[0];
}

function ensureVisibleThread() {
  const visible = visibleWorkspaceThreads();
  if (visible.length && !visible.some((thread) => thread.id === state.selectedThreadId)) state.selectedThreadId = visible[0].id;
}

function workspaceScopeDetails() {
  if (state.workspaceScope.kind === "attention") {
    if (state.workspaceScope.id === "stale") return { kind: "attention", eyebrow: "History-aware proof queue", title: "Stale claims", description: "Previously supported claims whose evidence aged out or was followed by a newer run in the same agent channel." };
    return { kind: "attention", eyebrow: "Human review queue", title: "Needs review", description: "Completion claims that deterministic evidence cannot safely close on its own." };
  }
  if (state.workspaceScope.kind === "agent") {
    const agent = workspaceAgent(state.workspaceScope.id);
    return { kind: "agent", eyebrow: "Agent run history", title: agent.name, description: `${agent.role}. Typed activity only; no chat transcript or command surface.` };
  }
  const channel = state.workspace.channels.find((item) => item.id === state.workspaceScope.id) || state.workspace.channels[0];
  return { kind: "channel", eyebrow: "Agent operations channel", title: channel.name, description: channel.topic };
}

function workspaceAgent(agentId) {
  return state.workspace.agents.find((agent) => agent.id === agentId) || { id: "unknown", name: "Unknown agent", role: "unavailable", initial: "?" };
}

function workspaceTotalAttention() {
  return state.workspace.threads.reduce((sum, thread) => sum + workspaceAttentionCount(thread), 0);
}

function workspaceOpenReviewCount() {
  return state.workspace.threads.reduce((sum, thread) => sum + workspaceOpenReviewClaimIds(thread).length, 0);
}

function workspaceStaleCount() {
  return state.claimHistory?.counts?.stale || 0;
}

function threadProofAvailable(thread) {
  return thread?.proofState === "ready" && thread.proofBundleId === state.bundle?.id;
}

function proofReadyThread(threadId) {
  const requested = state.workspace.threads.find((thread) => thread.id === threadId);
  if (requested && threadProofAvailable(requested)) return requested;
  const selected = state.workspace.threads.find((thread) => thread.id === state.selectedThreadId);
  if (selected && threadProofAvailable(selected)) return selected;
  return state.workspace.threads.find(threadProofAvailable) || null;
}

function threadStatusLabel(status) {
  return { running: "Running", needs_review: "Needs review", completed: "Completed", failed: "Failed" }[status] || status;
}

function readWorkspaceUi() {
  try {
    const parsed = JSON.parse(localStorage.getItem(workspaceUiStorageKey) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readActiveWorkspace() {
  try {
    return localStorage.getItem(activeWorkspaceStorageKey) || "";
  } catch {
    return "";
  }
}

function readTrustCheckpoint() {
  try {
    const value = localStorage.getItem(trustCheckpointStorageKey) || "";
    return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  } catch {
    return null;
  }
}

function persistTrustCheckpoint(value) {
  try {
    if (value) localStorage.setItem(trustCheckpointStorageKey, value);
    else localStorage.removeItem(trustCheckpointStorageKey);
  } catch {}
}

function readRoute() {
  const parameters = new URLSearchParams(window.location.search);
  const bounded = (name) => String(parameters.get(name) || "").slice(0, 500);
  return {
    view: bounded("view"),
    workspaceId: bounded("workspaceId"),
    threadId: bounded("threadId"),
    claimId: bounded("claimId"),
    receiptId: bounded("receiptId"),
    evidenceIdentity: bounded("evidenceIdentity"),
    at: bounded("at"),
    from: bounded("from"),
    item: bounded("item")
  };
}

async function applyInitialRoute(route) {
  if (!state.durableState) return;
  if (route.view === "trust") {
    state.workspaceScope = { kind: "trust", id: "inbox" };
    persistWorkspaceUi();
    render();
    focusRoutedTrustItem(route.item);
    return;
  }
  if (route.view === "receipt") {
    state.workspaceScope = { kind: "receipt", id: route.receiptId };
    state.operatorPanelStatus = "loading";
    render();
    const routedItem = state.trustOperations?.items.find((item) => item.id === route.item);
    const target = routedItem?.target;
    if (!route.receiptId || routedItem?.kind !== "import" || target.workspaceId !== state.workspace.workspace.id || target.receiptId !== route.receiptId) {
      throw new Error("The routed import receipt is no longer present in the current Trust Inbox.");
    }
    try {
      state.importReceipt = await requestImportReceipt(route.workspaceId, route.receiptId);
      state.operatorPanelStatus = "ready";
    } catch (error) {
      state.operatorPanelStatus = "error";
      state.operatorPanelError = error.message || "The exact import receipt could not be loaded.";
    }
    return;
  }
  if (route.view === "decisions") {
    state.workspaceScope = { kind: "decisions", id: "recent" };
    state.operatorPanelStatus = "loading";
    render();
    try {
      state.recentDecisions = await requestRecentDecisions();
      state.operatorPanelStatus = "ready";
    } catch (error) {
      state.operatorPanelStatus = "error";
      state.operatorPanelError = error.message || "Recent decisions could not be loaded.";
    }
    persistWorkspaceUi();
    return;
  }
  if (!["run", "proof"].includes(route.view) || !route.threadId) return;
  const thread = state.workspace.threads.find((item) => item.id === route.threadId);
  if (!thread) throw new Error("The routed Trust Inbox run is no longer available.");
  state.selectedThreadId = thread.id;
  state.workspaceScope = { kind: "channel", id: thread.channelId };
  state.workspaceFilter = "all";
  state.workspaceQuery = "";
  if (thread.proofState === "ready" && thread.proofBundleId !== state.bundle?.id) state.bundle = await requestBundle(thread.proofBundleId);
  persistWorkspaceUi();
  if (route.view === "run") return;
  const routedItem = state.trustOperations?.items.find((item) => item.id === route.item);
  const target = routedItem?.target;
  if (!route.claimId || routedItem?.kind !== "claim" || target.workspaceId !== state.workspace.workspace.id || target.threadId !== thread.id || target.claimId !== route.claimId || !target.evidenceIdentity) {
    throw new Error("The routed proof target is no longer present in the current Trust Inbox.");
  }
  await runProof("recorded", thread.id);
  const finding = state.proof?.findings.find((item) => item.claimId === route.claimId);
  if (!finding || evidenceIdentity(finding) !== target.evidenceIdentity) {
    state.phase = "error";
    state.error = { code: "trust_target_changed", message: "The evidence behind this Trust Inbox link changed. Return to the inbox and open the current item before deciding." };
    return;
  }
  await selectClaim(route.claimId);
}

function focusRoutedTrustItem(itemId) {
  if (!itemId) return;
  requestAnimationFrame(() => {
    const target = [...document.querySelectorAll("[data-trust-item]")].find((element) => element.dataset.trustItem === itemId);
    const focusTarget = target?.querySelector("[data-trust-link]") || document.querySelector("[data-trust-link]") || document.querySelector("[data-mark-trust-reviewed]");
    focusTarget?.focus();
    (target || focusTarget)?.scrollIntoView({ block: "center" });
  });
}

function persistActiveWorkspace(workspaceId) {
  try {
    localStorage.setItem(activeWorkspaceStorageKey, workspaceId);
  } catch {}
}

function persistWorkspaceUi() {
  try {
    localStorage.setItem(workspaceUiStorageKey, JSON.stringify({
      selectedThreadId: state.selectedThreadId,
      scopeKind: state.workspaceScope.kind,
      scopeId: state.workspaceScope.id,
      filter: state.workspaceFilter,
      query: state.workspaceQuery
    }));
  } catch {}
}

function renderLoading() {
  const live = state.activeRunMode === "live";
  return `
    <section class="analysis-state">
      <div class="analysis-orbit" aria-hidden="true"><span></span><i>${icon("guard")}</i></div>
      <p class="eyebrow">${live ? "Live model run" : "Recorded model replay"}</p>
      <h1>${live ? "GPT-5.6 is tracing claims to sources." : "Replaying GPT-5.6 output, then checking every citation."}</h1>
      <p>Deterministic guards remain authoritative for paths, line ranges, freshness, receipts, and explicit contradictions.</p>
      <ol class="analysis-steps">
        <li class="is-complete"><span>1</span>Bundle indexed</li>
        <li class="is-active"><span>2</span>${live ? "Structured inference" : "Recorded inference"}</li>
        <li><span>3</span>Guard adjudication</li>
      </ol>
      <div class="skeleton-grid" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
    </section>
  `;
}

function renderError() {
  const liveUnavailable = state.error?.code === "live_unavailable";
  return `
    <section class="error-state" role="alert">
      <span class="error-code">${escapeHtml(state.error?.code || "proof_error")}</span>
      <h1>${liveUnavailable ? "Live GPT is not configured on this machine." : "Proof Mode could not complete this run."}</h1>
      <p>${escapeHtml(state.error?.message || "The proof-analysis request failed.")}</p>
      <div class="error-actions">
        <button class="button button-primary" type="button" data-run-mode="recorded">Run the recorded demo</button>
        <button class="button button-secondary" type="button" data-reset>Back to bundle</button>
      </div>
      <small>${liveUnavailable ? "Recorded mode remains fully testable and is labeled throughout the interface." : "No source data or review decisions were changed."}</small>
    </section>
  `;
}

function renderProof() {
  const selected = selectedFinding();
  return `
    <section class="proof-shell">
      <aside class="summary-pane proof-pane" data-proof-view="summary">
        ${renderSummaryPane()}
      </aside>
      <section class="claims-pane proof-pane" data-proof-view="claims">
        ${renderClaimsPane()}
      </section>
      <aside class="trace-pane proof-pane" data-proof-view="source">
        ${renderTracePane(selected)}
      </aside>
    </section>
  `;
}

function renderSummaryPane() {
  const proof = state.proof;
  const proofThread = state.workspace.threads.find((thread) => thread.id === state.activeProofThreadId) || proofReadyThread();
  const channel = state.workspace.channels.find((item) => item.id === proofThread.channelId);
  const decisions = proof.findings.map(currentDecision).filter((decision) => decisionClosesGate(decision));
  const openReviewCount = proof.findings.filter((finding) => finding.reviewRequired && !decisionClosesGate(currentDecision(finding))).length;
  const staleHistoryClaims = threadStaleClaims(proofThread);
  const reviewRecordUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(proofReceipt())}`;
  const route = readRoute();
  const trustBackParameters = new URLSearchParams({ view: "trust", item: route.item });
  if (route.at) trustBackParameters.set("at", route.at);
  const backAction = route.from === "trust"
    ? `<a class="workspace-back" href="?${trustBackParameters}">${icon("arrow")}Back to Trust Inbox</a>`
    : `<button class="workspace-back" type="button" data-reset>${icon("arrow")}Back to #${escapeHtml(channel.name)}</button>`;
  return `
    ${backAction}
    <div class="pane-head">
      <div>
        <p class="eyebrow">Proof result</p>
        <h2>${escapeHtml(proof.bundle.title)}</h2>
      </div>
      <span class="mode-pill mode-${escapeHtml(proof.execution.mode)}">${{ recorded: "Recorded", imported: "Imported", live: "Live" }[proof.execution.mode] || escapeHtml(proof.execution.mode)}</span>
    </div>

    <section class="review-total">
      <span>Needs human review</span>
      <strong>${openReviewCount}</strong>
      <small>${proof.counts.supported} verified · ${decisions.length} decided</small>
    </section>
    ${staleHistoryClaims.length ? `<section class="history-warning compact" role="status">${icon("clock")}<div><p class="eyebrow">Fresh proof required</p><h3>${staleHistoryClaims.length} previously supported ${pluralize(staleHistoryClaims.length, "claim")} aged out</h3><p>${escapeHtml(staleHistoryClaims[0].reasons[0])}</p></div></section>` : ""}

    <div class="verdict-grid">
      ${verdictMetric("supported", proof.counts.supported)}
      ${verdictMetric("unsupported", proof.counts.unsupported)}
      ${verdictMetric("contradictory", proof.counts.contradictory)}
      ${verdictMetric("stale", proof.counts.stale)}
      ${verdictMetric("uncertain", proof.counts.uncertain)}
    </div>

    <section class="run-summary">
      <h3>What Halba found</h3>
      <p>${escapeHtml(proof.summary)}</p>
    </section>

    <dl class="run-meta">
      <div><dt>Model</dt><dd>${escapeHtml(proof.execution.model)}</dd></div>
      <div><dt>Reasoning</dt><dd>${escapeHtml(proof.execution.reasoningEffort)}</dd></div>
      <div><dt>API storage</dt><dd>${proof.execution.store ? "On" : "Off"}</dd></div>
      <div><dt>Sources</dt><dd>${proof.bundle.sourceCount} / ${formatBytes(proof.bundle.totalBytes)}</dd></div>
      ${proof.execution.latencyMs ? `<div><dt>Latency</dt><dd>${proof.execution.latencyMs} ms</dd></div>` : ""}
      ${proof.execution.usage?.totalTokens ? `<div><dt>Tokens</dt><dd>${proof.execution.usage.totalTokens}</dd></div>` : ""}
    </dl>

    <div class="summary-actions">
      <a class="button button-primary" href="${reviewRecordUrl}" download="halba-proof-review.md">${icon("download", "button-icon")}Download review record</a>
      <button class="button button-secondary" type="button" data-copy-receipt>Copy proof receipt</button>
      <button class="text-action" type="button" data-run-mode="recorded">Run again</button>
    </div>

    <p class="mode-disclosure">${proof.execution.mode === "recorded"
      ? "This is a checked-in structured-inference replay. It proves the workflow and guards, not a live or credentialed API call."
      : proof.execution.mode === "imported"
        ? "This adjudication was imported with its evidence packet. Exact hashes and deterministic guards remain authoritative."
        : "This result came from the Responses API. Deterministic guards still own the final verdict."}</p>
  `;
}

function renderClaimsPane() {
  const findings = filteredFindings();
  return `
    <div class="pane-head claims-head">
      <div>
        <p class="eyebrow">Review queue</p>
        <h2>Claims, not conversation</h2>
      </div>
      <span class="claim-count">${findings.length} shown</span>
    </div>
    <div class="claim-filters" aria-label="Filter claims">
      ${filterButton("review", "Open review")}
      ${filterButton("supported", "Verified")}
      ${filterButton("decided", "Decided")}
      ${filterButton("all", "All claims")}
    </div>
    <div class="claim-list">
      ${findings.length ? findings.map(renderClaimCard).join("") : renderNoClaims()}
    </div>
  `;
}

function renderClaimCard(finding, index) {
  const selected = finding.claimId === state.selectedClaimId;
  const decision = currentDecision(finding);
  const validCitations = finding.citations.filter((citation) => citation.valid);
  return `
    <button
      class="claim-card verdict-${finding.verdict}${selected ? " is-selected" : ""}"
      type="button"
      data-claim-id="${escapeHtml(finding.claimId)}"
      aria-pressed="${selected}"
      style="--claim-index:${index}"
    >
      <span class="claim-topline">
        <span class="verdict-label"><i></i>${verdictLabel(finding.verdict)}</span>
        <span class="confidence">${Math.round(finding.confidence * 100)}% model confidence</span>
      </span>
      <strong>${escapeHtml(finding.claim)}</strong>
      <span class="claim-foot">
        <span class="citation-count">${validCitations.length ? `${validCitations.length} exact ${pluralize(validCitations.length, "source")}` : "No valid source"}</span>
        ${finding.modelDisagreement ? '<span class="disagreement">Model / guard disagreement</span>' : ""}
        ${decision ? `<span class="decision-pill decision-${escapeHtml(decision.status)}">Human: ${escapeHtml(decisionLabel(decision.status))}</span>` : ""}
      </span>
      <span class="claim-arrow" aria-hidden="true">${icon("arrow")}</span>
    </button>
  `;
}

function renderTracePane(finding) {
  if (!finding) {
    return `
      <div class="trace-empty">
        <span aria-hidden="true">${icon("trace")}</span>
        <h2>Select a claim</h2>
        <p>Halba will show the exact source, deterministic guard, model boundary, and human decision here.</p>
      </div>
    `;
  }

  const decision = currentDecision(finding);
  const validCitations = finding.citations.filter((citation) => citation.valid);
  return `
    <div class="trace-head">
      <div>
        <p class="eyebrow">Evidence trace</p>
        <h2>${escapeHtml(finding.claim)}</h2>
      </div>
      <span class="verdict-chip verdict-${finding.verdict}">${verdictLabel(finding.verdict)}</span>
    </div>

    <div class="trace-disclosure">
      <span>${finding.modelDisagreement ? "Guard override" : "Final adjudication"}</span>
      <p>${escapeHtml(finding.issues[0] || finding.reasoningBoundary)}</p>
    </div>

    ${validCitations.length ? `
      <div class="citation-tabs" aria-label="Claim citations">
        ${validCitations.map((citation, index) => `
          <button type="button" data-citation-index="${index}" aria-pressed="${index === state.selectedCitationIndex}">
            ${escapeHtml(shortPath(citation.path))}<span>L${citation.startLine}–${citation.endLine}</span>
          </button>
        `).join("")}
      </div>
      ${renderSourcePreview(validCitations[state.selectedCitationIndex] || validCitations[0])}
    ` : renderMissingSource(finding)}

    <section class="reasoning-boundary">
      <h3>Model reasoning boundary</h3>
      <p>${escapeHtml(finding.reasoningBoundary)}</p>
      <small>Model assessment: ${verdictLabel(finding.modelAssessment)} · deterministic result: ${verdictLabel(finding.verdict)}</small>
    </section>

    <section class="guard-stack">
      <h3>Deterministic guards</h3>
      ${finding.guardResults.length ? finding.guardResults.map((guard) => `
        <div class="guard-row ${guard.passed ? "guard-pass" : "guard-fail"}">
          <span>${guard.passed ? icon("check") : icon("alert")}</span>
          <p><strong>${escapeHtml(guard.type.replaceAll("_", " "))}</strong>${escapeHtml(guard.explanation)}</p>
        </div>
      `).join("") : '<p class="guard-none">No deterministic guard can settle this subjective claim.</p>'}
    </section>

    ${finding.reviewRequired ? `<section class="human-gate">
      <div class="human-gate-head">
        <div>
          <p class="eyebrow">Human gate</p>
          <h3>${decision ? escapeHtml(decisionLabel(decision.status)) : "What should happen to this claim?"}</h3>
        </div>
        ${decision ? `<button class="text-action" type="button" data-clear-decision="${escapeHtml(finding.claimId)}">Clear</button>` : ""}
      </div>
      <label>
        <span>Review note <small>${state.durableState ? "optional, stored in local Halba state" : "optional, stored only in this browser"}</small></span>
        <textarea id="review-note" rows="2" placeholder="Why does this claim pass or fail review?">${escapeHtml(decision?.note || "")}</textarea>
      </label>
      <div class="decision-actions">
        <button type="button" class="decision-button approve" data-decision="approved" data-claim="${escapeHtml(finding.claimId)}">Approve</button>
        <button type="button" class="decision-button reject" data-decision="rejected" data-claim="${escapeHtml(finding.claimId)}">Reject</button>
        <button type="button" class="decision-button resolve" data-decision="resolved" data-claim="${escapeHtml(finding.claimId)}">Resolve</button>
        <button type="button" class="decision-button more-proof" data-decision="more-proof" data-claim="${escapeHtml(finding.claimId)}">Request proof</button>
      </div>
      ${state.reviewError ? `<p class="review-error" role="alert">${escapeHtml(state.reviewError)}</p>` : ""}
    </section>` : ""}
  `;
}

function renderSourcePreview(citation) {
  if (state.sourceStatus === "loading") {
    return `
      <section class="source-card source-loading">
        <div class="source-card-head"><span>Loading exact source…</span></div>
        <div class="source-skeleton"><i></i><i></i><i></i></div>
      </section>
    `;
  }

  if (state.sourceStatus === "error") {
    return `
      <section class="source-card source-error">
        <div class="source-card-head"><span>Source unavailable</span></div>
        <p>${escapeHtml(state.sourceError || "The exact source range could not be loaded.")}</p>
      </section>
    `;
  }

  if (!state.source || state.source.path !== citation.path) {
    return '<section class="source-card"><p class="source-waiting">Select a citation to load its exact lines.</p></section>';
  }

  const lines = state.source.text.split("\n");
  return `
    <section class="source-card">
      <div class="source-card-head">
        <div>
          <span>${escapeHtml(state.source.label)}</span>
          <code>${escapeHtml(state.source.path)} · L${state.source.startLine}–${state.source.endLine}</code>
        </div>
        <button class="copy-reference" type="button" data-copy-reference>Copy reference</button>
      </div>
      <pre class="source-code" tabindex="0">${lines.map((line, index) => `<span><i>${state.source.startLine + index}</i><code>${escapeHtml(line) || " "}</code></span>`).join("")}</pre>
      <div class="source-integrity">
        <span>Exact quote match</span>
        <code>sha256:${escapeHtml(state.source.sha256.slice(0, 12))}…</code>
      </div>
    </section>
  `;
}

function renderMissingSource(finding) {
  return `
    <section class="missing-source">
      <span aria-hidden="true">${icon("missing")}</span>
      <div>
        <h3>No source supports this claim</h3>
        <p>${escapeHtml(finding.issues[0] || "The evidence packet does not contain a valid citation for this claim.")}</p>
      </div>
    </section>
  `;
}

function renderNoClaims() {
  const copy = state.filter === "review"
    ? "Every review-required claim has a human decision."
    : "No claims match this view.";
  return `
    <div class="no-claims">
      <span aria-hidden="true">${icon("check")}</span>
      <h3>${copy}</h3>
      <p>Choose another filter to inspect the rest of the proof graph.</p>
      <button class="text-action" type="button" data-filter="all">Show all claims</button>
    </div>
  `;
}

function filterButton(value, label) {
  return `<button type="button" data-filter="${value}" aria-pressed="${state.filter === value}">${label}</button>`;
}

function verdictMetric(verdict, count) {
  return `
    <div class="verdict-metric verdict-${verdict}">
      <span>${verdictIcon(verdict)}${verdictLabel(verdict)}</span>
      <strong>${count}</strong>
    </div>
  `;
}

function sourceKindIcon(kind) {
  const normalized = String(kind || "").toLowerCase();
  if (normalized.includes("diff") || normalized.includes("patch")) return icon("diff");
  if (normalized.includes("receipt") || normalized.includes("json")) return icon("receipt");
  if (normalized.includes("report") || normalized.includes("markdown")) return icon("report");
  return icon("source");
}

function verdictIcon(verdict) {
  return icon({
    supported: "check",
    unsupported: "missing",
    contradictory: "split",
    stale: "clock",
    uncertain: "uncertain"
  }[verdict] || "claim");
}

function icon(name, className = "glyph") {
  const paths = {
    claim: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="m10.2 10.2 3.6 3.6"/>',
    source: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 13h5M10 17h5"/>',
    guard: '<path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6z"/><path d="m9 12 2 2 4-5"/>',
    human: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.5-4.2 2.7-6.3 6.5-6.3s6 2.1 6.5 6.3"/>',
    play: '<path d="m9 7 8 5-8 5Z"/>',
    pulse: '<path d="M4 12h4l2-6 4 12 2-6h4"/>',
    packet: '<path d="M5 7.5 12 4l7 3.5v9L12 20l-7-3.5z"/><path d="m5 7.5 7 3.5 7-3.5M12 11v9"/>',
    arrow: '<path d="M5 12h13M14 7l5 5-5 5"/>',
    trace: '<circle cx="6" cy="17" r="2"/><circle cx="18" cy="7" r="2"/><path d="M8 16c3-1 4-6 8-8"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="M12 4 3.5 20h17zM12 9v5M12 17h.01"/>',
    missing: '<circle cx="12" cy="12" r="8"/><path d="m7 17 10-10"/>',
    split: '<path d="M5 6h4c4 0 3 12 7 12h3M16 15l3 3-3 3M5 18h4c2 0 2-3 3-6M16 3l3 3-3 3"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    uncertain: '<path d="M9.5 9a2.8 2.8 0 1 1 4.5 2.2c-1.3.8-2 1.3-2 2.8M12 18h.01"/>',
    diff: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 12h5M10 16h2M14 16h3"/>',
    receipt: '<path d="M7 3h10v18l-2-1.5L13 21l-2-1.5L9 21l-2-1.5z"/><path d="M10 8h4M10 12h4"/>',
    report: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    download: '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>'
  };
  return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.claim}</svg>`;
}

function filteredFindings() {
  if (!state.proof) return [];
  if (state.filter === "all") return state.proof.findings;
  if (state.filter === "supported") return state.proof.findings.filter((finding) => finding.verdict === "supported");
  if (state.filter === "decided") return state.proof.findings.filter((finding) => currentDecision(finding));
  return state.proof.findings.filter((finding) => finding.reviewRequired && !decisionClosesGate(currentDecision(finding)));
}

function selectedFinding() {
  return state.proof?.findings.find((finding) => finding.claimId === state.selectedClaimId) || null;
}

async function runProof(mode, threadId) {
  if (state.phase === "loading") return;
  const requested = state.workspace.threads.find((thread) => thread.id === threadId)
    || state.workspace.threads.find((thread) => thread.id === state.selectedThreadId)
    || state.workspace.threads.find((thread) => thread.proofState === "ready" && thread.proofBundleId);
  if (requested?.proofState === "ready" && requested.proofBundleId !== state.bundle?.id) {
    try {
      state.bundle = await requestBundle(requested.proofBundleId);
    } catch (error) {
      state.workspaceNotice = { tone: "error", message: error.message };
      render();
      return;
    }
  }
  const thread = proofReadyThread(requested?.id);
  if (!thread) {
    state.workspaceNotice = { tone: "error", message: "No loaded run references the current proof bundle." };
    state.phase = "ready";
    render();
    return;
  }
  state.activeProofThreadId = thread.id;
  state.selectedThreadId = thread.id;
  persistWorkspaceUi();
  state.phase = "loading";
  state.activeRunMode = mode;
  state.error = null;
  state.proof = null;
  state.source = null;
  render();

  try {
    const body = await requestProof(mode, thread.proofBundleId);
    state.proof = body;
    state.phase = "proof";
    state.filter = "review";
    state.mobileView = "summary";
    const first = body.findings.find((finding) => finding.verdict === "contradictory")
      || body.findings.find((finding) => finding.reviewRequired)
      || body.findings[0];
    state.selectedClaimId = first?.claimId || null;
    state.selectedCitationIndex = 0;
    state.sourceStatus = "idle";
    render();
    await loadSelectedSource();
  } catch (error) {
    state.phase = "error";
    state.error = {
      code: error.code || "proof_error",
      message: error.message || "Proof analysis failed."
    };
    render();
  }
}

async function selectClaim(claimId) {
  state.selectedClaimId = claimId;
  state.selectedCitationIndex = 0;
  state.source = null;
  state.sourceStatus = "idle";
  if (window.matchMedia("(max-width: 820px)").matches) state.mobileView = "source";
  render();
  await loadSelectedSource();
}

async function loadSelectedSource() {
  const finding = selectedFinding();
  const citations = finding?.citations.filter((citation) => citation.valid) || [];
  const citation = citations[state.selectedCitationIndex] || citations[0];
  if (!citation) {
    state.source = null;
    state.sourceStatus = "idle";
    render();
    return;
  }

  const requestId = ++sourceRequest;
  state.sourceStatus = "loading";
  state.sourceError = null;
  render();
  try {
    const body = await requestSource(citation, state.proof?.bundle?.id || state.bundle?.id);
    if (requestId !== sourceRequest) return;
    state.source = body;
    state.sourceStatus = "ready";
  } catch (error) {
    if (requestId !== sourceRequest) return;
    state.source = null;
    state.sourceStatus = "error";
    state.sourceError = error.message;
  }
  render();
}

async function requestRuntime() {
  if (staticDemoMode) return { durableState: false };
  const response = await fetch("/api/runtime");
  if (!response.ok) return { durableState: false };
  return response.json();
}

async function requestClaimHistory(workspaceId) {
  const query = new URLSearchParams({ workspaceId });
  const response = await fetch(`/api/claim-history?${query}`);
  if (!response.ok) throw new Error("Claim history could not be loaded.");
  return response.json();
}

async function requestWorkspaces() {
  const response = await fetch("/api/workspaces");
  if (!response.ok) throw new Error("Durable workspaces could not be loaded.");
  return response.json();
}

async function requestTrustOperations() {
  const query = new URLSearchParams({ limit: "50" });
  const route = readRoute();
  if (route.at) query.set("at", route.at);
  if (state.trustCheckpointAt) query.set("checkpointAt", state.trustCheckpointAt);
  const response = await fetch(`/api/trust-operations?${query}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Trust Operations could not be loaded.");
  return validateTrustOperationsReport(body);
}

async function refreshTrustOperations() {
  if (!state.durableState) return;
  state.trustStatus = "loading";
  state.trustError = null;
  try {
    state.trustOperations = await requestTrustOperations();
    state.trustStatus = "ready";
    const summary = trustInboxSummary(state.trustOperations);
    state.announcement = `Trust Inbox loaded with ${summary.attention} ranked ${pluralize(summary.attention, "item")} across ${summary.workspaceCount} ${pluralize(summary.workspaceCount, "workspace")}.`;
  } catch (error) {
    state.trustStatus = "error";
    state.trustError = error.message || "Trust Operations could not be loaded.";
    state.announcement = state.trustError;
  }
}

async function requestImportReceipts(workspaceId) {
  const query = new URLSearchParams({ workspaceId });
  const response = await fetch(`/api/import-receipts?${query}`);
  if (!response.ok) throw new Error("Import health could not be loaded.");
  return response.json();
}

async function requestImportReceipt(workspaceId, receiptId) {
  const query = new URLSearchParams({ workspaceId, receiptId });
  const response = await fetch(`/api/import-receipt?${query}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "The exact import receipt could not be loaded.");
  return body;
}

async function requestRecentDecisions() {
  const response = await fetch("/api/recent-decisions?limit=30");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Recent decisions could not be loaded.");
  if (body?.schemaVersion !== 1 || !body.page || !Array.isArray(body.items)) throw new Error("Recent decisions returned a malformed response.");
  return body;
}

async function requestBundle(bundleId) {
  if (staticDemoMode) return (await loadStaticDemo()).bundle;
  const query = bundleId ? `?${new URLSearchParams({ bundleId })}` : "";
  const response = await fetch(`/api/proof/bundle${query}`);
  if (!response.ok) throw new Error("The public proof bundle could not be loaded.");
  return response.json();
}

async function requestWorkspace(workspaceId) {
  if (staticDemoMode) return (await loadStaticDemo()).workspace;
  const query = workspaceId ? `?${new URLSearchParams({ workspaceId })}` : "";
  const response = await fetch(`/api/workspace${query}`);
  if (!response.ok) throw new Error("The public agent workspace could not be loaded.");
  return response.json();
}

async function requestProof(mode, bundleId) {
  if (staticDemoMode) {
    if (mode === "live") {
      const error = new Error("The public Pages demo intentionally serves the labeled replay. Run the Node server to use the optional live Responses API path.");
      error.code = "live_unavailable";
      throw error;
    }
    return (await loadStaticDemo()).proof;
  }

  const response = await fetch("/api/proof/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, bundleId })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "Proof analysis failed.");
    error.code = body.error || "proof_error";
    throw error;
  }
  return body;
}

async function requestSource(citation, bundleId) {
  if (staticDemoMode) {
    const source = (await loadStaticDemo()).sources[citation.path];
    if (!source) throw new Error("Proof source not found.");
    if (citation.startLine < 1 || citation.endLine < citation.startLine || citation.endLine > source.lineCount) {
      throw new Error("Invalid proof source range.");
    }
    return {
      path: source.path,
      label: source.label,
      kind: source.kind,
      sha256: source.sha256,
      startLine: citation.startLine,
      endLine: citation.endLine,
      lineCount: source.lineCount,
      text: source.lines.slice(citation.startLine - 1, citation.endLine).join("\n")
    };
  }

  const query = new URLSearchParams({
    ...(bundleId ? { bundleId } : {}),
    path: citation.path,
    startLine: String(citation.startLine),
    endLine: String(citation.endLine)
  });
  const response = await fetch(`/api/proof/source?${query}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || "Source unavailable.");
  return body;
}

async function loadStaticDemo() {
  if (!staticDemoRequest) {
    staticDemoRequest = fetch("static-demo.json").then(async (response) => {
      if (!response.ok) throw new Error("The static proof packet could not be loaded.");
      const body = await response.json();
      if (body?.schemaVersion !== 1 || !body.workspace || !body.bundle || !body.proof || !body.sources) {
        throw new Error("The static proof packet is malformed.");
      }
      return body;
    });
  }
  return staticDemoRequest;
}

async function saveDecision(claimId, status) {
  const finding = state.proof?.findings.find((item) => item.claimId === claimId);
  if (!finding) return;
  const note = document.querySelector("#review-note")?.value.trim() || "";
  const scope = reviewScope(claimId);
  const key = reviewDecisionKey(scope);
  const decision = createReviewDecision({ ...scope, finding, status, note });
  state.reviewError = null;
  if (state.durableState) {
    const response = await fetch("/api/review-decision", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decision)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      state.reviewError = body.message || "The review decision could not be persisted.";
      render();
      return;
    }
    state.decisions[key] = body;
    await refreshTrustOperations();
    try {
      state.recentDecisions = await requestRecentDecisions();
    } catch {
      state.recentDecisions = null;
    }
  } else {
    state.decisions[key] = decision;
    persistDecisions();
  }
  const next = filteredFindings().find((finding) => finding.claimId !== claimId);
  if (state.filter === "review" && shouldAdvanceReviewSelection(status) && next) state.selectedClaimId = next.claimId;
  render();
  loadSelectedSource();
}

async function clearDecision(claimId) {
  const scope = reviewScope(claimId);
  state.reviewError = null;
  if (state.durableState) {
    const response = await fetch("/api/review-decision", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scope)
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      state.reviewError = body.message || "The review decision could not be cleared.";
      render();
      return;
    }
  }
  delete state.decisions[reviewDecisionKey(scope)];
  if (!state.durableState) persistDecisions();
  else {
    await refreshTrustOperations();
    try {
      state.recentDecisions = await requestRecentDecisions();
    } catch {
      state.recentDecisions = null;
    }
  }
  render();
}

async function hydrateDurableDecisions() {
  const proofThreads = state.workspace.threads.filter((thread) => thread.proofState === "ready" && thread.proofBundleId);
  const responses = await Promise.all(proofThreads.map(async (thread) => {
    const query = new URLSearchParams({
      workspaceId: state.workspace.workspace.id,
      threadId: thread.id,
      bundleId: thread.proofBundleId
    });
    const response = await fetch(`/api/review-decisions?${query}`);
    if (!response.ok) throw new Error("Stored review decisions could not be loaded.");
    return response.json();
  }));
  for (const decision of responses.flat()) state.decisions[reviewDecisionKey(decision)] = decision;
}

function readDecisions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(decisionStorageKey) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function persistDecisions() {
  try {
    localStorage.setItem(decisionStorageKey, JSON.stringify(state.decisions));
  } catch {}
}

async function copyText(button, text) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    if (button.isConnected) button.textContent = original;
  }, 1400);
}

function proofReceipt() {
  const proof = state.proof;
  const responseCount = proof.findings.filter((finding) => currentDecision(finding)).length;
  const closedCount = proof.findings.filter((finding) => decisionClosesGate(currentDecision(finding))).length;
  return [
    "# Halba Proof Mode review record",
    "",
    `- Bundle: ${proof.bundle.id}`,
    `- Generated: ${proof.bundle.generatedAt}`,
    `- Execution: ${proof.execution.mode} / ${proof.execution.model} / reasoning ${proof.execution.reasoningEffort}`,
    `- API storage: ${proof.execution.store ? "on" : "off"}`,
    `- Verdicts: ${proof.counts.supported} verified, ${proof.counts.unsupported} unsupported, ${proof.counts.contradictory} contradictory, ${proof.counts.stale} stale, ${proof.counts.uncertain} uncertain`,
    `- Human responses: ${responseCount}; closed gates: ${closedCount} of ${proof.findings.filter((finding) => finding.reviewRequired).length}`,
    "",
    "## Claims",
    "",
    ...proof.findings.flatMap((finding) => {
      const decision = currentDecision(finding);
      const citations = finding.citations.filter((citation) => citation.valid);
      return [
        `### ${finding.claimId}`,
        "",
        finding.claim,
        "",
        `- Final verdict: ${verdictLabel(finding.verdict)}`,
        `- Model assessment: ${verdictLabel(finding.modelAssessment)} (${Math.round(finding.confidence * 100)}%)`,
        `- Reasoning boundary: ${finding.reasoningBoundary}`,
        `- Human decision: ${decision?.status || (finding.reviewRequired ? "pending" : "not required")}`,
        decision?.updatedAt ? `- Decision time: ${decision.updatedAt}` : "",
        decision?.note ? `- Review note: ${decision.note}` : "",
        "- Evidence:",
        ...(citations.length
          ? citations.map((citation) => `  - ${citation.path}:L${citation.startLine}-L${citation.endLine} / sha256:${citation.sourceSha256}`)
          : ["  - No valid citation"]),
        "- Deterministic guards:",
        ...(finding.guardResults.length
          ? finding.guardResults.map((guard) => `  - ${guard.passed ? "PASS" : "FAIL"} ${guard.type}: ${guard.explanation}`)
          : ["  - None can settle this claim"]),
        ""
      ].filter(Boolean);
    })
  ].join("\n");
}

function activateSkipNavigation(event) {
  event.preventDefault();
  const target = document.querySelector(event.currentTarget.getAttribute("href"));
  target?.focus();
  target?.scrollIntoView({ block: "start" });
}

const skipNavigation = document.querySelector(".skip-link");
skipNavigation?.addEventListener("click", activateSkipNavigation);
skipNavigation?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") activateSkipNavigation(event);
});

document.addEventListener("click", async (event) => {
  const runButton = event.target.closest("[data-run-mode]");
  if (runButton) {
    await runProof(runButton.dataset.runMode, runButton.dataset.proofThread);
    return;
  }

  const scopeButton = event.target.closest("[data-workspace-scope]");
  if (scopeButton) {
    state.workspaceScope = { kind: scopeButton.dataset.workspaceScope, id: scopeButton.dataset.workspaceScopeId };
    state.workspaceFilter = state.workspaceScope.kind === "attention" ? "review" : "all";
    state.workspaceQuery = "";
    if (!["trust", "decisions"].includes(state.workspaceScope.kind)) ensureVisibleThread();
    persistWorkspaceUi();
    if (state.workspaceScope.kind === "trust") {
      const parameters = new URLSearchParams({ view: "trust" });
      if (readRoute().at) parameters.set("at", readRoute().at);
      window.history.pushState(null, "", `?${parameters}`);
    }
    else if (state.workspaceScope.kind === "decisions") {
      window.history.pushState(null, "", "?view=decisions");
      state.operatorPanelStatus = "loading";
      state.operatorPanelError = null;
      render();
      try {
        state.recentDecisions = await requestRecentDecisions();
        state.operatorPanelStatus = "ready";
      } catch (error) {
        state.operatorPanelStatus = "error";
        state.operatorPanelError = error.message || "Recent decisions could not be loaded.";
      }
    }
    else if (new URLSearchParams(window.location.search).has("view")) window.history.pushState(null, "", window.location.pathname);
    render();
    return;
  }

  const trustFilterButton = event.target.closest("[data-trust-filter]");
  if (trustFilterButton) {
    state.trustFilter = trustInboxFilters.includes(trustFilterButton.dataset.trustFilter) ? trustFilterButton.dataset.trustFilter : "all";
    render();
    document.querySelector(`[data-trust-filter="${state.trustFilter}"]`)?.focus();
    return;
  }

  if (event.target.closest("[data-refresh-trust]")) {
    await refreshTrustOperations();
    render();
    return;
  }

  if (event.target.closest("[data-mark-trust-reviewed]")) {
    state.trustCheckpointAt = state.trustOperations?.evaluatedAt || new Date().toISOString();
    persistTrustCheckpoint(state.trustCheckpointAt);
    await refreshTrustOperations();
    state.announcement = `Trust review checkpoint saved at ${formatTimestamp(state.trustCheckpointAt)}.`;
    render();
    document.querySelector("[data-mark-trust-reviewed]")?.focus();
    return;
  }

  const threadButton = event.target.closest("[data-thread-id]");
  if (threadButton) {
    state.selectedThreadId = threadButton.dataset.threadId;
    const thread = state.workspace.threads.find((item) => item.id === state.selectedThreadId);
    if (thread?.proofState === "ready" && thread.proofBundleId !== state.bundle?.id) {
      try {
        state.bundle = await requestBundle(thread.proofBundleId);
      } catch (error) {
        state.workspaceNotice = { tone: "error", message: error.message };
      }
    }
    persistWorkspaceUi();
    render();
    return;
  }

  const workspaceFilterButton = event.target.closest("[data-workspace-filter]");
  if (workspaceFilterButton) {
    state.workspaceFilter = workspaceFilterButton.dataset.workspaceFilter;
    ensureVisibleThread();
    persistWorkspaceUi();
    render();
    return;
  }

  const importButton = event.target.closest("[data-import-workspace]");
  if (importButton) {
    document.querySelector("#workspace-file")?.click();
    return;
  }

  if (event.target.closest("[data-refresh-workspace]")) {
    await switchDurableWorkspace(state.workspace.workspace.id, { resetUi: false, message: "Refreshed local runs, import health, proof history, and decisions." });
    return;
  }

  if (event.target.closest("[data-dismiss-notice]")) {
    state.workspaceNotice = null;
    render();
    return;
  }

  if (event.target.closest("[data-clear-workspace-filters]")) {
    state.workspaceFilter = "all";
    state.workspaceQuery = "";
    ensureVisibleThread();
    persistWorkspaceUi();
    render();
    return;
  }

  const resetButton = event.target.closest("[data-reset]");
  if (resetButton) {
    state.phase = state.bundle ? "ready" : "boot";
    state.error = null;
    if (state.activeProofThreadId) state.selectedThreadId = state.activeProofThreadId;
    render();
    return;
  }

  const claimButton = event.target.closest("[data-claim-id]");
  if (claimButton) {
    await selectClaim(claimButton.dataset.claimId);
    return;
  }

  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    state.filter = filterButton.dataset.filter;
    const visible = filteredFindings();
    if (visible.length && !visible.some((finding) => finding.claimId === state.selectedClaimId)) {
      state.selectedClaimId = visible[0].claimId;
      state.selectedCitationIndex = 0;
      state.source = null;
      state.sourceStatus = "idle";
    }
    render();
    await loadSelectedSource();
    return;
  }

  const citationButton = event.target.closest("[data-citation-index]");
  if (citationButton) {
    state.selectedCitationIndex = Number(citationButton.dataset.citationIndex);
    state.source = null;
    state.sourceStatus = "idle";
    render();
    await loadSelectedSource();
    return;
  }

  const decisionButton = event.target.closest("[data-decision]");
  if (decisionButton) {
    await saveDecision(decisionButton.dataset.claim, decisionButton.dataset.decision);
    return;
  }

  const clearDecisionButton = event.target.closest("[data-clear-decision]");
  if (clearDecisionButton) {
    await clearDecision(clearDecisionButton.dataset.clearDecision);
    return;
  }

  const mobileButton = event.target.closest("[data-mobile-view]");
  if (mobileButton) {
    state.mobileView = mobileButton.dataset.mobileView;
    render();
    return;
  }

  const receiptButton = event.target.closest("[data-copy-receipt]");
  if (receiptButton) {
    await copyText(receiptButton, proofReceipt());
    return;
  }

  const referenceButton = event.target.closest("[data-copy-reference]");
  if (referenceButton && state.source) {
    await copyText(referenceButton, `${state.source.path}:L${state.source.startLine}-L${state.source.endLine}\nsha256:${state.source.sha256}`);
  }
});

document.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-workspace-select]");
  if (!select) return;
  await switchDurableWorkspace(select.value, { resetUi: true });
});

async function switchDurableWorkspace(workspaceId, { resetUi, message = null }) {
  if (!state.durableState || state.phase === "loading") return;
  state.phase = "boot";
  state.workspaceImported = false;
  render();
  try {
    state.workspaces = await requestWorkspaces();
    await loadWorkspaceState(await requestWorkspace(workspaceId), { resetUi });
    persistActiveWorkspace(workspaceId);
    await refreshTrustOperations();
    state.workspaceNotice = message ? { tone: "success", message } : null;
    state.phase = "ready";
  } catch (error) {
    state.phase = "error";
    state.error = { code: "workspace_refresh_failed", message: error.message || "The durable workspace could not be refreshed." };
  }
  render();
}

document.addEventListener("input", (event) => {
  const search = event.target.closest("[data-workspace-search]");
  if (!search) return;
  state.workspaceQuery = search.value.slice(0, 120);
  ensureVisibleThread();
  persistWorkspaceUi();
  render();
  const replacement = document.querySelector("[data-workspace-search]");
  replacement?.focus();
  replacement?.setSelectionRange(state.workspaceQuery.length, state.workspaceQuery.length);
});

document.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const current = event.target.closest("[data-trust-link]");
  if (!current) return;
  const links = [...document.querySelectorAll("[data-trust-link]")];
  const index = links.indexOf(current);
  if (index < 0) return;
  event.preventDefault();
  const nextIndex = event.key === "Home" ? 0
    : event.key === "End" ? links.length - 1
      : event.key === "ArrowDown" ? Math.min(links.length - 1, index + 1)
        : Math.max(0, index - 1);
  links[nextIndex]?.focus();
});

window.addEventListener("popstate", () => window.location.reload());

document.querySelector("#workspace-file")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 64 * 1024) throw new Error("Workspace files must be 64 KB or smaller.");
    const imported = validateImportedWorkspace(JSON.parse(await file.text()));
    state.workspace = imported;
    state.workspaceImported = true;
    state.workspaceNotice = { tone: "success", message: `Imported ${imported.threads.length} runs from ${file.name}. The file never left this browser.` };
    hydrateWorkspaceUi({ reset: true });
    state.phase = "ready";
    render();
  } catch (error) {
    state.workspaceNotice = { tone: "error", message: error instanceof SyntaxError ? "That file is not valid JSON." : error.message };
    state.phase = "ready";
    render();
  }
});

function verdictLabel(value) {
  return {
    supported: "Verified",
    unsupported: "Unsupported",
    contradictory: "Contradiction",
    stale: "Stale proof",
    uncertain: "Uncertain"
  }[value] || value;
}

function pluralize(count, noun) {
  return count === 1 ? noun : `${noun}s`;
}

function shortPath(value) {
  return String(value || "").split("/").at(-1) || value;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatRelativeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function formatDuration(startValue, endValue) {
  const duration = Date.parse(endValue) - Date.parse(startValue);
  if (!Number.isFinite(duration) || duration < 0) return "Unavailable";
  const minutes = Math.round(duration / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function decisionLabel(status) {
  return {
    approved: "Approved",
    rejected: "Rejected",
    resolved: "Resolved",
    "more-proof": "More proof requested"
  }[status] || status;
}

function workspaceAttentionCount(thread) {
  return new Set([
    ...workspaceOpenReviewClaimIds(thread),
    ...threadStaleClaims(thread).map((claim) => claim.claimId)
  ]).size;
}

function workspaceOpenReviewClaimIds(thread) {
  return thread.reviewClaimIds.filter((claimId) => !decisionClosesGate(threadDecision(thread, claimId)));
}

function threadStaleClaims(thread) {
  return state.claimHistory?.claims?.filter((claim) => claim.threadId === thread.id && claim.state === "stale") || [];
}

function reviewScope(claimId, threadId = state.activeProofThreadId) {
  const thread = state.workspace.threads.find((item) => item.id === threadId);
  return {
    workspaceId: state.workspace.workspace.id,
    threadId: thread?.id || threadId,
    bundleId: thread?.proofBundleId || state.proof?.bundle?.id || state.bundle?.id,
    claimId
  };
}

function currentDecision(finding) {
  if (!finding || !state.activeProofThreadId) return null;
  const scope = reviewScope(finding.claimId);
  const decision = state.decisions[reviewDecisionKey(scope)];
  return reviewDecisionMatches(decision, scope, evidenceIdentity(finding)) ? decision : null;
}

function threadDecision(thread, claimId) {
  const scope = reviewScope(claimId, thread.id);
  const decision = state.decisions[reviewDecisionKey(scope)];
  const activeFinding = thread.id === state.activeProofThreadId
    ? state.proof?.findings.find((finding) => finding.claimId === claimId)
    : null;
  const expectedEvidence = activeFinding ? evidenceIdentity(activeFinding) : thread.reviewEvidence?.[claimId];
  return expectedEvidence && reviewDecisionMatches(decision, scope, expectedEvidence) ? decision : null;
}

function initials(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function eventIcon(type) {
  return {
    file_changed: "diff",
    check_completed: "check",
    claim_made: "claim",
    proof_completed: "guard",
    human_gate: "human",
    run_completed: "check"
  }[type] || "source";
}

function eventNeedsReview(type) {
  return type === "claim_made" || type === "human_gate";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
