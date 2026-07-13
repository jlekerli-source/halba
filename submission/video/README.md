# Halba Build Week video

This isolated Remotion project renders the captioned 58-second product film from public-safe Halba screenshots, local narration, and an original programmatic sound bed. It is not part of Halba's dependency-free product runtime.

## Commands

```bash
npm install
npm run lint
npm run still
npm run thumbnail
npm run render
```

The render uses `../../artifacts` as its public asset directory and writes `artifacts/demo/halba-demo.mp4`. Captions are typed JSON under `src/captions.json`; narration copy is in `narration.txt`. Rendering is capped at two Chromium workers because higher concurrency was unreliable on the Build Week Mac.

`npm run thumbnail` renders the 1200 × 800 Devpost gallery image from the same visual system and accepted Proof Mode screenshot.

## Accepted render

- Duration: 58.10 seconds encoded; 58.00-second composition
- Video: H.264, 1280 × 720, 30 fps
- Audio: AAC, 48 kHz stereo; measured at −16.2 LUFS integrated and −1.4 dB true peak
- SHA-256: `3ea02dadd67a4eb7ba80034cb8b3ab79dd2a76844b4015e7e43e94fae9de021d`

Eight frames extracted from the encoded MP4 were inspected at 00:03, 00:10, 00:17, 00:25, 00:34, 00:42, 00:49, and 00:55. The sequence covers the contradiction cold-open, proof packet, real app, guard override, exact source, human gate, evals, and outro. The opening audio and burned-in caption state how Codex built the workflow; the next product scene explains GPT-5.6's claim and citation role. `npm run lint` passes for this isolated project.
