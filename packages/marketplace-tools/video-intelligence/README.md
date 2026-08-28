# Larkup Video Intelligence

An installable Marketplace v3 tool with a cloud-first Larkup Cloud connection. On first use, the app creates an opaque, device-scoped key automatically; the AWS GPU endpoint and the key stay out of the settings UI. PyAV/FFmpeg, faster-whisper, RapidOCR/PaddleOCR, YOLOX, ONNX Runtime, and anonymous tracking are isolated in runtime images.

## Where things live

```
runtime/app/
  main.py          FastAPI app + CORS + exception handlers, mounts the v1 router
  config.py        Settings -- the one place env vars are read
  api/
    v1.py          every /v1 route (health, uploads, jobs, usage, access codes)
    deps.py        auth/rate-limit dependencies, and the settings/store/jobs singletons
  services/
    pipeline.py    orchestrates one job: probe -> transcribe -> decode/detect/OCR -> caption -> embed
    transcription.py  TranscriptionService: WhisperProvider (local) / DeepgramProvider (hosted)
    vision.py      SemanticVisionService: per-clip captioning via the Vercel AI Gateway
    embedding.py   VideoEmbeddingService: cross-modal clip search via DashScope (Qwen3-VL-Embedding)
    scene.py       SceneDetector: scene-cut + fixed-window clip planning
    motion.py      MotionSampler: adaptive frame selection within a clip
    storage.py     pluggable frame-upload interface (S3 today; not hardcoded to it)
    jobs.py        JobService: runs a queued job in a background thread (local-Docker path only)
  db/
    store.py       SQLite-backed principals/keys/uploads/jobs
    schemas.py     pydantic request/response models
  utils/
    timing.py      range clamping/merging, sampling cadence, timestamp rebasing
  worker.py        local-Docker CLI entrypoint (`python -m app.worker <job_id>`)
```

`deploy/` is the operator/infrastructure side for Larkup's managed cloud offering: the AWS control plane (Lambda + API Gateway + DynamoDB + S3) and GPU provider dispatch/worker entrypoints (RunPod, Modal, and other vendors behind one interface). It is gitignored and not part of this public checkout -- kept fully separate from `runtime/app` so a self-hosted Docker/local install never depends on it. If you operate the managed cloud stack, see `deploy/README.md` in your private checkout for testing, validation, and deploy commands.

## Local run

Requirements: Docker Desktop or Docker Engine with Compose v2. NVIDIA acceleration additionally requires the NVIDIA Container Toolkit.

```bash
pnpm --filter @larkup/tool-video-intelligence runtime:start
# NVIDIA GPU (CUDA + PaddleOCR):
pnpm --filter @larkup/tool-video-intelligence runtime:start -- --gpu
curl http://127.0.0.1:8787/v1/health
```

Published-package users run the same lifecycle command:

```bash
npx @larkup/tool-video-intelligence start
```

The local default builds the cross-platform CPU target with RapidOCR, binds only port `8787`, does not require an account, and keeps sources/state in Docker volumes. The GPU override uses the CUDA target with PaddleOCR. Set `LARKUP_VIDEO_REQUIRE_AUTH=true` and `LARKUP_VIDEO_ADMIN_TOKEN` when exposing a self-hosted endpoint. Do not expose the unauthenticated local configuration to a public network.

### Runtime configuration

The package-level [`.env.example`](./.env.example) is the single configuration
surface for local Docker plus optional cloud GPU providers. It is passed into
Compose as the container environment, so a value changed there takes effect on
the next runtime restart. Never commit the generated `.env`.

```bash
# Create packages/marketplace-tools/video-intelligence/.env once.
pnpm --filter @larkup/tool-video-intelligence exec larkup-video-intelligence config init

# Update a credential, request rate, or GPU selection.
pnpm --filter @larkup/tool-video-intelligence exec larkup-video-intelligence config set AI_GATEWAY_API_KEY ...
pnpm --filter @larkup/tool-video-intelligence exec larkup-video-intelligence config set LARKUP_VIDEO_REQUESTS_PER_MINUTE 240
pnpm --filter @larkup/tool-video-intelligence exec larkup-video-intelligence config set LARKUP_VIDEO_ACCELERATOR gpu
pnpm --filter @larkup/tool-video-intelligence runtime:start
```

`config get KEY` reads a configured value and `config path` prints the exact
file location. The CLI only accepts documented keys from `.env.example`, which
prevents a misspelled credential or GPU variable from silently doing nothing.

### Runtime choices in Larkup

The installed-tool settings card is driven by this tool's manifest and offers
three compatible runtimes:

- **Larkup Cloud** is the default. It provisions a device-scoped user ID and
  API key automatically; monthly usage is shown only for this metered mode.
