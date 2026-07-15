import { validateImportedWorkspace } from "./workspace-import.js";
import { decisionClosesGate, shouldAdvanceReviewSelection } from "./workspace-state.js";

const decisionStorageKey = "halba:proof-decisions:v1";
const workspaceUiStorageKey = "halba:workspace-ui:v1";

const state = {
  phase: "boot",
  bundle: null,
  workspace: null,
  proof: null,
  error: null,
  activeRunMode: null,
  selectedClaimId: null,
  selectedCitationIndex: 0,
  source: null,
  sourceStatus: "idle",
  sourceError: null,
  filter: "review",
  mobileView: "summary",
  decisions: readDecisions(),
  selectedThreadId: null,
  activeProofThreadId: null,
  workspaceScope: { kind: "channel", id: null },
  workspaceFilter: "all",
  workspaceQuery: "",
  workspaceNotice: null,
  workspaceImported: false
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
    [state.bundle, state.workspace] = await Promise.all([requestBundle(), requestWorkspace()]);
    hydrateWorkspaceUi();
    state.phase = "ready";
  } catch (error) {
    state.phase = "error";
    state.error = {
      code: "workspace_unavailable",
      message: error.message || "The public agent workspace could not be loaded."
    };
  }
  render();
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
  executionBadge.textContent = execution
    ? `${execution.mode === "recorded" ? "Recorded replay" : "Live response"} · ${execution.model}`
    : "Public demo";

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
    : "";
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
  const threads = visibleWorkspaceThreads();
  const thread = selectedWorkspaceThread(threads);
  const scope = workspaceScopeDetails();
  const openReviewCount = workspaceTotalAttention();
  return `
    <section class="workspace-shell">
      <aside class="workspace-rail" aria-label="${escapeHtml(workspace.name)} workspace">
        <div class="workspace-switcher">
          <span class="workspace-mark">${escapeHtml(initials(workspace.name))}</span>
          <div><strong>${escapeHtml(workspace.name)}</strong><small>${state.workspaceImported ? "Imported browser session" : "Public-safe local sample"}</small></div>
          <span class="local-dot">Local</span>
        </div>

        <nav class="workspace-nav" aria-label="Workspace navigation">
          <p>Attention</p>
          ${workspaceNavButton({ kind: "attention", id: "review", iconName: openReviewCount ? "alert" : "check", label: openReviewCount ? "Needs review" : "Review complete", count: openReviewCount, alert: openReviewCount > 0 })}
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
      </aside>

      <main class="channel-thread">
        ${state.workspaceNotice ? `<div class="workspace-notice notice-${escapeHtml(state.workspaceNotice.tone)}" role="status">${icon(state.workspaceNotice.tone === "error" ? "alert" : "check")}<span>${escapeHtml(state.workspaceNotice.message)}</span><button type="button" data-dismiss-notice aria-label="Dismiss">×</button></div>` : ""}
        <header class="channel-head">
          <div>
            <p class="eyebrow">${escapeHtml(scope.eyebrow)}</p>
            <h1>${scope.kind === "channel" ? "<span>#</span>" : ""}${escapeHtml(scope.title)}</h1>
            <p>${escapeHtml(scope.description)}</p>
          </div>
          <span class="channel-status${openReviewCount ? "" : " is-complete"}"><i></i>${openReviewCount ? `${openReviewCount} decisions needed` : "Review complete"}</span>
        </header>

        <section class="workspace-toolbar" aria-label="Run controls">
          <label class="workspace-search">${icon("search")}<input type="search" data-workspace-search placeholder="Search runs and evidence" value="${escapeHtml(state.workspaceQuery)}" aria-label="Search runs and evidence"></label>
          <div class="workspace-filters" aria-label="Filter runs">
            ${workspaceFilterButton("all", "All")}
            ${workspaceFilterButton("review", "Needs review")}
            ${workspaceFilterButton("completed", "Completed")}
          </div>
        </section>

        ${threads.length ? `
          <div class="run-index" role="list" aria-label="Runs in this view">
            ${threads.map(renderRunIndexItem).join("")}
          </div>
          ${renderSelectedThread(thread)}
        ` : renderEmptyWorkspace()}
      </main>

      ${renderRunInspector(thread)}
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
    <button class="run-index-item status-${escapeHtml(thread.status)}${selected ? " is-selected" : ""}" type="button" data-thread-id="${escapeHtml(thread.id)}" aria-pressed="${selected}" role="listitem">
      <span class="agent-presence">${escapeHtml(agent.initial)}</span>
      <span class="run-index-copy"><strong>${escapeHtml(thread.title)}</strong><small>${escapeHtml(agent.name)} · ${formatRelativeDate(thread.updatedAt)}</small></span>
      <span class="run-index-status">${openCount ? `${openCount} open` : threadStatusLabel(thread.status)}</span>
    </button>
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
      <p class="mode-disclosure">${state.workspaceImported ? "Imported data stays in this browser session and is never uploaded." : "The public sample is synthetic and bounded. Only the selected proof-ready run can open the checked-in evidence packet."}</p>
    </aside>
  `;
}

