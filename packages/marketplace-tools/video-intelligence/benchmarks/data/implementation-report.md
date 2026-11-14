# Video Intelligence tool benchmark implementation plan

Updated 2026-11-14 from the user's latest instructions. This replaces the earlier
fixed-budget, custom-lecture and hosted-dashboard plan. It is an implementation
handoff: no benchmark has been run and no GPU has been rented by this change.

## Location and credentials: start here

All benchmark work belongs to this canonical package, not `larkup-cloud`:
`packages/marketplace-tools/video-intelligence/benchmarks/` in the `larkup`
repository. Unless explicitly stated otherwise, implementation paths below are
relative to the **video-intelligence package directory**, not the repository root.
This plan is `benchmarks/data/implementation-report.md`; the dashboard contract
is `benchmarks/data/dashboard-api-v1.md`.

The user's populated private credentials file is **`benchmarks/benchmark.env`**
inside this package. It has been moved here, is ignored by Git and Docker, and
has mode 0600. The benchmark agent should load this existing file directly;
do not ask the user to supply these keys again unless an actual validation or
authorization failure requires correction. Presence is confirmed; validity and
live balances have not been verified with billable/provider requests.

| Service           | Existing variable names                         | Harness mapping / purpose                                                                            |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Deepgram          | `DEEPGRAM_APIKEY1` through `DEEPGRAM_APIKEY3`   | Independent speech account aliases; selected key becomes private `DEEPGRAM_API_KEY`                  |
| Gemini            | `GEMINI_APIKEY1` through `GEMINI_APIKEY7`       | Independent account/project aliases; establish paid/free mapping without inferring it from numbering |
| TwelveLabs        | `TWELEVE_LABS_KEY1` through `TWELEVE_LABS_KEY5` | Keep this existing spelling; account-scoped assets/indexes and allowance                             |
| Qwen              | `QWEN_APIKEY`                                   | Direct Qwen route; verify region/endpoint/model                                                      |
| Vercel AI Gateway | `VERCEL_GATEWAY_API_KEY`                        | Map privately to canonical `AI_GATEWAY_API_KEY` where required                                       |
| DeepSeek          | `DEEPSEEK_APIKEY`                               | Direct brain/answer role credential                                                                  |
| RunPod            | `RUNPOD_APIKEY`                                 | Existing infrastructure credential; map privately to an SDK's `RUNPOD_API_KEY` if required           |

Discover additional numbered keys if the file changes. Store aliases only in
configs/results. Future controller/runtime authentication tokens and Pod SSH
connection metadata are local deployment state: generate/obtain them during
setup rather than confuse them with missing provider keys. Never commit the
real env file, copy it into an image or benchmark artifact, print its values, or
let the dashboard agent/browser read it. Its move does not rotate any key.

## Decisions and implementation scope

- First run a small, accuracy-first viability experiment across Larkup, Gemini,
  TwelveLabs and Qwen. Expand only if the evidence justifies it.
- Use **RunPod**. The user plans to add **$15 credit**; verify that it arrived.
  Do not book a fixed number of hours based on an advertised rate.
- Remove the custom three-hour lectures. Include varying-length **public
  benchmark videos**, including the official longer duration groups.
- Use observed usage and live quota/balance state rather than hard-coded dollar
  allocations to each provider. Exhaustion is a normal scheduler state.
- Make model/key/route changes effective during the loop without rebuilding the
  runtime image. Freeze the effective configuration per task/experiment cell.
- Keep the main Larkup server/API and production managed video service untouched.
  Benchmark the video tool runtime and its tool-owned evidence/query actions
  through a minimal private adapter. Do not host the whole Larkup application.
- **Do not implement the dashboard in the benchmark implementation task.**
  Provide the [versioned API contract](dashboard-api-v1.md) first. Another agent
  can build a dashboard from it concurrently, using mocks.
- That dashboard will run **locally on the user's PC**, from
  `benchmarks/apps/video-dashboard/`. No Vercel deployment is requested.

