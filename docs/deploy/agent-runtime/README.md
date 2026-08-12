# Deploying an Agent Runtime

Runbook for the second deployable artifact in Larkup. The first is the
[Knowledge Server](../docker-vps/README.md); this one is the Agent.

They have separate lifecycles on purpose (plan §1.1). An Agent may read from one
or more Knowledge Servers, but it never shares their deployment, their storage,
or their credentials.

## The artifact

A bundle is a portable container carrying one **immutable Agent Release**. The
same image runs on every supported target — build once, target many (§11.1).
There is no Cloud Run generator and no VPS generator.

```
release.json          the release snapshot: prompt, model, tools, origins
server.mjs            the runtime — no Larkup packages needed at run time
Dockerfile            the portable image
docker-compose.yml    Docker / VPS
service.cloudrun.yaml Cloud Run
widget.js             the embeddable chat widget, served at /widget.js
.env.example          every secret the deployment must supply
```

**No credential is inside the image.** Retrieval keys, join codes, and channel
tokens are stripped at generation time and injected as environment variables by
your deployment provider. An image pushed to a registry carries behaviour only.

## Getting a bundle

**Dashboard:** Settings → Agents → **Deploy** → *Download bundle*.

**API:**

```bash
curl "http://localhost:4567/api/agents/<agentId>/bundle" > bundle.json
# a specific release (this is how rollback works):
curl "http://localhost:4567/api/agents/<agentId>/bundle?releaseId=<releaseId>"
```

You must publish a release first. A deployment always carries a specific,
immutable release — there is no "deploy the current draft".

## Target 1 — Docker / VPS

```bash
unzip my-agent-v1.0.0.zip && cd my-agent
cp .env.example .env          # add your model key
docker compose up --build -d

curl localhost:8080/health      # liveness
curl localhost:8080/readiness   # can it actually answer?
```

Put a reverse proxy in front for TLS. The agent listens on `8080` and expects
`X-Forwarded-Proto` to be set if you terminate TLS upstream.

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  # Streaming: without this, answers arrive all at once at the end.
  proxy_buffering off;
  proxy_read_timeout 300s;
}
```

## Target 2 — Cloud Run

```bash
gcloud run deploy my-agent \
  --source . \
  --region us-central1 \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars LARKUP_EXEC_TARGET=cloud-run \
  --set-secrets OPENAI_API_KEY=larkup-openai:latest
```

`--allow-unauthenticated` is correct here: the agent is a public endpoint
protected by its own origin allow-list and auth mode, not by IAM.

Two things to know:

- **Scale to zero is safe**, because the runtime is stateless — knowledge lives
  in the Knowledge Server. Channel session transcripts are held in memory, so a
  conversation started before a scale-down loses its history.
- **`LARKUP_EXEC_TARGET=cloud-run` caps tool trust at `standard`.** A tool that
  spawns a subprocess (video/audio) will be refused, visibly, and reported by
  `/api/agents/:id/health`. Use a Docker or worker target for those.

## Secrets

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / … | The model credential matching the release's provider. |
| `KS_KEY_<LABEL>` | Retrieval-scoped key for each Knowledge Server. |
| `AGENT_JOIN_CODE` | Required when the release uses `authMode: "join-code"`. |
| `CHANNEL_<ID>_<KEY>` | Channel credentials, e.g. `CHANNEL_TELEGRAM_BOTTOKEN`. |
| `PORT` | Set automatically by Cloud Run and App Runner. |
| `LARKUP_EXEC_TARGET` | Execution profile. Caps tool trust level. |

Never bake a secret into the image or commit `.env`. Use your provider's secret
manager: Secret Manager on GCP, Key Vault on Azure, Secrets Manager on AWS,
Docker secrets or an `.env` file with `600` permissions on a VPS.

## Health and readiness

| Endpoint | Meaning | Wire it to |
| --- | --- | --- |
| `/health` | The process is up. | Container liveness probe. |
| `/readiness` | It has a release *and* a model credential. | Load balancer, startup probe. |

`/readiness` returns `503` until a model credential is present. That is the
check that stops traffic reaching a container which would only return errors.

## Provider acceptance matrix (§11.2)

Verify these before calling a target supported:

- [ ] Provision and deploy from a clean project
- [ ] Secrets injected without appearing in logs or build artifacts
- [ ] `/health` and `/readiness` both succeed
- [ ] `POST /chat` streams a response
- [ ] A representative tool invocation works, or is *visibly refused*
- [ ] The widget connects from an allowed domain and is rejected from another
- [ ] Deployment status is observable remotely
- [ ] Redeploy works
- [ ] Rollback works (deploy the previous release's bundle)
- [ ] Storage requirements are explicit — no accidental ephemeral state

The Docker/VPS path is verified. Cloud Run is documented and follows the same
image; run the matrix against your own project before relying on it.

## Rollback

Releases are immutable, so rollback is not an undo — it is deploying an earlier
image.

```bash
curl "http://localhost:4567/api/agents/<agentId>/bundle?releaseId=<previousReleaseId>"
# deploy that bundle exactly as above
```

In the dashboard, **Releases → Rollback** moves the active pointer, which
changes what the *dashboard's own* endpoint serves. A deployed container keeps
running the release it was built from until you deploy a new one — which is the
point: a running deployment cannot be changed underneath you.

## Observability

The runtime writes one JSON object per line to stdout, with correlation ids
(`agentId`, `releaseId`, `runId`, `sessionId`, `channelId`) and credentials
scrubbed.

```bash
docker compose logs -f agent | jq 'select(.name == "run.completed")'
docker compose logs -f agent | jq 'select(.level == "warn")'
```

Events: `run.started/completed/failed`, `retrieval.completed`,
`tool.invoked/completed/failed/refused`, `channel.received/delivered/delivery_failed`,
`deployment.*`, and `security.origin_denied/auth_failed`.

Every platform in §11.1 collects stdout, so there is nothing extra to configure
for basic operation. Point an OTLP collector at it for traces and metrics.

## Connecting the widget

The deployed agent serves the widget itself:

```html
<script async src="https://your-agent-deployment/widget.js" data-agent="<agentId>"></script>
```

Add the embedding site to the agent's allowed origins **before** deploying — the
list travels inside the release snapshot, and the deployed container enforces it
with the same matcher the dashboard uses.

## Troubleshooting

**`/readiness` returns 503.** No model credential. Check the provider matches
the release: an agent published with `anthropic` needs `ANTHROPIC_API_KEY`.

**The widget shows "not in allowed origins".** The release was published before
the domain was added. Add it, publish a new release, redeploy.

**A tool is missing.** Check `/api/agents/:id/health` — a refused tool is
reported with the reason. Most often the target caps trust below what the tool
needs.

**Streaming arrives all at once.** A proxy is buffering. Set
`proxy_buffering off` in nginx, or the equivalent for your load balancer.
