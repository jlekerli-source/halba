# Submission video hosting

Devpost's standard video field accepts a public YouTube, Vimeo, or Youku URL. The canonical film remains [`../artifacts/demo/halba-demo.mp4`](../artifacts/demo/halba-demo.mp4); upload that exact accepted encode rather than re-exporting it through an editor.

## YouTube metadata

### Title

Halba — Can an AI Agent Prove It Is Done? | OpenAI Build Week

### Description

Halba is a local-first evidence control plane for AI-assisted work.

When an agent says the work is done, Proof Mode turns its report, source files, diffs, and machine receipts into a traceable evidence graph. GPT-5.6 proposes atomic claims and precise citations; deterministic guards inspect the actual bytes; a human makes the final decision.

Try Halba: https://jlekerli-source.github.io/halba/
Source: https://github.com/jlekerli-source/halba
Release evidence: https://github.com/jlekerli-source/halba/releases/tag/v0.3.0-build-week

The public demo uses synthetic evidence and a visibly labeled structured-inference replay so it works without credentials. The optional live Responses API path is included in the Node and Docker builds and fails closed when it is unavailable or invalid.

Built independently for OpenAI Build Week. Inspired by a public problem prompt from Theo Browne; no affiliation or endorsement. Narration is synthesized and the sound bed is original.

### Upload settings

- Visibility: **Public** so Devpost judges can embed and play it without authentication.
- Category: **Science & Technology**.
- Audience: **Not made for kids**.
- Paid promotion: **No**.
- Thumbnail: [`../artifacts/demo/devpost-thumbnail.png`](../artifacts/demo/devpost-thumbnail.png).
- Captions: burned into the accepted encode; do not enable an incorrect auto-caption track over them.
- Altered content: no realistic person, event, or place is impersonated; narration is disclosed above as synthesized.

## Integrity check after upload

1. Play the hosted video in a signed-out or private window.
2. Confirm the duration is approximately 58 seconds and playback reaches the final Halba trace.
3. Confirm the public page exposes an embeddable YouTube or Vimeo URL accepted by Devpost.
4. Add that URL to [`devpost.md`](devpost.md) and [`devpost-checklist.md`](devpost-checklist.md).
5. Keep the GitHub-hosted MP4 as a downloadable evidence mirror, not as the Devpost video-field value.
