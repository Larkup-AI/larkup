# Larkup Video Intelligence

An installable Marketplace v3 tool with a cloud-first Larkup Cloud connection. On first use, the app creates an opaque, device-scoped key automatically; administrators may also provide a replacement key in Installed Tools. The AWS GPU endpoint and raw key are never shown in the connection status. PyAV/FFmpeg, faster-whisper, RapidOCR/PaddleOCR, YOLOX, ONNX Runtime, and anonymous tracking are isolated in runtime images.

The evidence pipeline is genre-neutral. Planning is driven by the user's goal,
question shape, source duration, and measured visual/audio signals—not a fixed
branch for sports, lectures, entertainment, films, meetings, or any other
content type. Direct visual claims preserve generic `subject`, `relation`, and
`value` bindings so the same corroboration logic works across every genre.

## Where things live

```
runtime/app/
  main.py          FastAPI app + CORS + exception handlers, mounts the v1 router
  config.py        Settings -- the one place env vars are read
  api/
    v1.py          every /v1 route (health, uploads, jobs, usage, access codes)
    deps.py        auth/rate-limit dependencies, and the settings/store/jobs singletons
  services/
    brain.py       bounded agent planner: chooses modalities, density, segments, and extraction focus
    pipeline.py    shared cloud/local executor: scout -> plan -> parallel evidence extraction -> synthesis
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

- **Larkup Cloud** is the default. Paste a Larkup Cloud API key in Installed
  Tools when your organization issues keys manually, or leave it empty when
  automatic project provisioning is enabled. The same card has **Request
  Larkup Cloud API key** for requesting access; monthly usage is shown only
  for this metered mode.
- **Local runtime** detects Docker and uses it when available; otherwise it
  installs and runs the native CPU runtime with `uv`. The card shows the
  chosen engine, host suitability, install state, and explicit Install,
  Start, and Stop controls. It generates a shared API key and lets you replace
  `127.0.0.1` with a private LAN URL for trusted users.
- **Custom runtime** accepts a compatible `/v1` endpoint and bearer key. Use
  the built-in Verify action before indexing through a self-hosted provider.

Every runtime requires an audio provider key plus agent/tool-brain and vision
credentials. The audio model is selected automatically for the provider. The
agent follows the chat provider, model, and key saved under **AI Models**.
Vision follows the saved Vision Model; a vision-capable chat provider is reused
automatically, while text-only providers such as DeepSeek require a separate
Vision Model there. Local mode injects these settings only into the local
process/container. Managed Cloud forwards them only in the active GPU job and
never stores them in DynamoDB or S3. Larkup Cloud supplies compute, not model
credits. The agent/tool-brain model may differ from the vision model.

For a Docker-free portable runtime, use the `uv` package in `runtime/`:

```bash
# Install uv once: https://docs.astral.sh/uv/
npx @larkup/tool-video-intelligence native
```

The Installed Tools card exposes this automatically selected native path as
part of **Local runtime**. It creates `./.larkup/video-intelligence/` for
state and downloaded models, binds to
`127.0.0.1` by default, and uses the same `/v1` API and SQLite-backed worker
queue as Docker. To use a LAN URL, set the card's local URL to an address on
the host and keep the generated key private. Configure optional AI/provider
credentials with `larkup-video-intelligence config set …` before starting.

## Indexing contract

1. Upload to `POST /v1/uploads`.
2. Submit `POST /v1/jobs` with a typed indexing brief.
3. Poll `GET /v1/jobs/{id}`.
4. Index the returned timestamped transcript, OCR, object tracks, and answering guide.

The only indexing modes are `fast`, `balanced`, and `thorough`. They are bounded
latency/recall budgets, not fixed pipelines. A first planning call chooses useful
modalities, a model-free scout collects sparse chronological motion and optional
OCR signals while transcription runs in parallel, and a second planning call
chooses the final whole-source cadence plus denser source-supported priority
ranges. Every proposed number is clamped by the executor. The same Python
implementation runs locally and in managed cloud.

Progress reports measured frame/clip counters, never moves backwards, and adds a
remaining-time estimate calculated from the actual plan. Results include the
plan, model-call diagnostics, elapsed time, estimate error, and timestamped
evidence so a caller can audit both speed and extraction quality.

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
  "maxConcurrentJobs": 2
}
```

Monthly source-minute reservations and concurrency updates are atomic. A future subscription webhook only needs to create/update this entitlement; video processing does not change.

The dashboard warns at 80% usage and can send a temporary capacity request through Resend. Configure these server-only environment variables in `apps/web` to enable delivery:

```bash
RESEND_API_KEY=...
LARKUP_USAGE_REQUEST_FROM='Larkup <usage@example.com>'
LARKUP_USAGE_REQUEST_TO='support@example.com'
```

For managed jobs, the audio, brain, and vision credentials travel through the authenticated control plane only as a transient worker payload. They are not included in the persisted job item or result, and the worker restores a clean environment after completion. Provider failures do not fall back to a Larkup-funded model.

