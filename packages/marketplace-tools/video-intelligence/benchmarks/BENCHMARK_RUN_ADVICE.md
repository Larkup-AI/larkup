# Advice for the next video benchmark run

Purpose: finish the selected experiment with minimal operator time and no avoidable repeat charges. This is an incident checklist, not a replacement scheduler/runbook. Follow the [canonical benchmarking guide](../../../../../larkup-cloud/docs/benchmarking-guide.md), [benchmark README](README.md), and [controller contract](data/dashboard-api-v1.md). Read current code before using old scratchpad recovery commands; some older notes suggest resets that are unsafe for uncertain paid outcomes.

## 1. Establish exactly what is being run

- The historical “19 videos” experiment actually contains **8 source videos and 19 questions per variant**: 76 answers for four Larkup vision variants. Inspect the selected manifest; do not assume future manifests have those counts.
- Historical Larkup run: `run-9d45724237e86021e098`. Historical standalone-provider run: `run-917589638d8d062e6306`. Keep both intact.
- Distinguish **resume** (finish the same frozen experiment) from **new evaluation** (measure changed code/prompts/models). New evaluations need distinct run IDs; reusing compatible paid preparation is allowed only through the supported cache/import path with provenance.
- Record the exact code/file hashes, manifest, source/index hashes, model roles, indexing profile, subtitle policy, budgets and concurrency. The indexing brain, investigation planner, vision model and final answer wrapper can be different models; a Sonnet answer-only test is not a Sonnet-indexing run.

## 2. Preflight once before spending

1. Inspect dirty files and preserve parallel changes. Do not publish another agent's unfinished changes. Restart only verified owning processes after a code update, after draining/reconciling active requests; long-running controllers retain old Python code.
2. Verify every selected media file exists and matches its source hash. Reuse completed indexes only when source and relevant preparation settings match. Keep source/evidence/runtime artifacts and the original Pod until a checkpoint restore is verified.
3. Check account credit, selected model availability, provider scopes, disk space, SSH tunnels and runtime readiness. Use non-billable checks where available; do not repeatedly run paid health probes. Stop dispatch on authentication, quota or infrastructure failures.
4. Verify the actual listeners before starting services. Dashboard is normally `3100`; local controller `28892`, relay `28891`, forwarded Pod controller `28890`. Confirm current configuration rather than hardcoding ports or killing arbitrary listeners. A green GPU indicator alone does not prove indexing or re-watch works.
5. Keep the PC awake, connected, and the launcher/supervisor alive. The Pod depends on PC-held credentials and tunnels. Maintain the local controller if historical provider results must remain visible without a running GPU.
6. Establish a spending ceiling and remaining-work estimate from observed rental rate, progress and measured API usage. GPU, storage and Gateway costs are separate. Credits added in an earlier session are not proof of today's balance.

Useful existing launcher commands, from this directory:

```sh
./launch.sh status
./launch.sh account
./launch.sh backup
./launch.sh resume-run RUN_ID
```

Replace `RUN_ID` with the selected experiment. `status`/saved snapshots can be stale; compare their timestamps with the active controller. Do not run `new` to recover a stalled run: it creates another experiment and may cancel existing work.

## 3. Prove the relevant path, then start the full run once

- Read `data/focused-quality-repair-20261117/scores.json` and `rewatch-cache-verification.json`. Two former temporal/visual failures passed using saved indexes; the real re-watch reused two cached calls with a zero-new-call limit. This **does not** prove automatic planning, fresh indexing, every vision model or unattended completion.
- Run the existing focused regressions first. If a path changed, exercise one or two affected questions before the matrix. Do not repeatedly re-run the entire 19-question set while a known defect still fails.
- Verify that original transcript/OCR reaches temporal answers alongside summaries, evidence pages are consumed, and visual questions can inspect the requested source moment. An offline tool test without a runtime is not proof that live inspection is healthy.
- The optional local benchmark re-watch requires `BENCHMARK_ENABLE_REWATCH=1`, an explicit private Gateway key, a persistent `BENCHMARK_REWATCH_CACHE_DIR`, a model and a call cap (0–4). See `harness/quick-look-bridge.mjs`. It is not enabled automatically by the full harness. Select and verify the intended existing inspection path; never silently substitute this path mid-comparison. Its Gateway usage must be included in the cost export separately from final-answer usage.
- Freeze a general indexing goal covering speech, timestamps, OCR, visible attributes, transitions and source-wide coverage. Never insert expected options or question-specific answer hints. A changed indexing profile is a distinct experimental condition; retain the original indexes and label any reused/mixed preparation.
- Leave the scheduler's existing GPU/provider limits in place. Do not add a second controller or parallel Larkup worker sharing credentials/usage context to force faster progress.

## 4. Watch evidence of progress, not only answer counts

At regular intervals, inspect controller events, stage timestamps, runtime job handles, frame/clip counters, completed answers and spend. Record the last successful event and the active stage. Long-video indexing can progress while the answer count stays unchanged.

| Symptom | Next action |
| --- | --- |
| Dashboard appears paused/stale but worker progresses | Check selected run, controller reachability, poll errors and revision/timestamps. Restore the UI/relay connection; do not pause or restart healthy paid work just to refresh the display. |
| No stage movement | Inspect the saved remote handle, runtime job and logs; distinguish a long request from a dead tunnel/process. Do not blindly resubmit. |
| Quota, credit or authentication block | Repair that funding/provider scope, verify it, then use supported refresh/resume. Avoid automatic global resume loops and silent model changes. |
| Timeout / `REMOTE_OUTCOME_UNKNOWN` | Reconcile the original provider/runtime request and cost first. Preserve the submission fence. Never delete it, reset task state, switch routes/models or move Pods to bypass uncertainty. |
| Re-watch/inspection unavailable | Repair the configured inspection path. Treat execution failure as infrastructure, not a wrong answer. Cached re-watch requests with unknown outcomes require reconciliation before any new submission. |
| Old runs disappear | Inspect local controller/relay availability and the correct SQLite snapshot/run selection before assuming data loss. Do not initialize a replacement database. |
| GPU host unavailable | Follow existing checkpoint/capacity recovery. Verify restored DB, evidence and unfinished jobs before promotion. Preserve the original volume; do not create overlapping rentals. |

A safety block is sometimes the correct outcome. Do not promise zero blocks or disable paid-outcome guards to obtain “19/19”. Resume only after the cause is resolved, and change one thing at a time.

## 5. Finish and hand over

- Check **19 distinct completed question IDs per selected variant**, with no duplicate answers, pending inspections or unresolved paid attempts. “19/19 answered” does not mean “19/19 correct”. Report wrong answers, abstentions and infrastructure failures separately.
- Keep official reference scores unchanged. `video-mme-010-1` has a flagged reference/content disagreement; retain its official label and show any independent adjudication separately. Do not relabel it to improve the score.
- Export question-level JSON/CSV including source/index identity, evidence timestamps, model roles, setup/answer latency, all API operations, rental/storage and unknown charges. Count source preparation once, not once per question. Reused calls add no new spend.
- Take a consistent SQLite backup through the supported backup operation (not a bare copy of a live WAL database), verify the checkpoint/evidence, then drain and stop rental compute through the existing launcher. Stopped storage may remain billable; preserve paid artifacts.
- Leave the dashboard able to read saved results. Publish `blog.md` plus a results artifact under the canonical reporting layout; leave only a concise run ID, completed/blocked counts, final checkpoint location and any unresolved request handles for the next agent. Never expose secrets or private request caches.
