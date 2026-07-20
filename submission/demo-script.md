# 55-second judge demo script

The rendered submission film is [`../artifacts/demo/halba-demo.mp4`](../artifacts/demo/halba-demo.mp4): 72 seconds, 1280 × 720, 30 fps, H.264 video with AAC narration, an original sound bed, and burned-in captions. Its reproducible source is in [`video/`](video/). This script is the matching live route.

## 0:00–0:06 — The problem

Show the Trust Inbox hero.

> “Agents compress hours of work into one confident word: done. Halba treats that as a claim, not a fact.”

## 0:06–0:16 — The ranked queue

Show the 3-workspace, 120-run public-safe benchmark and the first critical item.

> “Deterministic policy found eleven attention items and ranked this contradiction first. Model prose contributes zero authority.”

## 0:16–0:27 — Why this is first

Open **Inspect priority trace** on the top card.

> “The rank comes from declared criticality and inspectable policy reasons. The benchmark is synthetic and the top case has no source, so Halba says so instead of inventing proof.”

## 0:27–0:40 — Exact source-backed proof

Move to the separate public Proof Mode packet. Keep **Example 2 · different claim · source-backed packet** visible while opening the contradictory live-GPT claim and `receipts/model-run.json`.

> “Here the source-backed packet says the run was live. The exact machine receipt says recorded. The deterministic guard overrides the model assessment.”

## 0:40–0:50 — Human boundary

Choose **Request proof** and return to Trust Inbox.

> “The human can approve, reject, resolve, or request evidence. The decision is scoped to this exact evidence identity and never rewrites the source.”

## 0:50–0:55 — Close

Show the Trust Circuit.

> “Language proposes. Evidence decides. The human remains accountable.”

## Capture rules

- Use the locally seeded durable runtime for Trust Inbox and label the benchmark synthetic.
- Use the credential-free recorded packet for exact-source proof and keep its **Recorded** disclosure visible.
- Do not imply GitHub Pages hosts Trust Inbox, that the film proves a live GPT request, or that human comprehension has passed.
- Keep the cursor still over exact source evidence and end on the complete claim → evidence → guard → human circuit.
