const decisionStorageKey = "halba:proof-decisions:v1";

const state = {
  phase: "boot",
  bundle: null,
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
  decisions: readDecisions()
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
    state.bundle = await requestBundle();
    state.phase = "ready";
  } catch (error) {
    state.phase = "error";
    state.error = {
      code: "bundle_unavailable",
      message: error.message || "The public proof bundle could not be loaded."
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
      (state.phase === "ready" && name === "run")
      || (state.phase === "loading" && name === "adjudicate")
      || (state.phase === "proof" && name === "review")
    );
    const complete = (
      (state.phase === "loading" && name === "run")
      || (state.phase === "proof" && ["run", "adjudicate"].includes(name))
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
  const bundle = state.bundle;
  return `
    <section class="onboarding">
      <div class="onboarding-copy">
        <p class="eyebrow">Local-first evidence control plane</p>
        <h1>Agent says “done.”<br><span>Halba asks for proof.</span></h1>
        <p class="lede">Turn completion reports, diffs, source files, and run receipts into a traceable proof graph. GPT-5.6 finds the claim boundary; deterministic guards decide what the bytes can prove.</p>

        <ol class="proof-trace" aria-label="How Halba evaluates a claim">
          <li>${icon("claim")}<span><strong>Claim</strong><small>Extract the assertion</small></span></li>
          <li>${icon("source")}<span><strong>Source</strong><small>Open exact lines</small></span></li>
          <li>${icon("guard")}<span><strong>Guard</strong><small>Check actual facts</small></span></li>
          <li>${icon("human")}<span><strong>Human</strong><small>Decide the boundary</small></span></li>
        </ol>

        <div class="onboarding-actions">
          <button class="button button-primary button-large" type="button" data-run-mode="recorded">
            ${icon("play", "button-icon")}<span class="button-copy"><strong>Review the public run</strong>
            <span>Recorded, deterministic demo</span>
            </span>
          </button>
          <button class="button button-secondary button-large" type="button" data-run-mode="live">
            ${icon("pulse", "button-icon")}<span class="button-copy"><strong>Run live GPT-5.6</strong>
            <span>Optional in the local runtime</span>
            </span>
          </button>
        </div>

        <dl class="trust-strip">
          <div><dt>Model</dt><dd>GPT-5.6 Sol</dd></div>
          <div><dt>Reasoning</dt><dd>Max</dd></div>
          <div><dt>Storage</dt><dd>Off</dd></div>
          <div><dt>Authority</dt><dd>Deterministic guards</dd></div>
        </dl>
      </div>

      <aside class="packet-preview" aria-label="Public proof packet">
        <div class="packet-head">
          <span>Evidence packet</span>
          <strong>${escapeHtml(bundle.id)}</strong>
        </div>
        <div class="packet-title">
          <span class="packet-glyph" aria-hidden="true">${icon("packet")}</span>
          <div>
            <small>Ready to review</small>
            <h2>${escapeHtml(bundle.title)}</h2>
            <p>${escapeHtml(bundle.agent)} · ${formatTimestamp(bundle.generatedAt)}</p>
          </div>
        </div>
        <ul class="source-stack">
          ${bundle.sources.map((source, index) => `
            <li style="--source-index:${index}">
              <span class="source-kind">${sourceKindIcon(source.kind)}<em>${escapeHtml(source.kind)}</em></span>
              <strong>${escapeHtml(source.label)}</strong>
              <small>${escapeHtml(source.path)} · ${source.lineCount} lines</small>
            </li>
          `).join("")}
        </ul>
        <div class="packet-foot">
          <span>${bundle.sourceCount} sources</span>
          <span>${formatBytes(bundle.totalBytes)}</span>
          <span>SHA-256 indexed</span>
        </div>
      </aside>
    </section>
  `;
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
  const decisions = Object.values(state.decisions).filter((decision) => proof.findings.some((finding) => finding.claimId === decision.claimId));
  const openReviewCount = proof.findings.filter((finding) => finding.reviewRequired && !state.decisions[finding.claimId]).length;
  const reviewRecordUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(proofReceipt())}`;
  return `
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
        ${decision ? `<span class="decision-pill decision-${escapeHtml(decision.status)}">Human: ${escapeHtml(decision.status)}</span>` : ""}
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
          <h3>${decision ? `Marked ${escapeHtml(decision.status)}` : "What should happen to this claim?"}</h3>
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
    download: '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>'
  };
  return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.claim}</svg>`;
}

function filteredFindings() {
  if (!state.proof) return [];
  if (state.filter === "all") return state.proof.findings;
  if (state.filter === "supported") return state.proof.findings.filter((finding) => finding.verdict === "supported");
  if (state.filter === "decided") return state.proof.findings.filter((finding) => state.decisions[finding.claimId]);
  return state.proof.findings.filter((finding) => finding.reviewRequired && !state.decisions[finding.claimId]);
}

function selectedFinding() {
  return state.proof?.findings.find((finding) => finding.claimId === state.selectedClaimId) || null;
}

async function runProof(mode) {
  if (state.phase === "loading") return;
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
      if (body?.schemaVersion !== 1 || !body.bundle || !body.proof || !body.sources) {
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
  if (state.filter === "review" && next) state.selectedClaimId = next.claimId;
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
  const decisionCount = proof.findings.filter((finding) => state.decisions[finding.claimId]).length;
  return [
    "# Halba Proof Mode review record",
    "",
    `- Bundle: ${proof.bundle.id}`,
    `- Generated: ${proof.bundle.generatedAt}`,
    `- Execution: ${proof.execution.mode} / ${proof.execution.model} / reasoning ${proof.execution.reasoningEffort}`,
    `- API storage: ${proof.execution.store ? "on" : "off"}`,
    `- Verdicts: ${proof.counts.supported} verified, ${proof.counts.unsupported} unsupported, ${proof.counts.contradictory} contradictory, ${proof.counts.stale} stale, ${proof.counts.uncertain} uncertain`,
    `- Human decisions: ${decisionCount} of ${proof.findings.filter((finding) => finding.reviewRequired).length} review gates`,
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
    await runProof(runButton.dataset.runMode);
    return;
  }

  const resetButton = event.target.closest("[data-reset]");
  if (resetButton) {
    state.phase = state.bundle ? "ready" : "boot";
    state.error = null;
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

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
