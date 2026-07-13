# Deployment and demo readiness

Halba has no runtime dependencies and can be demonstrated locally or from any host that can run Node.js 20+.

## Local demo

```bash
npm run release:check
cd dist/halba-public
npm start
```

Open [http://localhost:4177](http://localhost:4177). The default demo uses synthetic public-safe evidence and a clearly labeled recorded model response.

## Container

```bash
docker build -t halba:0.2.0 .
docker run --rm -p 4177:4177 halba:0.2.0
curl --fail http://localhost:4177/api/proof/bundle
```

The health check uses the proof-bundle endpoint. Set `PORT` if the hosting platform injects a different port.

## Optional live GPT path

Pass `OPENAI_API_KEY` only through the host's encrypted environment configuration. Never bake it into the image or expose it to the browser.

```bash
docker run --rm -p 4177:4177 \
  -e OPENAI_API_KEY \
  halba:0.2.0
```

The recorded path remains available when a judge does not provide credentials. Live and recorded executions are visually distinct.

## Publication status

The repository prepares and verifies a reproducible public artifact, but its scripts do not create remotes, push code, deploy services, upload videos, or submit forms. Those external actions require an explicit publication decision.