- **Local Docker runtime** starts the optional ~8 GB image on first use. The
  card generates a shared API key, enables runtime authentication, and lets
  you replace `127.0.0.1` with a private LAN URL for trusted users.
- **Custom runtime** accepts a compatible `/v1` endpoint and bearer key. Use
  the built-in Verify action before indexing through a self-hosted provider.

Audio-provider configuration applies only to Larkup Cloud. Local and custom
runtimes own their speech pipeline configuration, so the card does not show
or bill a separate cloud audio provider for those modes.

For a Docker-free portable runtime, use the `uv` package in `runtime/`:

```bash
cd runtime
uv sync --extra cpu --extra test
uv run larkup-video-runtime
```

## Indexing contract

1. Upload to `POST /v1/uploads`.
2. Submit `POST /v1/jobs` with a typed indexing brief.
3. Poll `GET /v1/jobs/{id}`.
4. Index the returned timestamped transcript, OCR, object tracks, and answering guide.

`full-coverage` decodes and analyzes every frame as a stream with constant frame-memory usage. It requires the user's explicit processing-authority confirmation and a cloud entitlement that allows the expensive mode. Balanced mode samples every two seconds; fast and deep use five-second and 750-ms cadences.

For managed cloud jobs, the Data-library asset is the canonical copy. A short-lived, KMS-encrypted processing copy is created only so the GPU worker can decode it; it is deleted when the job settles, including failed and cancelled jobs. Once the app has downloaded the evidence, it acknowledges the result and the cloud result object is deleted too. S3 lifecycle rules remove any abandoned processing source or result within one day as a safety bound.

For a complex chat question, the agent first searches active timestamped evidence. If it is incomplete, it may request one authorized, bounded cloud re-analysis (maximum 30 seconds per request) to add fresh OCR, visual detections, or anonymous tracks, then searches the resulting evidence again. This avoids treating RAG snippets as the final answer. The worker seeks directly to the approved range for model inference; source transfer and scale-to-zero GPU startup can still add latency for large videos.

### Answer memory and corrections

Chat keeps a durable answer memory for exact repeated video questions. A result
is saved only after the active source evidence supports it, and is scoped to
that video's active knowledge revision. Reindexing or a bounded inspection
creates a new revision, so an older cached answer is never reused against new
evidence.

Unsupported answers are not cached. If the same unanswered question is asked
again, the app records the repeat and may perform a bounded reinspection of
the best candidate range instead of returning the earlier "unknown" result.

When a user explicitly corrects a video answer in chat, the assistant saves
that correction as an opt-in, user-confirmed answer for exact repeats. It is
kept separate from source evidence: it can make the next identical question
fast, but it never rewrites the indexed transcript, OCR, or visual evidence
and does not manufacture a citation.

## Managed-cloud entitlement

The runtime does not know about Stripe or another payment provider. API keys carry a provider-neutral entitlement:

```json
{
  "plan": "access-code",
  "sourceMinutesPerMonth": 600,
  "maxConcurrentJobs": 2,
  "allowFullCoverage": true
}
```

Monthly source-minute reservations and concurrency updates are atomic. A future subscription webhook only needs to create/update this entitlement; video processing does not change.

The dashboard warns at 80% usage and can send a temporary capacity request through Resend. Configure these server-only environment variables in `apps/web` to enable delivery:

```bash
RESEND_API_KEY=...
LARKUP_USAGE_REQUEST_FROM='Larkup <usage@example.com>'
LARKUP_USAGE_REQUEST_TO='support@example.com'
```

When a user selects OpenAI, Groq, Deepgram, or ElevenLabs for audio, the local app sends the source directly to that selected provider and uses its timestamped transcript. The provider key is never sent to the AWS control plane or RunPod worker; the managed GPU skips duplicate speech decoding and continues with visual analysis.

For a controlled pilot, set `AutoProvisioningEnabled=true` and choose a small `AutoProvisionedSourceMinutes` value when deploying the stack. Each local Larkup installation receives a separate key, while DynamoDB stores only its hash, its installation hash, and aggregate usage. The control plane also enforces monthly-minute, concurrency, and per-key request limits.

Access codes remain available for support-issued or upgraded plans:

```bash
curl -X POST "$VIDEO_ENDPOINT/v1/admin/access-codes" \
  -H "Content-Type: application/json" \
  -H "X-Larkup-Admin-Token: $VIDEO_ADMIN_TOKEN" \
  -d '{"label":"pilot","sourceMinutesPerMonth":600,"maxConcurrentJobs":2,"allowFullCoverage":true,"maxUses":1}'
```

