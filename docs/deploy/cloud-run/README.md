# Deploying the Knowledge Server to Google Cloud Run

This runbook deploys a Larkup Knowledge Server to Google Cloud Run. Cloud Run is the **MVP cloud target** for TASK 01.

## Prerequisites

- Google Cloud project with billing enabled
- `gcloud` CLI authenticated (`gcloud auth login`)
- Docker installed locally
- Artifact Registry API enabled in your project
- Cloud Run API enabled
- Secret Manager API enabled

## 1. Create required secrets in Secret Manager

```bash
# Never put secrets in environment variables or config files directly
gcloud secrets create embedding-api-key --data-file=<(echo -n "$EMBEDDING_API_KEY")
gcloud secrets create chat-api-key --data-file=<(echo -n "$CHAT_API_KEY")

# SERVER_API_KEYS format: scope:key,scope:key,...
# Example: retrieval:rk_abc123,ingest:ik_def456,admin:ak_ghi789
gcloud secrets create server-api-keys --data-file=<(echo -n "$SERVER_API_KEYS")
```

## 2. Create Artifact Registry repository

```bash
gcloud artifacts repositories create larkup \
  --repository-format=docker \
  --location=us-central1 \
  --description="Larkup Knowledge Server images"

# Authenticate Docker with Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev
```

## 3. Download the Knowledge Server bundle

From the Larkup dashboard → **Knowledge Server** → **Deploy to cloud** → **Download bundle**.

Or via CLI:
```bash
larkup server download --output ./my-knowledge-server
cd my-knowledge-server
```

## 4. Deploy using Cloud Build

```bash
export PROJECT_ID=$(gcloud config get-value project)
export SERVICE_NAME=larkup-knowledge-server
export REGION=us-central1

gcloud builds submit . \
  --config docs/deploy/cloud-run/cloudbuild.yaml \
  --substitutions="_SERVICE_NAME=$SERVICE_NAME,_REGION=$REGION"
```

Or build and deploy manually:

```bash
# Build image
export IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/larkup/$SERVICE_NAME:latest"
docker build -t "$IMAGE" .
docker push "$IMAGE"

# Deploy to Cloud Run
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --update-secrets="EMBEDDING_API_KEY=embedding-api-key:latest,SERVER_API_KEYS=server-api-keys:latest,CHAT_API_KEY=chat-api-key:latest"
```

## 5. Verify the deployment

```bash
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" --format='value(status.url)')

# Health check
curl "$SERVICE_URL/health"
# Expected: {"ok":true,"service":"...","type":"knowledge-server"}

# Readiness check (checks vector store connection)
curl "$SERVICE_URL/readiness"
# Expected: {"ready":true,"vectorStore":"connected","documents":N}
```

## 6. Configure persistent storage

Cloud Run containers are stateless — local LanceDB data **does not persist** between requests.

Use one of:

### Option A: LanceDB Cloud (recommended)
```bash
gcloud secrets create lancedb-uri --data-file=<(echo -n "$LANCEDB_URI")
gcloud secrets create lancedb-api-key --data-file=<(echo -n "$LANCEDB_API_KEY")

gcloud run services update "$SERVICE_NAME" \
  --region="$REGION" \
  --update-env-vars="LANCEDB_MODE=cloud" \
  --update-secrets="LANCEDB_URI=lancedb-uri:latest,LANCEDB_API_KEY=lancedb-api-key:latest"
```

### Option B: S3-compatible storage (Cloudflare R2, AWS S3)
```bash
gcloud run services update "$SERVICE_NAME" \
  --region="$REGION" \
  --update-env-vars="LANCEDB_MODE=s3,LANCEDB_S3_URI=s3://your-bucket/larkup" \
  --update-secrets="AWS_ACCESS_KEY_ID=aws-key-id:latest,AWS_SECRET_ACCESS_KEY=aws-secret:latest"
```

## 7. Update from the dashboard

When you redeploy via the Larkup dashboard, it pushes a new image and triggers a Cloud Run revision automatically. No manual steps needed after initial setup.

## Rollback

```bash
# List revisions
gcloud run revisions list --service="$SERVICE_NAME" --region="$REGION"

# Roll back to a specific revision
gcloud run services update-traffic "$SERVICE_NAME" \
  --region="$REGION" \
  --to-revisions=REVISION_NAME=100
```

## Cost estimate

With `--min-instances=0` (scale to zero):
- A server with 10 req/day: effectively **$0/month** (free tier covers it)
- A server with 10k req/day: ~$2–5/month (512 MiB, 1 CPU)
