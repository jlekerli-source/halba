# Rendered visual QA

- Current recapture: 2026-07-20
- Browser: isolated headless Chrome through the DevTools protocol
- Desktop viewport: 1440 × 1000
- Mobile viewport: 390 × 844

## Surfaces inspected

- Onboarding with the six-source public proof packet.
- Delayed recorded inference and deterministic-adjudication loading state.
- Full three-pane claim queue with an exact contradictory receipt.
- Verified stale-clock claim opened to the actual Build Week diff and line range.
- Four human decisions completed with zero open review gates.
- Optional-live unavailable recovery state.
- Mobile exact-source view with fixed Summary, Claims, and Source navigation.
- Durable three-workspace Trust Inbox, exact degraded receipt, routed Proof Mode, recent decisions, and the complete Claim → Evidence + Guard → Human Decision signature.

## Critique and iteration record

### Round 1 — information hierarchy

The pre-event dashboard made evidence available but did not stage a judge-readable story. Proof Mode was rebuilt around one question, then a run/adjudicate/review sequence. The result uses a dark proof summary, a claim-first queue, and a source inspector so verdict, claim, and proof remain visible together. Mobile changes the layout to three explicit views instead of compressing desktop columns.

### Round 2 — rendered-state defects

The first final-state capture pass revealed black masks in loading, diff, and completed-review screenshots because they were taken during a browser view transition. Those images were rejected. The states were recaptured after animation settlement and visually reinspected. The checked-in screenshots contain no transition masks.

### Round 3 — proof-glyph system and film recut

The final polish pass replaced generic letters, arrows, and punctuation with a consistent stroke-icon family for claims, sources, diffs, receipts, guards, verdicts, and human decisions. Onboarding now introduces a four-step claim → source → guard → human proof trace, which becomes the signature motion system in the film. The mobile trace was changed from a clipped four-column strip to a deliberate 2 × 2 layout.

The earlier 78-second film was rejected as too static. The final cut is a 72-second, nine-shot composition with a contradiction cold-open, animated proof packet, actual app surface, model-versus-receipt override, exact-source magnification, human-decision payoff, eval frame, explicit Codex/GPT-5.6 contribution scene, and trace outro. Twelve frames were extracted from the encoded MP4 and inspected. HeyGen narration was generated per scene and aligned to the timeline; an original synthesized bed and transition pulse were mixed into the current encode at −16.3 LUFS integrated with a −4.3 dB true peak. The current first scene explains the operational problem, while the source-backed packet and closing beats make the Codex/GPT-5.6/deterministic/human boundaries explicit.

### Round 4 — portable review handoff

The completed review previously ended with a clipboard-only receipt. The summary pane now gives the portable review record first visual priority, followed by the existing copy and rerun actions. The native download carries every verdict, model boundary, exact source range and SHA-256, deterministic guard, and browser-local human decision. The rendered desktop control was inspected after animation settlement; its icon, 40-pixel target, contrast, wrapping, and dark-pane spacing match the existing action system.

### Round 5 — agent workspace and real mobile layout

The first viewport was rebuilt as a local agent workspace: attention and channels on the left, a typed Codex run in the center, and the selected run/evidence manifest on the right. The completion handoff opens the unchanged Proof Mode authority path. The workspace is driven by a validated fixture reproducible from the public-safe Codex proof packet, not presentation-only markup.

The first 390 × 844 capture appeared to clip the thread. Browser metrics proved the command-line renderer had clamped layout to 500 pixels and then cropped the bitmap. Chrome device emulation was used for the accepted capture; it reported `innerWidth=390`, `scrollWidth=390`, and the thread body ending at 374 pixels. A separate real defect in the compact top action was fixed by retaining its icon and hiding the long label below 820 pixels. Desktop and mobile were recaptured after reload and animation settlement.