function renderEmptyWorkspace() {
  return `<section class="workspace-empty"><span>${icon("search")}</span><h2>No runs match this view.</h2><p>Clear the search or choose a different status, channel, or agent.</p><button class="text-action" type="button" data-clear-workspace-filters>Clear filters</button></section>`;
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
    || (saved.scopeKind === "attention" && saved.scopeId === "review")
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
      return workspaceAttentionCount(thread) > 0;
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
    <section class="error-state">
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
  const decisions = Object.values(state.decisions).filter((decision) => decisionClosesGate(decision) && proof.findings.some((finding) => finding.claimId === decision.claimId));
  const openReviewCount = proof.findings.filter((finding) => finding.reviewRequired && !decisionClosesGate(state.decisions[finding.claimId])).length;
  const reviewRecordUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(proofReceipt())}`;
  return `
    <button class="workspace-back" type="button" data-reset>${icon("arrow")}Back to #${escapeHtml(channel.name)}</button>
    <div class="pane-head">
      <div>
        <p class="eyebrow">Proof result</p>
        <h2>${escapeHtml(proof.bundle.title)}</h2>
      </div>
      <span class="mode-pill mode-${escapeHtml(proof.execution.mode)}">${proof.execution.mode === "recorded" ? "Recorded" : "Live"}</span>
    </div>

    <section class="review-total">
      <span>Needs human review</span>
      <strong>${openReviewCount}</strong>
      <small>${proof.counts.supported} verified · ${decisions.length} decided</small>
    </section>

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
  const decision = state.decisions[finding.claimId];
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

  const decision = state.decisions[finding.claimId];
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

    <section class="human-gate">
      <div class="human-gate-head">
        <div>
          <p class="eyebrow">Human gate</p>
          <h3>${decision ? escapeHtml(decisionLabel(decision.status)) : "What should happen to this claim?"}</h3>
        </div>
        ${decision ? `<button class="text-action" type="button" data-clear-decision="${escapeHtml(finding.claimId)}">Clear</button>` : ""}
      </div>
      <label>
        <span>Review note <small>optional, stored only in this browser</small></span>
        <textarea id="review-note" rows="2" placeholder="Why does this claim pass or fail review?">${escapeHtml(decision?.note || "")}</textarea>
      </label>
      <div class="decision-actions">
        <button type="button" class="decision-button approve" data-decision="approved" data-claim="${escapeHtml(finding.claimId)}">Approve</button>
        <button type="button" class="decision-button reject" data-decision="rejected" data-claim="${escapeHtml(finding.claimId)}">Reject</button>
        <button type="button" class="decision-button resolve" data-decision="resolved" data-claim="${escapeHtml(finding.claimId)}">Resolve</button>
        <button type="button" class="decision-button more-proof" data-decision="more-proof" data-claim="${escapeHtml(finding.claimId)}">Request proof</button>
      </div>
    </section>
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
  if (state.filter === "decided") return state.proof.findings.filter((finding) => state.decisions[finding.claimId]);
  return state.proof.findings.filter((finding) => finding.reviewRequired && !decisionClosesGate(state.decisions[finding.claimId]));
}

function selectedFinding() {
  return state.proof?.findings.find((finding) => finding.claimId === state.selectedClaimId) || null;
}

async function runProof(mode, threadId) {
  if (state.phase === "loading") return;
  const thread = proofReadyThread(threadId);
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
    const body = await requestProof(mode);
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
    const body = await requestSource(citation);
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

async function requestBundle() {
  if (staticDemoMode) return (await loadStaticDemo()).bundle;
  const response = await fetch("/api/proof/bundle");
  if (!response.ok) throw new Error("The public proof bundle could not be loaded.");
  return response.json();
}

async function requestWorkspace() {
  if (staticDemoMode) return (await loadStaticDemo()).workspace;
  const response = await fetch("/api/workspace");
  if (!response.ok) throw new Error("The public agent workspace could not be loaded.");
  return response.json();
}

async function requestProof(mode) {
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
    body: JSON.stringify({ mode })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "Proof analysis failed.");
    error.code = body.error || "proof_error";
    throw error;
  }
  return body;
}

async function requestSource(citation) {
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

function saveDecision(claimId, status) {
  const note = document.querySelector("#review-note")?.value.trim() || "";
  state.decisions[claimId] = {
    claimId,
    status,
    note,
    updatedAt: new Date().toISOString()
  };
  persistDecisions();
  const next = filteredFindings().find((finding) => finding.claimId !== claimId);
  if (state.filter === "review" && shouldAdvanceReviewSelection(status) && next) state.selectedClaimId = next.claimId;
  render();
  loadSelectedSource();
}

function clearDecision(claimId) {
  delete state.decisions[claimId];
  persistDecisions();
  render();
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
  const responseCount = proof.findings.filter((finding) => state.decisions[finding.claimId]).length;
  const closedCount = proof.findings.filter((finding) => decisionClosesGate(state.decisions[finding.claimId])).length;
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
      const decision = state.decisions[finding.claimId];
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
    ensureVisibleThread();
    persistWorkspaceUi();
    render();
    return;
  }

  const threadButton = event.target.closest("[data-thread-id]");
  if (threadButton) {
    state.selectedThreadId = threadButton.dataset.threadId;
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
    saveDecision(decisionButton.dataset.claim, decisionButton.dataset.decision);
    return;
  }

  const clearDecisionButton = event.target.closest("[data-clear-decision]");
  if (clearDecisionButton) {
    clearDecision(clearDecisionButton.dataset.clearDecision);
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
  return thread.reviewClaimIds.filter((claimId) => !decisionClosesGate(state.decisions[claimId])).length;
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
