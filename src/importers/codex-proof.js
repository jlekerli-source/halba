import { validateWorkspace } from "../domain/workspace.js";
import { evidenceIdentity } from "../../public/shared/review-contract.js";

function slug(value) {
  return String(value || "agent")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "agent";
}

function minutesBefore(value, minutes) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("invalid Codex run: generatedAt must be a timestamp");
  return new Date(timestamp - minutes * 60_000).toISOString();
}

function formatBytes(value) {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
}

export function workspaceFromCodexProof(bundle, proof) {
  const definition = bundle?.definition || bundle;
  if (!definition?.id || !definition?.agent || !definition?.generatedAt) throw new Error("invalid Codex run: proof bundle metadata is incomplete");
  if (proof?.bundle?.id !== definition.id) throw new Error("invalid Codex run: adjudication does not match the proof bundle");

  const agentId = slug(definition.agent);
  const diff = bundle.sources.find((source) => source.kind === "diff");
  const receiptCount = bundle.sources.filter((source) => source.kind === "receipt").length;
  const events = [
    {
      id: "source-boundary",
      type: "note",
      at: minutesBefore(definition.generatedAt, 15),
      title: "Indexed the bounded source packet",
      detail: `${bundle.sources.length} sources · ${formatBytes(bundle.totalBytes)} · SHA-256 indexed`
    },
    ...(diff ? [{
      id: "source-change",
      type: "file_changed",
      at: minutesBefore(definition.generatedAt, 10),
      title: `Attached ${diff.label}`,
      detail: `${diff.path} · exact bytes available in Proof Mode`
    }] : []),
    {
      id: "proof-checks",
      type: "check_completed",
      at: minutesBefore(definition.generatedAt, 5),
      title: "Captured deterministic receipts",
      detail: `${receiptCount} receipts · guard inputs preserved`
    },
    {
      id: "completion-claims",
      type: "claim_made",
      at: definition.generatedAt,
      title: `Handed off ${proof.findings.length} completion claims`,
      detail: `${proof.reviewRequiredCount} require human judgment`
    }
  ];

  const proofThread = {
    id: slug(`${definition.id}-run`),
    channelId: "halba-build-week",
    agentId,
    title: "Halba Build Week proof review",
    goal: "Turn agent completion reports into reviewable proof",
    summary: `${definition.agent} handed off a bounded completion report with ${proof.findings.length} claims. Halba routed ${proof.reviewRequiredCount} to human review instead of treating “done” as authority.`,
    status: proof.reviewRequiredCount ? "needs_review" : "completed",
    proofState: "ready",
    startedAt: minutesBefore(definition.generatedAt, 18),
    updatedAt: definition.generatedAt,
    completedAt: definition.generatedAt,
    proofBundleId: definition.id,
    claimCount: proof.findings.length,
    claimIds: proof.findings.map((finding) => finding.claimId),
    reviewGateCount: proof.reviewRequiredCount,
    reviewClaimIds: proof.findings.filter((finding) => finding.reviewRequired).map((finding) => finding.claimId),
    reviewEvidence: Object.fromEntries(
      proof.findings
        .filter((finding) => finding.reviewRequired)
        .map((finding) => [finding.claimId, evidenceIdentity(finding)])
    ),
    verdictCounts: proof.counts,
    events
  };

  return validateWorkspace({
    schemaVersion: 1,
    workspace: { id: "build-week", name: "Build Week" },
    channels: [
      { id: "halba-build-week", name: "halba-build-week", topic: "Agent runs, product changes, and completion claims for the Build Week release." },
      { id: "release-readiness", name: "release-readiness", topic: "Sanitization, package reconstruction, and deploy checks." },
      { id: "agent-adapters", name: "agent-adapters", topic: "Bounded imports that translate agent output into typed evidence events." }
    ],
    agents: [
      { id: agentId, name: definition.agent, role: "coding agent", initial: definition.agent[0].toUpperCase() },
      { id: "proof-guard", name: "Proof Guard", role: "deterministic verifier", initial: "G" },
      { id: "release-bot", name: "Release Bot", role: "release verifier", initial: "R" }
    ],
    threads: [
      proofThread,
      operationalThread({
        id: "workspace-responsive-qa",
        channelId: "halba-build-week",
        agentId: "proof-guard",
        title: "Workspace responsive QA",
        goal: "Prove the agent workspace at desktop and mobile widths",
        summary: "Proof Guard checked the real workspace render at 1440 and 390 CSS pixels, verified zero horizontal overflow, and preserved accepted screenshots.",
        startedAt: "2026-07-13T07:40:00.000Z",
        completedAt: "2026-07-13T08:05:00.000Z",
        events: [
          ["viewport-loaded", "run_started", "Loaded the public workspace", "Node demo · clean browser state"],
          ["desktop-checked", "check_completed", "Checked desktop hierarchy", "1440 × 1000 · workspace, thread, inspector"],
          ["mobile-checked", "check_completed", "Checked the real mobile viewport", "390 CSS px · zero horizontal overflow"],
          ["screenshots-captured", "run_completed", "Preserved accepted renders", "desktop, mobile, and exact-source proof"]
        ]
      }),
      operationalThread({
        id: "sanitized-release-rebuild",
        channelId: "release-readiness",
        agentId: "release-bot",
        title: "Sanitized release reconstruction",
        goal: "Rebuild the public package from the explicit allowlist",
        summary: "Release Bot reconstructed the public tree, reran checks, smoke tests, and evals inside the package and extracted archive, then wrote a SHA-256 evidence record.",
        startedAt: "2026-07-13T10:12:00.000Z",
        completedAt: "2026-07-13T10:39:00.000Z",
        events: [
          ["allowlist-loaded", "note", "Loaded the public allowlist", "private paths remain excluded"],
          ["package-rebuilt", "file_changed", "Reconstructed the clean package", "allowlisted files only"],
          ["release-suites", "check_completed", "Ran package and archive suites", "check · smoke · eval"],
          ["release-hashed", "run_completed", "Wrote release evidence", "archive SHA-256 recorded"]
        ]
      }),
      operationalThread({
        id: "codex-proof-adapter",
        channelId: "agent-adapters",
        agentId,
        title: "Codex proof-run adapter",
        goal: "Import a bounded public-safe Codex proof run reproducibly",
        summary: "Codex translated the public completion packet into typed source, file, check, and claim events. The checked-in workspace is reproduced byte-for-byte by the adapter check.",
        startedAt: "2026-07-13T13:18:00.000Z",
        completedAt: "2026-07-13T13:34:00.000Z",
        events: [
          ["adapter-input", "note", "Read bounded proof metadata", "raw private transcripts are out of scope"],
          ["adapter-events", "file_changed", "Mapped four typed events", "source · diff · receipt · claims"],
          ["adapter-contract", "check_completed", "Validated workspace contract", "safe ids, references, timestamps, and gates"],
          ["adapter-replay", "run_completed", "Confirmed deterministic replay", "checked-in fixture matches generated output"]
        ]
      })
    ]
  }, { proofBundleId: definition.id });
}

function operationalThread({ id, channelId, agentId, title, goal, summary, startedAt, completedAt, events }) {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  const step = (end - start) / Math.max(1, events.length - 1);
  return {
    id,
    channelId,
    agentId,
    title,
    goal,
    summary,
    status: "completed",
    proofState: "not_required",
    startedAt,
    updatedAt: completedAt,
    completedAt,
    proofBundleId: null,
    claimCount: 0,
    claimIds: [],
    reviewGateCount: 0,
    reviewClaimIds: [],
    reviewEvidence: {},
    verdictCounts: { supported: 0, unsupported: 0, contradictory: 0, stale: 0, uncertain: 0 },
    events: events.map(([eventId, type, eventTitle, detail], index) => ({
      id: eventId,
      type,
      at: new Date(start + step * index).toISOString(),
      title: eventTitle,
      detail
    }))
  };
}
