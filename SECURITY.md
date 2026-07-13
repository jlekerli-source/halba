# Security policy

## Supported version

Security fixes apply to the current `main` branch until tagged releases exist.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose local files, credentials, imported evidence, or source paths. Use the repository owner's private security-reporting channel when one is published.

Include:

- affected version or commit;
- reproduction steps using public-safe sample data;
- expected and actual behavior;
- impact and any known workaround.

Never include real credentials or private evidence in a report.

## Security boundary

Halba is local-first, but local does not mean trusted by default:

- source paths are untrusted and must remain inside the configured source root;
- imported content and model output are untrusted data;
- model citations must pass deterministic path and line validation;
- OpenAI credentials stay server-side and are never returned by an API;
- public packages are generated from an allowlist, not from the entire working tree.
