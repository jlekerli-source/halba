# Privacy and public-release boundary

Halba is local-first. The public release contains a synthetic proof bundle, public sample feed, application code, tests, evals, documentation, and rendered screenshots of that synthetic data.

## Public allowlist

[`docs/public-package-manifest.md`](public-package-manifest.md) is the sole release allowlist. `npm run release:check` reconstructs a clean tree from that list, verifies excluded paths are absent, reruns checks and evals inside the clean tree, and produces a hashed archive.

`npm run audit:public` scans allowlisted text for:

- personal absolute paths;
- known private-source markers;
- common secret shapes;
- forbidden local data and adapter paths.

Binary screenshots are generated only from the synthetic demo. They are inspected before inclusion.

## Public history gate

The release archive contains no `.git` directory. Before an external remote is created, Halba audits every object reachable from the exact branches and tags intended for publication. Publication must use an explicit branch push; local backup, reflog, and tool-owned refs must never be mirrored to a public remote.

## OpenAI boundary

Live Proof Mode sends only the active bounded bundle to the Responses API. Requests are server-side and set `store: false`. Operators should still remove personal or confidential information before selecting live inference. Recorded mode makes no OpenAI request.

## Non-goals

The release does not ship local operator feeds, raw agent transcripts, import history, source repositories, environment files, credentials, or Git object data from the private working tree.