This is documentation and research for **Video Intelligence itself**. The user
explicitly authorizes an isolated RunPod benchmark, not a production runtime
migration. Follow the [canonical repository agent guide](../../../../../AGENTS.md)
and [runtime guide](../../runtime/README.md). The existing
[benchmark methodology guide](../../../../../../larkup-cloud/docs/benchmarking-guide.md)
is a read-only process reference, not a dependency on a Cloud server. No
production deployment, npm publication or package synchronization is needed for
this documentation move. Do not add benchmark implementation to the Cloud repo.

## 1. Viability experiment before the full build

The research question is whether the Video Intelligence tool's software pipeline improves answer
quality and grounding over credible model/native-system baselines, and what
indexing, monetary and latency tradeoffs that entails. Speed or cheap API usage
alone is insufficient to justify expansion for this user.

### Small engineering smoke test

Use one short licensed clip and two deterministic development questions. Verify
each required adapter, actual model availability, audio handling, task polling,
answer extraction, citations where supported, and usage collection. One minimal
RunPod runtime boot is allowed here if required; defer full environment tuning
until the comparative viability result. A CPU-only Larkup smoke run can validate
wiring, but its timing must not be treated as the final GPU speed result.

Test authentication with metadata or tiny payloads where possible, rather than
index a video once per key. Infrastructure failure blocks the affected path;
it cannot establish that Larkup or another system is inaccurate.

### Comparative pilot

Select **8 complete videos and approximately 24 official questions** before
seeing answers: four Video-MME sources and four LongVideoBench sources, with
short, medium and longer videos represented. Aim for 2-3 questions per source;
use actual official availability rather than invent questions to reach 24.
At least two sources should test longer inputs. Include temporal reasoning,
fine visual detail/OCR, audio/subtitle-dependent content and global understanding
where the official question metadata supports those categories.

Run these named configurations on the same eligible questions:

1. Gemini native video, with its supported native tools/settings disclosed.
2. Qwen video or timestamped multi-frame input, with ASR text when needed.
3. TwelveLabs native Analyze, using its supported input/API configuration.
4. Video Intelligence tool, using a fixed declared vision/brain/answer profile.
5. On a small matched part, Larkup versus simple evidence retrieval with the
   **same answer model**. This separates pipeline gains from backbone gains.

The evaluated system is the tool's canonical indexing, evidence retrieval,
inspection and grounding policy, with a small declared answer-model wrapper for
scoring official QA. This is **not an end-to-end Larkup chat benchmark**. Import
`src/client.ts`/`src/agent.ts` and reuse the tool's query/inspection actions;
provide only their minimal isolated evidence/storage callbacks. A summary-only
prompt is an extraction baseline, not equivalent to the full video tool policy.
If those tool actions are not wired yet, mark the comparative gate inconclusive.
Give native comparators supported video/audio/subtitle inputs and disclose
asymmetric capabilities. Hold the scoring wrapper fixed for pipeline ablations.

Record per-question correctness, paired wins/losses, unsupported claims and
grounding when reference evidence exists; cost of all API activity; preparation,
upload and index time; warm response time and queue wait separately. For native
services without persistent indexing, index time is **not applicable**, while
their input processing is included in answer latency/cost. Report cold first
answer separately from reused-source questions.

### Continue / stop / inconclusive

Write the decision criteria into the run manifest **before** receiving pilot
answers. Suggested practical rule, to be accepted/frozen before execution:

- **Continue** when there is a repeatable positive correctness signal over the
  strongest eligible native baseline across multiple sources/capabilities,
  without a systematic grounding regression. Inspect paired answers, not just
  an aggregate percentage. A weaker backbone or unfair input limit is not proof.
- **Stop expansion** when a valid completed pilot shows no meaningful accuracy
  benefit, or Larkup is consistently worse on the important capabilities. Export
  the negative result and failure analysis; do not spend the rest trying many
  models until one makes the plot look favorable.
- **Inconclusive** when the sample is too small/mixed, provider coverage is
  incomplete, or the difference is within uncertainty. At most one predeclared
  modest pilot extension can resolve uncertainty. Otherwise pause with an honest
  inconclusive report rather than equate it with success or proven inferiority.

The pilot is a feasibility signal, **not statistical proof of superiority**.
Do not invent a statistically significant threshold from 24 correlated questions.
Changing prompts/code using pilot failures is development: keep those sources
out of the held-out publication set. Follow the existing focused-failure process
for any fix; no broad reruns while one or two selected regressions still fail.

