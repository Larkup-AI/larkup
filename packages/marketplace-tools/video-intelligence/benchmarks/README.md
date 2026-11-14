# Video Intelligence benchmarks

Standalone benchmark controller for the canonical video tool. It imports the
existing client, agent, evidence conversion, knowledge retrieval and inspection
code, and runs the existing Python runtime on an isolated RunPod GPU. It does
not start Larkup or change its production deployment.

Read the [implementation plan](data/implementation-report.md),
[controller API contract](data/dashboard-api-v1.md), and the repository's
benchmarking guide before changing the scientific protocol.

## Run everything

From this directory, with `benchmark.env` present and mode `0600`:

```sh
./launch.sh
```

The launcher resumes the saved benchmark Pod, opens private SSH forwarding,
starts the credential relay, and runs the independently supplied dashboard with
`pnpm run dev` at **http://127.0.0.1:3100**. It resumes the saved smoke/pilot
workflow rather than creating duplicate runs. A successful smoke opens the
frozen pilot; the pilot's continue/stop/inconclusive gate never automatically
opens a larger publication run. Blocked paths require review, not repeated
billable submissions.

**Keep this PC awake and the launcher running during inference.** Existing
provider credentials stay on this PC. The Pod receives only revocable benchmark
capabilities and accesses providers through an SSH reverse tunnel. Local
canonical transcription uses `uv`, Python 3.12, and `ffmpeg`. Python 3.9+, SSH,
Node 22+, and pnpm are required locally. The launcher installs dashboard
dependencies when needed; dashboard implementation belongs to its separate agent.

At a completed/blocked stage the launcher checkpoints evidence and stops the
GPU. The dashboard then reads a verified local SQLite snapshot. Stopped RunPod
storage can still incur charges. Ctrl-C pauses dispatch, drains outstanding
calls, backs up, and stops the Pod. No top-ups, additional rentals or silent
model substitutions occur. An unavailable saved GPU host is reported explicitly.

```sh
./launch.sh --no-dashboard          # Same workflow, CLI only
./launch.sh --view-only             # Saved results; no GPU rental or dispatch
./launch.sh account                # Observed rental balance/rate
./launch.sh backup                 # Consistent SQLite + reviewer snapshots
./launch.sh stop                   # Emergency stop; prefer Ctrl-C for a drain
./launch.sh install                # Drained code update; provider keys excluded
```

Logs and the private Pod connection live in `data/deployment/`. The launcher
refuses occupied ports; it only stops children it previously started and whose
process start time still matches. It never selects an arbitrary free web port.

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
