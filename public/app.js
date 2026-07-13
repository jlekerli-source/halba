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
        <h1>Can this agent claim<br>pass human review?</h1>
        <p class="lede">Halba turns a completion report, source files, and run receipts into a traceable proof graph. GPT-5.6 extracts the claim boundary. Deterministic guards decide what the evidence can actually prove.</p>

        <div class="onboarding-actions">
          <button class="button button-primary button-large" type="button" data-run-mode="recorded">
            Review the public run
            <span>Recorded, deterministic demo</span>
          </button>
          <button class="button button-secondary button-large" type="button" data-run-mode="live">
            Run live GPT-5.6
            <span>Uses a local API key when configured</span>
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
          <span class="packet-glyph" aria-hidden="true">H</span>
          <div>
            <small>Ready to review</small>
            <h2>${escapeHtml(bundle.title)}</h2>
            <p>${escapeHtml(bundle.agent)} · ${formatTimestamp(bundle.generatedAt)}</p>
          </div>
        </div>
        <ul class="source-stack">
          ${bundle.sources.map((source, index) => `
            <li style="--source-index:${index}">
              <span class="source-kind">${escapeHtml(source.kind)}</span>
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
      <div class="analysis-orbit" aria-hidden="true"><span></span><i></i></div>
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
      <span class="claim-arrow" aria-hidden="true">→</span>
    </button>
  `;
}

function renderTracePane(finding) {
  if (!finding) {
    return `
      <div class="trace-empty">
        <span aria-hidden="true">↗</span>
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
          <span>${guard.passed ? "✓" : "!"}</span>
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
      <span aria-hidden="true">∅</span>
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
      <span aria-hidden="true">✓</span>
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
      <span>${verdictLabel(verdict)}</span>
      <strong>${count}</strong>
    </div>
  `;
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
    "Halba Proof Mode receipt",
    `bundle: ${proof.bundle.id}`,
    `mode: ${proof.execution.mode}`,
    `model: ${proof.execution.model}`,
    `reasoning: ${proof.execution.reasoningEffort}`,
    `store: ${proof.execution.store}`,
    `supported: ${proof.counts.supported}`,
    `unsupported: ${proof.counts.unsupported}`,
    `contradictory: ${proof.counts.contradictory}`,
    `stale: ${proof.counts.stale}`,
    `uncertain: ${proof.counts.uncertain}`,
    `human decisions: ${decisionCount}`,
    "",
    ...proof.findings.map((finding) => `- ${finding.claimId}: ${finding.verdict}${state.decisions[finding.claimId] ? ` / human ${state.decisions[finding.claimId].status}` : ""}`)
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