## 2. Dataset selection for a research paper

Use established annotated datasets as the primary evidence, not a custom demo
collection and not only the eight pilot sources. Diverse duration matters, even
though custom three-hour lectures have been removed.

| Dataset            | Role                                           | Why / protocol                                                                                                                               |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Video-MME**      | Primary benchmark                              | 900 videos, 2,700 human-annotated QA, multiple domains; explicit short/medium/long groups and audio/subtitle conditions                      |
| **LongVideoBench** | Independent secondary benchmark                | Referring reasoning over video and aligned subtitles, varying durations up to about an hour; start with publicly labeled validation examples |
| **MLVU**           | Optional third benchmark after the core passes | Different task types/genres, useful for checking whether gains generalize beyond one QA format                                               |
| **EgoSchema**      | Optional temporal/egocentric slice             | Three-minute first-person clips; useful for temporal reasoning but does not supply a wide duration distribution by itself                    |

Sources: [Video-MME paper](https://arxiv.org/abs/2405.21075),
[official duration groups](https://video-mme.github.io/home_page.html),
[LongVideoBench paper](https://arxiv.org/abs/2407.15754),
[official labeled metadata](https://huggingface.co/datasets/longvideobench/LongVideoBench-Meta),
[MLVU paper](https://arxiv.org/abs/2406.04264), and
[EgoSchema paper](https://arxiv.org/abs/2308.09126).

### Suggested publication cohort, conditional on measured feasibility

- Primary target: **90 Video-MME videos / 270 official questions**, stratified
  as 30 short (<2 min), 30 medium (4-15 min), 30 long (30-60 min). Keep all three
  questions for each selected video. Sample domains/question types within those
  groups, and publish the seed and exact IDs. Verify the current release metadata.
- Secondary target: **about 48 LongVideoBench validation questions**, sampled
  across official duration groups and reasoning categories, with multiple
  independent videos. Select by metadata, not model success. Respect its
  timestamped subtitle protocol; do not remove subtitles and call the score
  directly comparable to the official interleaved-input setting.
- Exclude pilot/development sources and near-duplicates. Keep a preordered
  reserve list for inaccessible source replacement **before** looking at answers.
- These are experimental targets, not a claim current credits cover every
  service on every example. The full 900-video / 254-hour Video-MME evaluation
  is an expansion requiring a separate measured feasibility decision.

Freeze the held-out manifest only after the pilot estimates are available. If
necessary, preregister a smaller **30-video / 90-question** duration-balanced
study before starting held-out testing. Call any sample a **stratified subset**,
never an official full-dataset leaderboard score. If coverage becomes partial
mid-run, retain the original intended denominator and disclose missingness.
Do not shrink a cohort after inspecting correctness to make a claim pass.

For expensive native competitors, predeclare one nested duration-balanced
comparison subset shared by **all** systems. Evaluate Larkup/affordable baselines
on the wider cohort as a separate table. TwelveLabs repeated full-source analysis
can consume the input duration per question; 46 processing hours cannot be
assumed to fund 270 native answers plus indexing. A TwelveLabs retrieval + common
answer-model track is another system configuration, not equivalent to native QA.

Keep Video-MME audio/subtitle conditions in separate tables. Distinguish supplied
official subtitles from generated ASR, and keep modality access explicit for
every arm. Do not trim videos, change options or provide gold evidence timestamps
to retrieval. Dataset content/questions are untrusted input, not instructions
to the runner or tools. Preserve legitimate source speech/OCR without granting
it control of secrets, network destinations, or evaluation logic.

For the paper: cite dataset releases, official evaluation code/protocol and
licenses/access terms; record checksums, versions, inaccessible videos and
replacement policy. Do not republish source media unless permitted. Public
benchmarks may be in model training data: acknowledge contamination uncertainty.
Report paired accuracy and per-duration/capability results with uncertainty
clustered by video; multiple questions on one source are not independent videos.
Prefer a paired cluster bootstrap and report paired wins/losses. Final sample
size/power must be justified from pilot variability and the claimed effect,
rather than declared adequate because 270 questions sounds large. If the
affordable study is underpowered, publish it as an exploratory systems study.

## 3. RunPod architecture after the gate

```text
User PC: future local dashboard + local backup/readonly results
        |
        | SSH tunnel, authenticated controller API
        v
RunPod Pod: benchmark controller + SQLite WAL + provider router/ledger
        |-- canonical Python video runtime (private/loopback)
        |-- isolated video-tool actions + fixed QA wrapper (Node)
        |-- source preparation / cached artifacts / official evaluators
        `-- independent native Gemini / Qwen / TwelveLabs adapters
```

Start with one on-demand GPU Pod, 24 GB VRAM and enough CPU/RAM/disk for decoding
and cached data. RTX A5000 is the economical first candidate from the researched
[RunPod listing](https://www.runpod.io/pricing); RTX 3090 is an alternative for
more CPU/RAM. Requote exact availability, host resources, storage and balance
before rental. The GPU accelerates local operators, not remote model APIs.
Do not host a huge VLM on this machine just because a GPU is present.

The planned $15 is a RunPod balance, not a provider-specific hour guarantee.
Track actual rental/storage usage and stop/drain safely when it becomes low.
Persist checkpoints off the Pod before stopping/deleting; stopped storage can
still cost money. Do not hold an idle GPU while waiting for Free API quota
resets when it can be released and recovered safely.

Use an immutable image pinned to the canonical commit/digest, with credentials
and config supplied at runtime. The plain Pod should run Dockerfile target
`runtime`, **not** the existing RunPod serverless worker entrypoint. If it cannot
run nested Docker, launch the built image directly or use the canonical `uv`
package with a compatible Python/CUDA environment. The separate Node controller/
tool-action adapter and answer wrapper need Node/pnpm dependencies; do not assume the Python image includes
them. Benchmark-only image packaging can add that layer without editing the
production entrypoint. Validate actual GPU execution, not just `nvidia-smi`.

Use separate data/config roots, project identifiers, runtime credentials and
private ports. No production DB, Cloud adapter, queue or managed-runtime changes.
The remote controller is authoritative while running. Periodically produce a
consistent SQLite backup and copy it plus completed artifacts to the PC. Local
dashboard offline reads are readonly snapshots, not another active scheduler.

## 4. Reuse canonical code and hot configuration

Existing relevant source:

| Source relative to this video package                                        | What is already available                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `compose.yaml`, `compose.gpu.yaml`, `runtime/Dockerfile`                     | Portable CPU/GPU runtime packaging; secure default ports/auth                              |
| `runtime/pyproject.toml`, `runtime/uv.lock`                                  | Standalone Python runtime package                                                          |
| `runtime/app/api/v1.py`, `runtime/app/db/schemas.py`                         | Health/upload/submit/poll/cancel/usage; job-scoped audio/brain/vision credentials          |
| `runtime/app/model_configuration.py`                                         | Temporary credentials and process-wide environment lock                                    |
| `runtime/app/api/deps.py`, `runtime/app/config.py`                           | Startup-cached settings; editing an env file does not hot-reload objects                   |
| `runtime/app/services/{jobs,pipeline,brain,vision,transcription}.py`         | Canonical extraction and internal retries/fallbacks                                        |
| `src/{client,agent,contracts}.ts`, `src/agent.test.ts`                       | Canonical client, evidence, query/inspection actions and nearest action tests              |
| `../../marketplace/src/tool-extension.ts`                                    | `AgentToolExecutionContext.mediaEvidence` callback contract                                |
| `../../core/src/video-knowledge/{store,query-engine,query-planner,types}.ts` | Shared video evidence persistence/query machinery used by the tool; reuse rather than copy |

Do not mount `workspace-server` chat routes, boot the main Larkup server, or use
Cloud project/auth/API drivers. Supply the tool's scoped `mediaEvidence`
callbacks from isolated benchmark state using existing shared video primitives.
`inspectVideoKnowledge` currently calls `/api/media/inspect` using its execution
context origin: provide that narrow private adapter forwarding to the same
canonical runtime and updating benchmark evidence. Citation media URLs can be
served privately for inspection. This small tool adapter does not require the
full application API, UI, organization/auth subsystem or production database.
The Python extraction runtime itself has **no general QA endpoint**: declare the
fixed benchmark answer-model wrapper and count its calls separately.

### Configuration layers

1. **Image:** code/dependencies only; rebuild on code/dependency changes.
2. **Private secret file:** parse `benchmarks/benchmark.env` using dotenv as data, never
   shell-source it. Mount/copy securely outside image layers. Only opaque aliases
   enter manifests/events. `VERCEL_GATEWAY_API_KEY` maps privately to canonical
   `AI_GATEWAY_API_KEY`; retain the existing `TWELEVE_LABS_KEY*` spelling.
3. **Immutable run profiles:** model IDs, provider/route priorities, role settings,
   sampling, step/time limits and concurrency. Each has a content hash/revision.
4. **Live scheduler state:** observed quotas, cooldowns, balances and route health;
   updating this is not the same as changing a scientific model configuration.

Implement explicit `validate -> activate` config reload via the controller API.
Parse the entire candidate, validate secret references and capability mappings,
then atomically swap the snapshot for **future dispatches**. Invalid candidates
leave the last good config active. Pin each running attempt's snapshot; changes
never mutate a request in flight. Editing `.env` alone must not masquerade as
reload. Do not require rebuilding the image to change keys or models.

Prefer existing `POST /v1/jobs` transient `modelConfiguration` for job-boundary
switches. Startup flags should allow the required capabilities. Its current
mapping fixes some base URLs, sets a transcription fallback and disables optional
embeddings: verify effects rather than promise arbitrary per-request settings.
Model/role changes are new immutable variants; source indexes are reusable only
when extraction fingerprints are unchanged.

For smooth **per-request** routing/metering, use a private protocol-compatible
router outside the product pipeline, with runtime process-scoped base URLs
(`LARKUP_VIDEO_AGENT_BASE_URL`, `LARKUP_VIDEO_VISION_BASE_URL`,
`LARKUP_VIDEO_GEMINI_BASE_URL`). Do not combine these blindly with job configuration
that overwrites them. The router can map an opaque model route to an exact native
ID and inject provider credentials, while preserving prompts and protocol.
If a canonical interface extension is necessary, change/test it upstream instead
of patching a second Cloud pipeline. Secrets stay memory-only and redacted.

The current process-wide environment lock serializes differently configured
jobs. Use one indexing job per runtime process initially. More profiles require
isolated processes/containers and data directories, or an intentionally tested
canonical configuration change. Process restarts for startup-only settings may
be necessary after draining; **no image rebuild** is required. Persist the exact
effective role config, not just a label from a startup health response.

## 5. Larkup is a pipeline: evaluate model roles honestly

Define a pipeline configuration as:

`canonical revision + ASR + extraction brain + index vision + refinement vision

- retrieval/embedding settings + answer model + tool/sampling policy`.

Separate two research questions:

- **Pipeline contribution:** fixed ASR/vision evidence and answer backbone,
  simple retrieval versus canonical video-tool query/inspection/grounding actions.
- **Best attainable system:** Larkup's declared multi-model recipe versus native
  Gemini, Qwen and TwelveLabs configurations, with complete cost accounting.

Use a small development matrix, not an exhaustive Cartesian product: Gemini
Flash and Qwen VL as index-vision candidates; DeepSeek as a cheap planning/text
role; one stronger Gateway vision option for bounded refinement where justified.
Hold the answer model fixed while varying vision, then hold the selected index
fixed while comparing answer models. Reuse unchanged extraction artifacts.
Select/freeze the final recipe on development results; never route based on gold
answers or tune selection on the held-out set. A deterministic adaptive router
can be an evaluated policy if its rules and every chosen model are recorded.

Direct Gemini/Qwen and their Gateway routes are funding/routing alternatives,
not independent models. Verify exact IDs, versions, video/image/tool support and
region on actual credentials. Cross-route equivalence is not guaranteed by a
similar model name. Funding follows the actual route: Gateway credit does not
automatically spend the direct account's balance without verified BYOK billing.
Any fallback to a different model changes the variant; never silently pool it
with the original model's accuracy or latency.

## 6. Adaptive asynchronous scheduler

Use a small durable task DAG and async adapter workers. SQLite is sufficient
for this single-controller setup; Redis/SQS is not needed initially. Provider
calls run concurrently; no global loop waits for the slowest provider.

```text
source available -> probe/fingerprint -> provider-specific prepare/index
                                      -> question attempts -> score -> export
```

Every provider-specific branch progresses independently. Poll asynchronous
remote tasks without holding GPU slots. A source's ready questions can run while
another source indexes. Overlap speech and visual work only through existing
canonical pipeline behavior. Avoid wrapping concurrent sources around unbounded
chunk workers. Source and provider upload/cache IDs remain account-scoped.

Dispatch algorithm:

1. Transactionally lease eligible ready tasks, fairly interleaving systems,
   duration groups and sources; avoid testing easy/short items first on one
   service until its credit disappears.
2. Resolve an allowed route and acquire per-account/project/model token buckets,
   daily/processing-duration allowance and concurrency permits. Consider request
   tokens/duration, not just RPM. Unknown balance is not zero or unlimited.
3. Pin attempt/config/route, reserve estimated usage when available, and submit.
   Persist remote handles immediately. No provider key enters persisted payloads.
4. Stream or poll independently; append progress and usage events. Release slots
   after completion, reconcile actual usage and enqueue dependent tasks.
5. On failure, classify its scope and next eligible time. Continue unrelated
   tasks; exit/checkpoint when all remaining tasks are terminal or blocked.

Use conservative initial concurrency and controlled additive increase after
successes; reduce on 429/resource pressure. Discover quotas rather than invent
a universal Gemini Free limit. [Google quotas](https://aistudio.google.com/docs/rate-limits)
are per project/model, not key. Different accounts confirmed by the user may
provide independent capacity, subject to each account's applicable limits.
Use provider headers/dashboard snapshots and known reset zones; don't synchronize
daily resets to the PC's local midnight.

Keep separate semaphores for GPU indexing, CPU decoding, uploads, QA and judges,
plus a bounded global in-flight count. Give ready question attempts fair service
without starving indexing. Event polling is not the same kind of work as paid
submission. Measure identical predeclared contention profiles for published speed;
record queue wait separately from provider response time and saturated throughput.

## 7. Exhaustion, retries and partial completion

Account snapshot, **not fixed allocations**: TwelveLabs 46 legacy processing
hours reported remaining across five independent accounts; Deepgram $600 total;
Gemini $14 paid plus Free accounts; Qwen $7.50; Gateway $14.80; DeepSeek $5;
RunPod planned $15. Verify balances before execution and refresh while running.
At inspection there were seven numbered Gemini entries although one paid
plus seven Free accounts were reported; resolve the mapping privately.

[TwelveLabs legacy allowance](https://docs.twelvelabs.io/docs/concepts/indexes)
is shared by processing operations, deletion does not replenish it, and repeated
Analyze can consume duration again. Asset/index handles are account-specific.
Do not confuse rate-limit duration counters with remaining lifetime allowance.
Preserve source affinity and reuse uploads/indexes/transcripts. Don't perform
unnecessary separate embedding or image analyses just because an endpoint exists.

| Situation                                              | Action                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Provider branch completed its work                     | Release capacity; continue other ready branches                                         |
| Transient 429 or temporary capacity failure            | Honor Retry-After/reset, jitter, reduce concurrency for that quota scope                |
| Daily quota reached                                    | Mark waiting with reset time; choose another eligible predeclared route or wait         |
| Credits/lifetime allowance exhausted                   | Disable that funding pool; keep independent branches running                            |
| Direct Gemini/Qwen exhausted                           | Use exact-model Gateway route if verified and funded; record provider/tier/route change |
| Different model is the only available route            | Create a separate variant or block the original; never silently replace it              |
| ASR unavailable but transcript already persisted       | Continue QA; new speech preparation waits                                               |
| Provider unavailable before a required core comparison | Mark comparison incomplete, not a correctness failure                                   |
| All remaining work is blocked                          | Checkpoint, expose reason/earliest reset, drain and release idle rental safely          |
| Auth/config failure                                    | Disable affected scope immediately; require correction before billable retry            |
| Timeout with unknown submission outcome                | Reconcile task/provider handles before retrying potentially billable work               |

Bound total attempts (including nested runtime/provider retries), tool steps,
output lengths and task deadlines to prevent runaway loops. These are execution
safety limits, not hard-coded cash allocations. Use a small finite retry budget
for transient failures; do not repeatedly retry exhausted credit. No automatic
top-ups, extra rentals, or account creation. Optional operator-set spend limits
are supported but must not be invented as scientific provider restrictions.

Pause stops **new dispatches** and drains in-flight work. Cancel is best-effort;
already submitted remote work can still finish and be billed. The current Python
BackgroundTasks runtime is not a durable mid-pipeline resume implementation.
Recover at persisted stage boundaries; do not promise per-clip resume unless
canonical checkpoints and their tests are implemented.

Persist leases/heartbeats, remote handles and idempotency keys so crashes do not
duplicate indexing. Reconcile lost lease outcomes before requeue. Writes of
completed evidence/answers use atomic rename. Estimated and unknown charges
remain visible until reconciled. Do not retry a whole corpus to recover one task.

Infrastructure-blocked examples do not count as wrong answers. Report attempted
cohort, per-system completion/availability, blocked reasons, and accuracy on a
predeclared shared completed subset with missingness disclosed. Never hide hard
examples by silently reporting only the successfully completed intersection.

## 8. Storage and reproducibility

Proposed orchestration code: `benchmarks/harness/`; existing product logic
stays canonical. Proposed local dashboard: `benchmarks/apps/video-dashboard/`.
Keep private operational state under `benchmarks/data/`. Publish the final
report under `benchmarks/results/multimodal/video-understanding/` containing
only `data/`, `blog.md`, `results.csv` and an optional informative chart, following
the existing benchmark guide. Harness/dashboard code stays outside that report
root but inside this package's `benchmarks/` directory.

Private operational layout under `data/`:

```text
datasets/manifest.json       # release, IDs, official labels, checksums, licenses
configs/                    # immutable sanitized role/route/protocol snapshots
sources/                    # licensed source cache; not committed/published
artifacts/<source-hash>/<extraction-config-hash>/
state/benchmark.sqlite3     # WAL; live authoritative controller DB
runs/<run-id>/              # minimal answers/usage/adjudication/provenance
exports/                    # generated sanitized export staging
```

SQLite tables: runs, sources, questions, variants, tasks, attempts, provider_scopes,
remote_handles, usage_events, artifacts, evaluations, config_revisions and events.
Use unique constraints for task identity and event sequence, transactional leases
and schema migrations for the benchmark's own DB. This is isolated benchmark
state, not a production Cloud schema migration. The source manifest and labels
must not be served to answer models except the actual question/options.

Record canonical/image/model revisions; source fingerprint; question/variant;
account alias/route/tier; sampling/input protocol; actual tool/model calls;
monotonic timing plus UTC wall timestamps; provider tokens/cache/reasoning usage;
processing seconds; actual/estimated/unknown cost; answers/evidence; evaluation
version and error class. Paid cash, free allowance consumed and list-price
equivalent are different metrics. Do not double-count API cost and ledger deltas.

Cache keys include extraction-affecting models/settings, canonical revision,
source hash and modality policy. Changing answer model can reuse evidence;
changing index vision cannot claim to reuse an unchanged scientific index.
Preserve independent retry histories, don't overwrite old attempts with new ones.
Never persist keys, auth headers, secret-bearing URLs or raw env content.

Export incremental results so controller loss does not erase prior evidence.
Use SQLite backup/snapshot mechanisms rather than copying only the main file
while WAL writes continue. Verify backup restoration in the smoke tests. Keep
private traces separate from sanitized reviewer artifacts and public exports.

## 9. Quality, cost and timing evaluation

Primary outcome: official MCQ accuracy, paired correctness, per-duration/domain/
reasoning-category performance. Validate answer parsing; invalid-format answers
are visible. Grounding correctness is an additional metric when human evidence
annotations exist; MCQ labels alone do not certify timestamp accuracy. Manual
audit or separately annotated evidence is required for citation-quality claims.
Use independent judges only for qualitative output, never to replace official
labels or infer truth from the evaluated system's own transcript/summary.

Secondary outcomes: unsupported claims, retrieval misses, index completion,
cold end-to-end first answer, warm QA p50/p95, queue time, throughput, all API/
compute cost, and amortized index cost at multiple question counts. Low sample
p95 is descriptive and unstable: publish sample count and measurement procedure.
Keep latency comparisons within matched input/protocol/contended-load conditions.
Native services may not expose TTFT or internal index timing; use null with reason.

Accuracy gain is the primary continuation signal. Do not improve speed by
dropping modalities or shrinking context only for a competitor. Native-system
and fixed-backbone/equal-input tracks answer different questions; report both.

Optional ablations after the core passes: index vision backbone; bounded
refinement on/off; retrieval/verification on/off using canonical hooks; fixed
frame budget; and [Video Panels](https://arxiv.org/html/2509.23724v2). That paper's
panels exchange spatial detail for temporal coverage; test OCR/detail regressions
as well as temporal gains. Keep timestamps and access to full-resolution crops.
YOLO alone does not replace semantic video reasoning. SVG is an optional output
artifact, not an automatic video compression/understanding improvement.

## 10. Required algorithm tests before paid expansion

Implement typed interfaces and deterministic fault-injected tests rather than
tests that only mirror a happy path. Required meaningful cases:

- concurrent fast/slow providers do not serialize all other work;
- per-project/account quota isolation, shared-key quota aggregation, token and
  duration limits, cooldown/reset and fair queue scheduling;
- complete credit exhaustion, zero/unknown balances, exact-model direct/Gateway
  fallback and refusal to mix different models into one variant;
- mid-run reload, invalid reload rollback, immutable in-flight snapshots,
  revoked keys and no process-global configuration leakage;
- duplicate submissions, controller crash, unknown remote outcome, lease expiry,
  retry reconciliation and artifact/cache fingerprint invalidation;
- pause/drain/resume, best-effort cancellation, remote calls finishing after a
  pause, terminal blocked state and restoration from a real backup;
- malformed/streamed answers, official MCQ scoring, original-clock timestamps,
  infra errors excluded from accuracy, missing-coverage reporting;
- usage unknown/reconciliation, redaction, loopback/auth/Origin protection and
  no side-effecting control from public/untrusted content.

Run mocked adapter/contract tests first, then the one-source smoke and comparative
pilot. Narrow canonical regressions/typechecks/tests apply to any shared code
change. Do not claim algorithm coverage or tool-action parity just because health
checks and a text-only prompt work. A later code release follows the linked
release matrix; no production deployment is needed to execute an isolated pilot.

## 11. Work split, dashboard contract and next-agent order

**Benchmark agent owns:** CLI, schemas, scheduler/DB, adapters, RunPod packaging,
configuration reload, official data/evaluators, private video-tool adapter, tests and
results. **Separate dashboard agent owns:** only
`benchmarks/apps/video-dashboard/`, local startup, views/controls and mock client
fixtures for the [v1 contract](dashboard-api-v1.md). They can work in parallel
once the contract is accepted, without sharing secret files or changing each
other's implementation. This plan does not start that dashboard implementation.

Required order for the next benchmark agent:

1. Read this plan and existing runbook; preserve parallel edits. Validate secret
   aliases/account mapping and available dataset metadata without printing keys.
2. Implement the minimal typed adapters, official scorer and persisted result
   format needed for the short smoke and comparative pilot. Freeze pilot cohort,
   model/input protocol and continuation decision rule before execution.
3. Run the smoke, then the comparative pilot. Export `blog.md`/CSV and decision
   even if negative. Stop expansion on negative/inconclusive evidence as above.
4. If positive, finish RunPod durable environment, configuration reload/router,
   scheduler concurrency/recovery and private video-tool query/inspection integration;
   validate required fault-injected and real restart tests.
5. Freeze development-selected pipeline recipes and held-out duration-balanced
   publication cohorts based on measured feasibility. Freeze native nested
   comparison subset and missingness policy before held-out evaluation.
6. Run the final core comparison, then justified ablations. Export usage,
   accuracy, timing, coverage and reproducibility artifacts. Publish limitations
   and uncertainty without presenting pilot success as a general SOTA claim.

All implementation and dashboard work is scoped to this video package.
The backend contract is a design deliverable now, not a working API. The next
agent must keep it and contract tests synchronized with the implementation.
The local dashboard must be optional: the CLI can complete, pause, resume and
export a run without any web app.
