# Rendered visual QA

- Date: 2026-07-13
- Browser: Chromium through Playwright CLI
- Desktop viewport: 1440 × 960
- Mobile viewport: 390 × 844

## Surfaces inspected

- Onboarding with the six-source public proof packet.
- Delayed recorded inference and deterministic-adjudication loading state.
- Full three-pane claim queue with an exact contradictory receipt.
- Verified stale-clock claim opened to the actual Build Week diff and line range.
- Four human decisions completed with zero open review gates.
- Optional-live unavailable recovery state.
- Mobile exact-source view with fixed Summary, Claims, and Source navigation.

## Critique and iteration record

### Round 1 — information hierarchy

The pre-event dashboard made evidence available but did not stage a judge-readable story. Proof Mode was rebuilt around one question, then a run/adjudicate/review sequence. The result uses a dark proof summary, a claim-first queue, and a source inspector so verdict, claim, and proof remain visible together. Mobile changes the layout to three explicit views instead of compressing desktop columns.

### Round 2 — rendered-state defects

The first final-state capture pass revealed black masks in loading, diff, and completed-review screenshots because they were taken during a browser view transition. Those images were rejected. The states were recaptured after animation settlement and visually reinspected. The checked-in screenshots contain no transition masks.

### Round 3 — proof-glyph system and film recut

The final polish pass replaced generic letters, arrows, and punctuation with a consistent stroke-icon family for claims, sources, diffs, receipts, guards, verdicts, and human decisions. Onboarding now introduces a four-step claim → source → guard → human proof trace, which becomes the signature motion system in the film. The mobile trace was changed from a clipped four-column strip to a deliberate 2 × 2 layout.

The earlier 78-second film was rejected as too static. Its replacement is a 58-second, eight-shot composition with a contradiction cold-open, animated proof packet, actual app surface, model-versus-receipt override, exact-source magnification, human-decision payoff, eval frame, and trace outro. Eight frames were extracted from the encoded MP4 and inspected. Narration was generated per scene and aligned to the timeline; an original synthesized bed and transition pulse were mixed to −16.0 LUFS integrated / −1.4 dB true peak.

## Result

- The onboarding question and primary recorded-demo action are legible in the first viewport.
- Recorded versus optional-live execution remains visible in every relevant state.
- Verdict color is always paired with text.
- The actual diff path, exact line range, quote match, hash prefix, reasoning boundary, and deterministic guard are legible without opening developer tools.
- The completed state makes zero remaining review gates explicit and preserves access to the rest of the graph.
- The mobile source view preserves the proof trail and human action targets without horizontal page overflow; long code remains contained in its source panel.
- The normal onboarding-to-recorded-proof path produced zero console errors or warnings. The optional-live error test produced one expected failed HTTP request and a recoverable product state.
- Headings use balanced wrapping, body copy uses pretty wrapping, numeric dashboard values use tabular figures, nested surfaces use concentric radii, interactive controls retain at least 40-pixel targets, and reduced-motion users bypass decorative animation.

## Accepted artifacts

- `artifacts/screenshots/onboarding-desktop.png`
- `artifacts/screenshots/loading-desktop.png`
- `artifacts/screenshots/proof-desktop.png`
- `artifacts/screenshots/proof-diff-desktop.png`
- `artifacts/screenshots/review-resolved-desktop.png`
- `artifacts/screenshots/live-unavailable-desktop.png`
- `artifacts/screenshots/proof-mobile-source.png`