For a controlled pilot, set `AutoProvisioningEnabled=true`. The first `TrialDeviceLimit` new device IDs (100 by default) receive `TrialSourceMinutes` (600 minutes, or 10 hours, by default) each month; later devices receive `PostTrialSourceMinutes` (0 by default) and can use the dashboard's support request instead. This is an allowance and rate-limit system only—there is no customer-facing price or payment flow.

The support team can update a device's allowance, concurrency, or per-minute request limit without seeing its API key:

```bash
curl -X POST "$VIDEO_ENDPOINT/v1/admin/devices/$USER_ID/entitlement" \
  -H "Content-Type: application/json" \
  -H "X-Larkup-Admin-Token: $VIDEO_ADMIN_TOKEN" \
  -d '{"sourceMinutesPerMonth":60,"maxConcurrentJobs":1,"requestsPerMinute":60,"plan":"support-grant"}'
```

For the common “add credits” workflow, use the support script. It calls the
authenticated control plane, which updates the DynamoDB device entitlement and
reconciles the current billing-period allowance atomically; it does not write
to a Neon database. The minutes value is the new total monthly allowance, not
an increment.

```bash
export LARKUP_VIDEO_INTELLIGENCE_CLOUD_ENDPOINT='https://video.example.com'
export LARKUP_VIDEO_ADMIN_TOKEN='...'
bash scripts/grant-cloud-credits.sh <user-id> 120 support-grant
```

`$USER_ID` is the generated ID shown in Installed Tools and included in the Resend support request. Each local Larkup installation receives a separate key, while DynamoDB stores only hashes of keys and installation identifiers plus aggregate usage.

Access codes remain available for support-issued or upgraded plans:

```bash
curl -X POST "$VIDEO_ENDPOINT/v1/admin/access-codes" \
  -H "Content-Type: application/json" \
  -H "X-Larkup-Admin-Token: $VIDEO_ADMIN_TOKEN" \
  -d '{"label":"pilot","sourceMinutesPerMonth":600,"maxConcurrentJobs":2,"maxUses":1}'
```

Only hashes of access codes, API keys, and installation identifiers are stored. The raw device key is saved only in the local project's configuration so it can authenticate future cloud jobs.

## AWS deployment

The production stack -- API Gateway + Lambda control plane, DynamoDB, S3 + KMS, and GPU dispatch through Modal/RunPod -- is real-deployed and smoke-tested end to end (control plane → GPU worker → S3 → job completion). Its source lives in the private, gitignored `deploy/` directory described above, not in this public checkout. `ProcessingEnabled` defaults to `false` -- a stack accepts no real jobs until explicitly turned on.

See `deploy/README.md` in a private checkout for the build/deploy, bootstrap, and RunPod image publish commands. Do not send a long-lived AWS secret through chat or store it in GitHub; a short AWS SSO session is sufficient for bootstrap, with GitHub assuming a narrow OIDC deployment role afterward.

### Operator-level env vars

