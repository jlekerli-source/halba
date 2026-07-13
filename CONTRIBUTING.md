# Contributing to Halba

Halba accepts changes that make evidence ingestion, proof adjudication, exact-source review, or human gates more reliable. It deliberately does not aim to become a general chat, project-management, or realtime-collaboration product.

## Before opening a change

1. Keep fixtures synthetic or unquestionably public-safe.
2. Add deterministic coverage for new proof behavior.
3. Add eval cases when a change affects claim verdicts or citations.
4. Run the release gate:

```bash
npm run release:check
```

For visible changes, also inspect the rendered desktop and mobile application. A clean command result is not evidence that the interface works.

## Data and security

Never commit credentials, private project files, personal absolute paths, or unredacted agent transcripts. Import adapters should be read-only and opt-in. Report security issues using the process in [`SECURITY.md`](SECURITY.md).
