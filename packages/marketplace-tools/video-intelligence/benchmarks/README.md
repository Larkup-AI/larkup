# Video Intelligence benchmarks

Standalone benchmark controller for the canonical video tool. It imports the
existing client, agent, evidence conversion, knowledge retrieval and inspection
code, and runs the existing Python runtime on an isolated RunPod GPU. It does
not start Larkup or change its production deployment.

Read the [implementation plan](data/implementation-report.md),
[controller API contract](data/dashboard-api-v1.md), and the repository's
benchmarking guide before changing the scientific protocol.

## Execution and resource use

RunPod is temporary benchmark infrastructure only. Production Video Intelligence
continues to use the canonical managed runtime. Native Gemini and TwelveLabs,
and frame-based Qwen, Muse and MiniMax, execute model inference at their providers;
they do not consume this Pod's GPU. The canonical Larkup runtime uses the GPU for
its local operators. Configured external ASR/vision/brain roles retain their
explicit provider paths.

The default scheduler admits up to eight tasks, with at most six answer tasks,
two CPU preparation tasks, two uploads, and one GPU indexing task. Provider
concurrency, RPM, credit checks and cooldowns still apply. Larkup and its retrieval
control remain mutually exclusive because they currently share the relay's role
and usage context. Do not raise that limit without isolating those contexts.
Independent native/frame providers can overlap that canonical work.

Frame providers sharing a source and extraction protocol decode frames once under
a shared lock, then issue independent model requests. Temporary frame filenames
are unique. Verified source hashes are cached by file identity, size, modification
and change timestamps; modified files are rechecked. A saved bootstrap marker is
not sufficient after a container restart: the launcher also checks its actual
system binaries and Python environment.

Service checks verify preparation and non-empty responses, independently of answer
correctness. Short-fixture success does not establish long-source reliability.
Multiple-choice accuracy uses the supplied reference option directly; an LLM judge
is unnecessary for that score. Infrastructure failures remain separate from wrong
answers, and unresolved paid outcomes must not be blindly submitted again.

## Start a new benchmark

From this directory, with `benchmark.env` present and mode `0600`:

```sh
./launch.sh new
```

The launcher resumes the saved benchmark Pod, opens private SSH forwarding,
starts the credential relay, and runs the independently supplied dashboard with
`pnpm run dev` at **http://127.0.0.1:3100**. `new` creates a distinct frozen
pilot experiment and selects it automatically in the dashboard. Terminal output
includes its run ID, task counts, coverage, usage and provider metrics. If the
dashboard supervisor already runs, the command uses its authenticated operator
bridge instead of opening duplicate services. Without an existing supervisor,
keep this terminal running; Ctrl-C drains, saves and stops the GPU. With an
existing supervisor, Ctrl-C closes only the extra terminal monitor.

A **run** is one independent experiment with immutable source/question/variant
selection and its own answers, attempts, costs and logs. Start a new run to get
fresh answers; use `./launch.sh resume-run RUN_ID` to continue exactly that saved
experiment without repeating its completed tasks. Unknown paid outcomes remain
blocked until reconciled. `./launch.sh` without a command retains the older
saved smoke/pilot workflow behavior. A successful smoke opens the
frozen pilot; the pilot's continue/stop/inconclusive gate never automatically
opens a larger publication run. Blocked paths require review, not repeated
billable submissions.

**Keep this PC awake and the launcher running during inference.** Existing
provider credentials stay on this PC. The Pod receives only revocable benchmark
capabilities and accesses providers through an SSH reverse tunnel. Local
canonical transcription uses `uv`, Python 3.12, and `ffmpeg`. Python 3.9+, SSH,
Node 22+, and pnpm are required locally. The launcher installs dashboard
dependencies when needed; dashboard source is in `dashboard/`.

At a completed/blocked stage the launcher checkpoints evidence and stops the
GPU. The dashboard then reads a verified local SQLite snapshot. Stopped RunPod
storage can still incur charges. Ctrl-C pauses dispatch, drains outstanding
calls, backs up, and stops the Pod. No top-ups, additional rentals or silent
model substitutions occur. An unavailable saved GPU host stays queued and retries automatically after
30, 60, 120, then 300 seconds between attempts. Home shows **Waiting for GPU
capacity**, the next attempt time and **Cancel startup**. Capacity waiting does
not create a second Pod or dispatch model calls. After RunPod accepts start,
allow up to 15 minutes for an actual SSH handshake; a published port alone is
not readiness. Then wait for both the benchmark controller and canonical video
runtime health checks before dispatch. A stuck accepted start is stopped.
Authentication/credit/permanent request errors still fail immediately. Keep the
PC and launcher running while waiting; restarting the bridge marks an unfinished
startup interrupted instead of silently authorizing a new one.