These are self-hosted worker/service variables. Managed Cloud receives the corresponding user values per job and has no platform-owned model-provider secrets (see `tool.manifest.json`'s `configSchema`):

| Var                                                  | Default                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LARKUP_VIDEO_VISION_PROVIDER`                       | `vercel_ai_gateway`          | `vercel_ai_gateway`, `google`, or `openai`; selected automatically from AI Models.                                                                                                                                                                                                                                                                                                                    |
| `LARKUP_VIDEO_VISION_API_KEY`                        | unset                        | User-owned selected provider key, supplied from AI Models.                                                                                                                                                                                                                                                                                                                                            |
| `LARKUP_VIDEO_SEMANTIC_VISION_MODEL`                 | `google/gemini-3.6-flash`    | Bulk per-clip captioning model. Gemini is called through Google's native API when `LARKUP_VIDEO_VISION_PROVIDER=google`.                                                                                                                                                                                                                                                                              |
| `LARKUP_VIDEO_AGENT_PROVIDER`                        | `vercel_ai_gateway`          | Chat provider from AI Models; supports Gateway, Google, OpenAI, DeepSeek, Mistral, Cohere, and Anthropic independently of vision.                                                                                                                                                                                                                                                                     |
| `LARKUP_VIDEO_AGENT_API_KEY`                         | unset                        | User-owned agent provider credential.                                                                                                                                                                                                                                                                                                                                                                 |
| `LARKUP_VIDEO_AGENT_MODEL`                           | `openai/gpt-5-mini`          | Tool-brain model that chooses modalities, sampling density, priority ranges, and extraction focus.                                                                                                                                                                                                                                                                                                    |
| `LARKUP_VIDEO_GOOGLE_CONCURRENCY`                    | `4`                          | Maximum simultaneous native Gemini vision batches. Kept below Gateway concurrency to avoid direct-project burst limits.                                                                                                                                                                                                                                                                               |
| `LARKUP_VIDEO_GOOGLE_MAX_IMAGES_PER_REQUEST`         | `8`                          | Bounds native Gemini request size so multi-clip structured responses remain within interactive provider timeouts.                                                                                                                                                                                                                                                                                     |
| `LARKUP_VIDEO_GOOGLE_REQUESTS_PER_MINUTE`            | `12`                         | Sliding-window request limit for native Gemini vision calls, leaving quota headroom for the agent model.                                                                                                                                                                                                                                                                                              |
| `LARKUP_VIDEO_REASONING_VISION_MODEL`                | `google/gemini-3.6-flash`    | Dense final-verification model for bounded source inspection.                                                                                                                                                                                                                                                                                                                                         |
| `LARKUP_VIDEO_TRANSCRIPTION_PROVIDER`                | unset                        | User-selected timestamped speech provider: `deepgram`, `openai`, `groq`, or `elevenlabs`.                                                                                                                                                                                                                                                                                                             |
| `LARKUP_VIDEO_TRANSCRIPTION_FALLBACK`                | unset                        | Managed Cloud keeps this empty so it never falls back to Larkup-funded inference.                                                                                                                                                                                                                                                                                                                     |
| `LARKUP_VIDEO_TRANSCRIPTION_CHUNK_SECONDS`           | `180`                        | Audio window used for long hosted transcriptions. Windows keep request sizes bounded and are merged back onto the original source clock.                                                                                                                                                                                                                                                              |
| `LARKUP_VIDEO_TRANSCRIPTION_REQUEST_TIMEOUT_SECONDS` | `60`                         | Maximum wait for one hosted speech request before the configured fallback takes over, preventing a stalled provider from holding the progress UX for minutes.                                                                                                                                                                                                                                         |
| `LARKUP_VIDEO_DEEPGRAM_AUTO_MODEL`                   | `nova-3`                     | User-selected Deepgram model used when the source language is unknown.                                                                                                                                                                                                                                                                                                                                |
| `LARKUP_VIDEO_TRANSCRIPTION_CONCURRENCY`             | `3`                          | Maximum parallel hosted speech windows. The runtime keeps the merged transcript chronological even when requests finish out of order.                                                                                                                                                                                                                                                                 |
| `LARKUP_VIDEO_GPU_PROVIDER`                          | `modal`                      | `modal` or `runpod`; the managed-cloud GPU dispatch registry, private (see `deploy/README.md`).                                                                                                                                                                                                                                                                                                       |
| `LARKUP_VIDEO_EMBEDDING_PROVIDER`                    | `gateway-gemini-embedding-2` | `gateway-gemini-embedding-2` uses the configured AI Gateway key and Gemini's multimodal vector space for image-frame/text retrieval. `disabled`, DashScope `qwen3-vl-embedding`, `runpod-qwen3-vl-embedding`, and `huggingface-qwen3-vl-embedding` remain available. Live bounded answer verification skips embeddings entirely because vectors are not needed to return timestamped answer evidence. |
| `LARKUP_VIDEO_EMBEDDING_FALLBACK_PROVIDER`           | `gateway-gemini-embedding-2` | Provider used automatically when the selected visual embedding service is unavailable. Set `disabled` to require the primary provider only.                                                                                                                                                                                                                                                           |
| `DASHSCOPE_API_KEY`                                  | unset                        | Required when `LARKUP_VIDEO_EMBEDDING_PROVIDER=qwen3-vl-embedding`.                                                                                                                                                                                                                                                                                                                                   |
| `DASHSCOPE_WORKSPACE_ID`                             | unset                        | From the Model Studio console's Workspace Details page. Required when `LARKUP_VIDEO_EMBEDDING_PROVIDER=qwen3-vl-embedding`.                                                                                                                                                                                                                                                                           |
| `DASHSCOPE_REGION`                                   | unset                        | The workspace's region, e.g. `eu-central-1` (same console page). Required when `LARKUP_VIDEO_EMBEDDING_PROVIDER=qwen3-vl-embedding`.                                                                                                                                                                                                                                                                  |
| `LARKUP_VIDEO_RUNPOD_EMBEDDING_ENDPOINT_ID`          | unset                        | Required when `LARKUP_VIDEO_EMBEDDING_PROVIDER=runpod-qwen3-vl-embedding` (also needs `RUNPOD_API_KEY`).                                                                                                                                                                                                                                                                                              |
| `LARKUP_VIDEO_HF_EMBEDDING_URL`                      | unset                        | Required when `LARKUP_VIDEO_EMBEDDING_PROVIDER=huggingface-qwen3-vl-embedding` (also needs `HF_TOKEN`).                                                                                                                                                                                                                                                                                               |
| `LARKUP_MEDIA_STORAGE`                               | `local`                      | Web app env var: `s3` switches `createStorageProvider()` to `S3StorageProvider` for canonical media (see `LARKUP_MEDIA_S3_BUCKET` etc.).                                                                                                                                                                                                                                                              |
| `WEBHOOK_SIGNING_SECRET`                             | unset                        | Signs outbound job-completion webhooks (`X-Larkup-Signature`).                                                                                                                                                                                                                                                                                                                                        |
| `STALE_JOB_TIMEOUT_HOURS`                            | `6`                          | Force-fails a queued/running job older than this on the scheduled reconcile sweep.                                                                                                                                                                                                                                                                                                                    |

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

The runtime is the default path for indexed videos. Removing this package, its
v3 catalog record, and the optional installed-tool entry cleanly removes the
implementation.
