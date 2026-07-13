# Halba feed contract

`data/sample-feed.json` is the runnable public example. `scripts/feed-validation.mjs` is the executable contract.

## Top level

Required fields:

- `generatedAt`: parseable local-feed date.
- `source`: human-readable source label.
- `projects`: at least one project.
- `posts`: at least one evidence post.
- `focus`: review-focus array; empty is allowed.
- `qa`: import-quality array; empty is allowed.

## Projects

Each project requires:

- unique `id`;
- `name`;
- controlled `lane` and `health` values;
- current `claim`;
- `lastProofDate`;
- positive `proofWindowDays`;
- at least one source path through `statusFile` or `review.sourcePath`;
- at least one evidence post.

## Posts and evidence

Each post requires a unique `id`, valid project id, title, author, timestamp, body, at least one evidence record, and a replies array.

Each evidence record requires:

- `kind`: `handoff`, `metric`, `review`, or `status`;
- `label`;
- safe relative `path`;
- `status`: `AMBER`, `GRAY`, `GREEN`, `IMPORTED`, or `VERIFIED`.

## Review focus and import QA

Review-focus records require a project id, `contradiction` or `stop` kind, text, and safe source path.

QA records require a project id, `amber` or `red` severity, kind, and text. A source path is optional but must be safe when present. Red QA issues fail feed validation.

## Source paths

Source paths are relative to the configured source root. Validation rejects:

- absolute POSIX paths;
- Windows absolute paths;
- URI-like paths;
- any `..` traversal segment.

The runtime applies the same containment boundary before reading a source.