```sh
./launch.sh new                     # New independent pilot, automatically selected in UI
./launch.sh resume-run RUN_ID       # Continue only this saved experiment
./launch.sh dashboard               # Real data + operator UI; no GPU start until clicked
./launch.sh --no-dashboard          # Same workflow, CLI only
./launch.sh --view-only             # Saved results; no GPU rental or dispatch
./launch.sh account                # Observed rental balance/rate
./launch.sh status                 # Readable saved correctness/status/cost table; no rental
./launch.sh backup                 # Consistent SQLite + reviewer snapshots
./launch.sh stop                   # Emergency stop; prefer Ctrl-C for a drain
./launch.sh install                # Drained code update; provider keys excluded
```

Logs and the private Pod connection live in `data/deployment/`. The launcher
refuses occupied ports; it only stops children it previously started and whose
process start time still matches. It never selects an arbitrary free web port.

The default **Home** shows the selected provider scores, answer counts, run status,
known API cost and response time. Choose an experiment from the dropdown, then
use **New benchmark**, **Resume selected run**, **Pause**, or **Save & stop GPU**.
A new run is disabled while another is active; pause it first. **Advanced** keeps
all task/answer rows, logs, database tables, JSON exports, provider quotas and
explicit force stop. A score is null before any completed answer; different
coverage does not establish a fair ranking. Last API checks have timestamps and
scope limits; they are not a continuous stream of paid health requests.

## CLI and durable state

```sh
python3 -m harness.main init
python3 -m harness.main smoke-source
python3 -m harness.main create --manifest smoke-v1 --phase smoke --variants VARIANT_ID
python3 -m harness.main start RUN_ID
python3 -m harness.main work --until-idle
python3 -m harness.main status RUN_ID
python3 -m harness.main pause RUN_ID
python3 -m harness.main resume RUN_ID
python3 -m harness.main export RUN_ID
```

`serve` runs the authenticated loopback API and scheduler. One controller owns
the SQLite lease lock. WAL transactions persist the task DAG, immutable attempt
configuration, account/model quotas, paid submission fences, remote handles,
usage receipts, events and control idempotency. Admission rotates across
variants, durations and sources, with independent global/GPU/upload/QA limits.
Known rate limits cool down; credit/auth failures block their actual funding
scope. Exact-model fallback requires explicit verified equivalence. Unknown paid
outcomes are reconciled by saved handle or provider task identity, never blindly
submitted again. Pause drains; cancel is best effort for remote paid work.

Config reload is explicit: `reload CANDIDATE.json`, or API validate/activate with
revision checks. Invalid reload leaves the active snapshot intact. Future
attempts use the new snapshot; in-flight attempts retain their original profile
and credentials. A changed model/role/protocol needs a new variant ID. Runtime
startup role changes require a drain/restart. Editing `benchmark.env` alone does
not activate a reload. Secrets are parsed as data and are never shell-sourced.

The dataset CLI selects and verifies official complete videos using efficient
archive ranges, SHA-256 and measured duration. `python3 -m harness.datasets
--help` lists preparation commands. Licensed videos/subtitles, credentials and
operational state remain ignored. Frozen public metadata records IDs, hashes,
selection rules and declared input conditions; no full media is redistributed.

## Evidence and results

Operational exports are under `results/multimodal/video-understanding/`, with
per-run history under `data/runs/`. Each report has `blog.md`, `results.csv`, and
`data/` containing metrics, attempts, usage, source index timings and the frozen
protocol. `data/state/remote-backup.sqlite3` is an integrity-checked off-Pod
backup. A stage checkpoint also preserves canonical evidence/runtime artifacts
privately. Keep these before deleting a Pod.

For charts, `data/questions.csv` provides flat per-question timing, usage,
correctness and retry-inclusive cost columns. `data/summary.csv` compares
systems with completed/planned counts and separate preparation/question costs.
`timing.csv`, `paired.csv`, `provider-usage.csv` and `indexes.csv` preserve
latency, paired outcomes, funding usage and source preparation observations.
The API's `system` filter distinguishes Larkup, Gemini, Qwen and TwelveLabs
even when they share the Gateway funding provider. See the v1 contract for the
additive summary fields and authenticated CSV endpoints.

