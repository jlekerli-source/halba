# Halba Build Week video

This isolated Remotion project renders the captioned 72-second product film from public-safe Halba screenshots, scene-aligned HeyGen narration, and an original programmatic sound bed. It is not part of Halba's dependency-free product runtime.

## Commands

```bash
npm install
npm run lint
npm run still
npm run thumbnail
npm run render
```

The render uses `../../artifacts` as its public asset directory and writes `artifacts/demo/halba-demo.mp4`. Captions are typed JSON under `src/captions.json`; narration copy is in `narration.txt`. The accepted render uses one Chromium worker and a 120-second browser timeout because concurrent startup was unreliable on the Build Week Mac.

`npm run thumbnail` renders the 1200 × 800 Devpost gallery image from the Trust Circuit visual system and current Trust Inbox screenshot. The accepted OG and square crops derive from that render.

## Accepted render

- Duration: 72.04 seconds encoded; 72.00-second composition
- Video: H.264, 1280 × 720, 30 fps
- Audio: AAC, 48 kHz stereo; measured at −16.3 LUFS integrated and −4.3 dB true peak
- SHA-256: `bedaad04931a630fced3555aaf32cc3a9d499015306890b0defab6ef0c6779fa`

Twelve frames extracted from the encoded MP4 were inspected across the full sequence. The current film covers the contradiction cold-open, cross-workspace Trust Inbox, deterministic ranking, separate source-backed Proof Mode packet, exact source, evidence-scoped human gate, Trust Operations benchmark, an explicit Codex/GPT-5.6 contribution scene, and the outro. The second example is labeled **different claim** for its full scene so the source-backed receipt cannot be mistaken for evidence attached to the synthetic ranked item. Narration and burned-in captions distinguish the synthetic benchmark from source-backed proof, state how Codex accelerated the build and how GPT-5.6 is used inside Halba, and make no live-request or human-comprehension claim. `npm run lint` passes for this isolated project.