The interaction pass proved workspace → Proof Mode → contradictory receipt, **Request proof** preserving four open gates, approval reducing the channel to three, and the Markdown export containing both the approved decision and its timestamp.

### Round 6 — Trust Operations identity and evidence-current recapture

The final flagship pass replaced Run → Adjudicate → Review vocabulary with Claim → Evidence + Guard → Human Decision across the global header, Trust Inbox circuit, Proof Mode rail, mobile tabs, film, gallery, and submission copy. Human-readable claim text now leads ranked cards while stable machine keys remain secondary metadata. Global model-run controls no longer compete with Trust Inbox, receipt, decision-history, or Proof tasks.

Two isolated browser lanes now produce the accepted assets: one seeds the deterministic three-workspace Trust Inbox and proves ranking, keyboard/focus behavior, exact receipts, decisions, responsive reflow, and a clean runtime; the other starts the credential-free public packet and proves workspace, loading, recoverable live error, source-backed recorded Proof Mode, mobile exact source, and the fully resolved review state. All listed screenshots were recaptured from these current lanes at 1440 × 1000 or 390 × 844.

### Round 7 — first-minute claim continuity

An independent skeptical-judge pass found that the film moved from the synthetic Trust Inbox item to a separate source-backed Proof Mode claim without making the claim change explicit in the encode. The Proof Mode scene now carries **Example 2 · different claim · source-backed packet** for its full duration. The encoded transition was inspected at 22.5 seconds and preserves the narration, captions, and model-versus-receipt boundary while preventing the receipt from being mistaken for evidence attached to the synthetic ranked item.

### Round 8 — submission-rule and provider closure

The accepted 58-second cut explained the product boundary but did not explicitly narrate how Codex accelerated the Build Week implementation. The final 72-second cut adds one bounded scene naming the Codex-built audit, Trust Inbox, Proof Mode, evaluation corpus, release proof, and film, while separately stating GPT-5.6's in-product role. HeyGen's Daniel voice was generated per scene, duration-bounded, assembled with explicit silence padding, and checked against three representative caption states before the final encode. The full MP4 decoded without error and its twelve-frame contact sheet preserves the intended claim sequence through the final trace.

## Result

- The onboarding question and primary recorded-demo action are legible in the first viewport.
- Recorded versus optional-live execution remains visible in every relevant state.
- Verdict color is always paired with text.
- The actual diff path, exact line range, quote match, hash prefix, reasoning boundary, and deterministic guard are legible without opening developer tools.
- The completed state makes zero remaining review gates explicit and preserves access to the rest of the graph.
- The mobile source view preserves the proof trail and human action targets without horizontal page overflow; long code remains contained in its source panel.
- The normal onboarding-to-recorded-proof path produced zero console errors or warnings. The optional-live error test produced one expected failed HTTP request and a recoverable product state.
- Headings use balanced wrapping, body copy uses pretty wrapping, numeric dashboard values use tabular figures, nested surfaces use concentric radii, interactive controls retain at least 40-pixel targets, and reduced-motion users bypass decorative animation.
- The current local release browser gate proves both durable Trust Inbox and the credential-free public Proof packet with zero unexpected console/network findings. External Pages, YouTube, GitHub, and Devpost publication parity remains a separate post-publication verification gate and was not claimed by the July 20 recapture.

## Accepted artifacts

- `artifacts/screenshots/onboarding-desktop.png`
- `artifacts/screenshots/loading-desktop.png`
- `artifacts/screenshots/proof-desktop.png`
- `artifacts/screenshots/proof-diff-desktop.png`
- `artifacts/screenshots/review-resolved-desktop.png`
- `artifacts/screenshots/live-unavailable-desktop.png`
- `artifacts/screenshots/proof-mobile-source.png`
- `artifacts/screenshots/workspace-desktop.jpg`
- `artifacts/screenshots/workspace-mobile.jpg`
- `artifacts/screenshots/workspace-proof-desktop.jpg`