Official MCQ labels are sealed from answering contexts. Invalid model answers
are wrong; infrastructure failures have null correctness and retain planned
coverage. Accuracy always has a denominator. Paired uncertainty uses source
clusters. Indexing is measured once per source artifact, answer/queue timing
separately; native indexing and non-streamed TTFT are null with reasons. Actual
cash, estimates, free allowance and unknown charges remain separate. Unknown
usage can be reconciled with immutable provider receipts via `reconcile-usage`.
An independent grounding audit is required for a positive expansion gate; MCQ
accuracy alone cannot certify citations.

## Verify

```sh
python3 -m unittest discover -s harness/tests -v
# Run from packages/core, where canonical tsx is installed:
node --import tsx --test ../marketplace-tools/video-intelligence/benchmarks/harness/tests/tool-bridge.test.mjs
pnpm --filter @larkup/tool-video-intelligence type-check
pnpm --filter @larkup/tool-video-intelligence test
pnpm --filter @larkup/tool-video-intelligence build
```

The harness is excluded from the package's published files. This isolated
benchmark does not require npm publishing, Cloud synchronization or a production
runtime release.


## Dashboard operator console

`./launch.sh dashboard` opens the real local operator console without starting
GPU compute or inference. It leaves existing SSH/provider transports intact.
The Start / resume benchmark button explicitly resumes the saved Pod and the
preregistered workflow. `./launch.sh` starts that workflow directly and prints
startup stages, state changes, task counts, coverage and known/unknown costs in
the terminal. `./launch.sh --view-only` reads the saved checkpoint only: all
mutations are disabled and it makes no RunPod/provider requests.

Tabs separate Overview, Processes, Results, Logs, Database, Services & providers,
and Events. Processes/results and database rows have cursor pagination; stored
JSON expands inline. Table JSON and full-run JSON/CSV downloads contain actual
controller data. Database inspection is readonly and allowlisted, with no SQL
endpoint. Credentials, gold labels and signed URL parameters are redacted.
Logs poll every two seconds and support reading from the beginning and exporting
loaded lines. The view retains the latest 3,000 loaded lines; complete retained
files are paginated by byte cursor. Remote logs are included in stage backups.
Service/GPU status carries observed timestamps; unavailable metadata stays unknown.

Run-level start/pause/resume/cancel remain separate from global operator controls.
Pause all stops new workflow dispatch and drains running requests. Save & stop
GPU pauses, drains, creates an off-Pod checkpoint, then stops compute. Force stop
GPU requires typing `STOP GPU`: it skips the final drain/backup, may leave unknown
paid outcomes, and never makes existing provider charges disappear. Operator
commands use durable IDs, body-hash idempotency, revisions, server-side credentials
and exact loopback Origin checks. The supervisor never opens a publication run.


## Current prospective model matrix

| System | Exact model | Route | Input |
| --- | --- | --- | --- |
| Qwen | `alibaba/qwen3.8-max` | Vercel Gateway | Up to 128 timestamped frames + official subtitles/canonical ASR |
| Meta Muse Spark | `meta/muse-spark-1.3` | Vercel Gateway | Same frame/subtitle protocol |
| MiniMax | `minimax/minimax-m3` | Vercel Gateway | Same frame/subtitle protocol |
| Gemini | `google/gemini-3.8-flash` | Vercel Gateway | Full native video/audio within declared input limits |
| TwelveLabs | `pegasus1.5` | TwelveLabs direct Analyze | Full native video/audio |
| Larkup | Gemini 3.6 Flash brain/vision; Gemini 3.8 Flash answer; Deepgram nova-3 audio | Canonical runtime + Gateway/Deepgram | Canonical evidence/query/inspection |

The same-backbone retrieval ablation keeps the Larkup answer model fixed.
The three new frame baselines use explicit letter-labelled options (v2 variants).
Old runs and prompts remain unchanged. `data/frozen-profile-v5.json` and
`data/frozen-pilot-v5.json` describe the next pilot: the same eight development
videos and 19 official questions, six main systems plus six retrieval-ablation
cells (120 planned answers). This is a new requested model matrix, not a
publication expansion. No scores are mixed with the earlier pilot.

**New benchmark** automatically smoke-tests missing immutable variants first,
shows that smoke run, and selects its pilot once every required service returns
nonempty answers. A failed/incomplete smoke prevents the pilot. Pause/stop still
work between stages. The continue/stop/inconclusive gate remains unchanged.
