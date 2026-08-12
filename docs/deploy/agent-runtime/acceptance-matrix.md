# Provider acceptance matrix — how to actually run it

Plan §11.2 says a target is supported only once it *proves* nine things. This is
the script that proves them, and the rule for what "supported" means.

> A target is **documented** when its configuration exists.
> A target is **supported** when this matrix has passed against a disposable
> project and the run is repeatable in CI.
>
> Today: Docker/VPS is **supported**. Cloud Run, Container Apps, and App Runner
> are **coming soon** — configured, documented, and running the identical image,
> but not yet proven against a disposable project. Do not advertise them.

## The nine checks

| # | Check (§11.2) | How it is proven |
| --- | --- | --- |
| 1 | Provision/deploy from a clean project | `deploy` step exits 0 against a fresh project id |
| 2 | Secrets injected, never in logs or artifacts | grep deploy logs + image layers for the key |
| 3 | `/health` and `/readiness` succeed | `curl` both; readiness must be 200 only with a model key |
| 4 | Streaming works | POST `/chat`, assert >1 SSE frame arrives before the end |
| 5 | A tool invocation works — or is visibly refused | assert `tools.refused[]` explains it |
| 6 | Widget connects from an allowed domain | fetch `/agent` with allowed and blocked `Origin` |
| 7 | Deployment status is reported remotely | `/health` returns the deployed `releaseId` |
| 8 | Redeploy works | deploy again, assert the same URL still answers |
| 9 | Rollback works | deploy the previous release's bundle, assert `releaseId` changed back |

Plus: storage requirements explicit — the agent runtime is stateless, so the
only assertion is that no local vector storage is configured.

## Run it

`scripts/acceptance-matrix.sh` takes a base URL and an expected release id and
runs checks 3–9 against any already-deployed agent. Checks 1–2 are
provider-specific and live in each section below.

```bash
# against a locally running bundle
scripts/acceptance-matrix.sh http://localhost:8080 <releaseId>

# against a deployed one
scripts/acceptance-matrix.sh https://my-agent-xyz.run.app <releaseId>
```

The script is target-agnostic on purpose: the whole point of §11.1 is that the
same image runs everywhere, so the same assertions must pass everywhere. A
target that needs its own bespoke test has broken the "build once" rule.

## Cloud Run

```bash
PROJECT=$(gcloud config get-value project)
REGION=us-central1
SERVICE=larkup-agent-acceptance

# 1. clean project deploy
gcloud run deploy "$SERVICE" \
  --source . --region "$REGION" --port 8080 \
  --allow-unauthenticated \
  --set-env-vars LARKUP_EXEC_TARGET=cloud-run \
  --set-secrets OPENAI_API_KEY=larkup-openai:latest

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')

# 2. the secret must not appear in build or runtime logs
gcloud builds log "$(gcloud builds list --limit 1 --format='value(id)')" \
  | grep -q "sk-" && echo "FAIL: secret in build log" && exit 1

# 3–9
scripts/acceptance-matrix.sh "$URL" "$RELEASE_ID"

gcloud run services delete "$SERVICE" --region "$REGION" --quiet
```

**Known caveats to record in the run:** scale-to-zero drops channel session
history and per-process rate-limit buckets; `LARKUP_EXEC_TARGET=cloud-run` caps
tool trust at `standard`, so check 5 will legitimately be "visibly refused" for
the video/audio tool rather than "works".

## Azure Container Apps

```bash
RG=larkup-acceptance
az group create -n "$RG" -l eastus
az containerapp env create -n larkup-env -g "$RG" -l eastus

az containerapp create -n larkup-agent -g "$RG" --environment larkup-env \
  --image "$REGISTRY/larkup-agent:$RELEASE_ID" \
  --target-port 8080 --ingress external \
  --env-vars LARKUP_EXEC_TARGET=docker \
  --secrets openai-key="$OPENAI_API_KEY" \
  --env-vars OPENAI_API_KEY=secretref:openai-key

URL=https://$(az containerapp show -n larkup-agent -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
scripts/acceptance-matrix.sh "$URL" "$RELEASE_ID"

az group delete -n "$RG" --yes --no-wait
```

Container Apps keeps a writable filesystem and can fork, so `docker` is the
right `LARKUP_EXEC_TARGET` — do not copy the `cloud-run` value here or tools
will be refused unnecessarily.

## AWS App Runner

```bash
aws apprunner create-service \
  --service-name larkup-agent-acceptance \
  --source-configuration "ImageRepository={ImageIdentifier=$REGISTRY/larkup-agent:$RELEASE_ID,ImageConfiguration={Port=8080,RuntimeEnvironmentSecrets={OPENAI_API_KEY=$SECRET_ARN}},ImageRepositoryType=ECR}" \
  --health-check-configuration "Protocol=HTTP,Path=/readiness,Interval=10,Timeout=5,HealthyThreshold=1,UnhealthyThreshold=5"

URL=https://$(aws apprunner describe-service --service-arn "$ARN" --query 'Service.ServiceUrl' --output text)
scripts/acceptance-matrix.sh "$URL" "$RELEASE_ID"

aws apprunner delete-service --service-arn "$ARN"
```

App Runner health-checks `/readiness`, which is correct — it will not route
traffic to a container that has no model credential.

## Wiring it into CI

Do not run this on every PR: it costs money and needs cloud credentials. Run it
on a schedule and before a release, with OIDC rather than long-lived keys.

```yaml
# .github/workflows/acceptance-matrix.yml
on:
  schedule: [{ cron: '0 3 * * 1' }]   # Monday 03:00
  workflow_dispatch:

jobs:
  cloud-run:
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v7
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
      - run: scripts/acceptance-cloud-run.sh
```

A failing scheduled run demotes the target from **supported** back to
**documented** in `plan.md`. That is the whole mechanism: the table is not a
claim, it is a test result.