Only hashes of access codes, API keys, and installation identifiers are stored. The raw device key is saved only in the local project's configuration so it can authenticate future cloud jobs.

## AWS deployment

The production stack -- API Gateway + Lambda control plane, DynamoDB, S3 + KMS, and GPU dispatch through Modal/RunPod -- is real-deployed and smoke-tested end to end (control plane → GPU worker → S3 → job completion). Its source lives in the private, gitignored `deploy/` directory described above, not in this public checkout. `ProcessingEnabled` defaults to `false` -- a stack accepts no real jobs until explicitly turned on.

See `deploy/README.md` in a private checkout for the build/deploy, bootstrap, and RunPod image publish commands. Do not send a long-lived AWS secret through chat or store it in GitHub; a short AWS SSO session is sufficient for bootstrap, with GitHub assuming a narrow OIDC deployment role afterward.

### Operator-level env vars

These are worker/service configuration, not per-installation user settings (see `tool.manifest.json`'s `configSchema` for the latter):

| Var | Default | Purpose |
| --- | --- | --- |
| `LARKUP_VIDEO_SEMANTIC_VISION_MODEL` | `google/gemini-3-flash` | Bulk per-clip captioning model (Vercel AI Gateway id). |
| `LARKUP_VIDEO_REASONING_VISION_MODEL` | `alibaba/qwen3-vl-235b-a22b-instruct` | `watch_original`'s dense final-verification pass. |
| `LARKUP_VIDEO_GPU_PROVIDER` | `modal` | `modal` or `runpod`; the managed-cloud GPU dispatch registry, private (see `deploy/README.md`). |
| `LARKUP_VIDEO_EMBEDDING_PROVIDER` | `gateway-gemini-embedding-2` | `gateway-gemini-embedding-2` uses the configured AI Gateway key and Gemini's multimodal vector space for image-frame/text retrieval. `disabled`, DashScope `qwen3-vl-embedding`, `runpod-qwen3-vl-embedding`, and `huggingface-qwen3-vl-embedding` remain available. Live bounded answer verification skips embeddings entirely because vectors are not needed to return timestamped answer evidence. |
| `DASHSCOPE_API_KEY` | unset | Required when `LARKUP_VIDEO_EMBEDDING_PROVIDER=qwen3-vl-embedding`. |
| `DASHSCOPE_WORKSPACE_ID` | unset | From the Model Studio console's Workspace Details page. Required when `LARKUP_VIDEO_EMBEDDING_PROVIDER=qwen3-vl-embedding`. |
| `DASHSCOPE_REGION` | unset | The workspace's region, e.g. `eu-central-1` (same console page). Required when `LARKUP_VIDEO_EMBEDDING_PROVIDER=qwen3-vl-embedding`. |
| `LARKUP_VIDEO_RUNPOD_EMBEDDING_ENDPOINT_ID` | unset | Required when `LARKUP_VIDEO_EMBEDDING_PROVIDER=runpod-qwen3-vl-embedding` (also needs `RUNPOD_API_KEY`). |
| `LARKUP_VIDEO_HF_EMBEDDING_URL` | unset | Required when `LARKUP_VIDEO_EMBEDDING_PROVIDER=huggingface-qwen3-vl-embedding` (also needs `HF_TOKEN`). |
| `LARKUP_MEDIA_STORAGE` | `local` | Web app env var: `s3` switches `createStorageProvider()` to `S3StorageProvider` for canonical media (see `LARKUP_MEDIA_S3_BUCKET` etc.). |
| `WEBHOOK_SIGNING_SECRET` | unset | Signs outbound job-completion webhooks (`X-Larkup-Signature`). |
| `STALE_JOB_TIMEOUT_HOURS` | `6` | Force-fails a queued/running job older than this on the scheduled reconcile sweep. |

## Verification

```bash
pnpm --filter @larkup/tool-video-intelligence type-check
pnpm --filter @larkup/tool-video-intelligence test
pnpm --filter @larkup/marketplace test   # S3StorageProvider, tool-loader, etc.
PYTHONPATH=runtime python3 -m unittest discover -s runtime/tests -p 'test_*.py'
docker build --target smoke -t larkup-video-smoke runtime
docker build --target cpu -t larkup-video-cpu runtime
```

The AWS control plane and GPU provider tests/validation run privately -- see `deploy/README.md`.

The new runtime is now the default path for uploaded videos and has passed real-video acceptance. The old `@larkup/tool-video-audio` package remains only while audio uploads, URL import, frame extraction, bounded inspection, CLI consumers, and existing assets are migrated; deleting it before those consumers move would remove working non-video features. Removing this package, its v3 catalog record, and the optional installed-tool entry cleanly removes the new implementation.
