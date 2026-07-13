# Halba Build Week video

This isolated Remotion project renders the captioned 78-second product film from the accepted public screenshots and local narration. It is not part of Halba's dependency-free runtime.

## Commands

```bash
npm install
npm run lint
npm run still
npm run render
```

The render uses `../../artifacts` as its public asset directory and writes `artifacts/demo/halba-demo.mp4`. Captions are typed JSON under `src/captions.json`; narration copy is in `narration.txt`.

## Accepted render

- Duration: 78.00 seconds
- Video: H.264, 1280 × 720, 30 fps
- Audio: AAC, 48 kHz stereo; measured at −17.17 LUFS integrated and −1.61 dB true peak
- SHA-256: `e7ddba950409e4beef4b347f2e7458484677562afb690fd0eda50c7130be788c`

Five frames extracted from the encoded MP4 were inspected at 00:02, 00:18, 00:36, 00:56, and 01:13. `npm run lint` and `npm audit --omit=dev` pass for this isolated project.
