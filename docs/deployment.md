# Deployment and demo readiness

Halba has no package dependencies and can be demonstrated locally or from any host that can run Node.js 22.5+. The v1 durable local core uses the built-in `node:sqlite` module.

## Public GitHub Pages demo

[https://jlekerli-source.github.io/halba/](https://jlekerli-source.github.io/halba/) serves the public-safe agent workspace and recorded Proof Mode workflow without a hosted database or secret. The deployment bundle contains the same three channels, three agents, four runs, six bounded sources, labeled structured-inference replay, deterministic verdicts, exact-source data, and browser-local review decisions as the Node demo.

```bash
npm run check
npm run build:pages
```

The checked-in GitHub Actions workflow publishes only `dist/pages`. The build copies the browser modules explicitly, injects a static-demo marker, and generates `static-demo.json` from the validated public bundle; it does not copy the working tree or private local adapters. The optional live button fails closed on Pages and points operators to the Node server path. Trust Inbox remains a durable, loopback-first surface and is not fetched or presented as empty/healthy by the static Pages demo.

The Pages artifact also serves the captioned demo film at `/demo/halba-demo.mp4`, with its poster at `/demo/halba-demo-still.png`.

## Local demo

```bash
npm run release:check
cd dist/halba-public
npm start
```

Open [http://localhost:4177](http://localhost:4177). The default demo uses synthetic public-safe evidence and a clearly labeled recorded model response.

## Container

```bash
npm run release:check
docker build -f dist/halba-public/Dockerfile -t halba:0.3.1 dist/halba-public
docker run --rm -p 4177:4177 halba:0.3.1
curl --fail http://localhost:4177/api/proof/bundle
```

The release check reconstructs the explicit public allowlist before Docker sees the build context. Do not build the public image from the working tree. The health check uses the proof-bundle endpoint. Set `PORT` if the hosting platform injects a different port.

The container path was verified on 2026-07-13 from the reconstructed public tree: the image built from `dist/halba-public`, reached Docker health status `healthy`, served the Proof Mode HTML and six-source bundle, and returned six findings with four review gates from the recorded proof endpoint.

## Optional live GPT path

Pass `OPENAI_API_KEY` only through the host's encrypted environment configuration. Never bake it into the image or expose it to the browser.

```bash
docker run --rm -p 4177:4177 \
  -e OPENAI_API_KEY \
  halba:0.3.1
```

The recorded path remains available when a judge does not provide credentials. Live and recorded executions are visually distinct.

## Publication status

External publication was authorized and completed on 2026-07-13:

- Source: [github.com/jlekerli-source/halba](https://github.com/jlekerli-source/halba)
- Demo: [jlekerli-source.github.io/halba](https://jlekerli-source.github.io/halba/)
- Film: [jlekerli-source.github.io/halba/demo/halba-demo.mp4](https://jlekerli-source.github.io/halba/demo/halba-demo.mp4)
- Deploy proof: [GitHub Actions run 29248505905](https://github.com/jlekerli-source/halba/actions/runs/29248505905)

The live app was exercised through onboarding, replay, exact-source inspection, four human decisions, the zero-open-review state, and reload persistence. The live static packet reports six sources, six findings, and four review gates. The hosted film hashes to the accepted local render. No private refs or local baseline objects were pushed.
