# Video understanding engineering smoke

The isolated canonical video benchmark passed its engineering smoke on 14 November
2026. **The comparative pilot was prepared but not started, at the user's request.**
There is no continue/stop accuracy conclusion and no claim of superiority.

The generated CC0 source is eight seconds long, changes from red to blue, and
speaks a number. Two deterministic development questions test visual and speech
handling. All five final arms answered both correctly. These questions verify
wiring; 100% here does not estimate research accuracy. The native arms retained
full video/audio. Qwen used timestamped frames and the supplied transcript.

| Configuration | Correct / completed | Planned |
|---|---:|---:|
| Gemini 3.8 Flash native via Gateway | 2 / 2 | 2 |
| Qwen 3.6 Plus frames via Gateway | 2 / 2 | 2 |
| TwelveLabs Pegasus 1.5 native Analyze | 2 / 2 | 2 |
| Canonical tool, Gateway brain/vision | 2 / 2 | 2 |
| Same answer model, simple retrieval | 2 / 2 | 2 |

The initial direct DeepSeek brain account returned credit exhaustion. That
profile and its failed attempts remain in the private database. Before any
pilot answers, a distinct named profile selected Gateway Gemini 3.6 Flash for
brain and vision, Deepgram Nova 3 for transcription, and Gateway Gemini 3.8 Flash
for the fixed answer wrapper. Only the changed tool/ablation smoke paths were
rerun; the six passing native answers were reused. Earlier direct authentication,
model-availability, timeout and TwelveLabs task-handle preflights are development
history, not wrong answers. TwelveLabs saved tasks were reconciled without paid
resubmission.

`results.csv` contains the ten passing final smoke answers, their route/model,
response/queue timing, cost observations, evidence and coverage. `data/indexes.csv`
reports preparation/indexing once per source artifact. `data/usage.csv` preserves
remote smoke usage receipts including failed development attempts. Some provider
charges remain unknown; known cash is a partial total and cannot be treated as
complete spend. Actual cash and estimates must not be added together. Rental
observations are kept privately in `data/deployment/rental-observations.jsonl`.
Native services have no persistent index stage; non-streaming TTFT is unobserved.

The frozen pilot contains eight complete verified official sources and 19
available official questions, including two videos longer than 40 minutes. A
six-question fixed-backbone retrieval ablation is preregistered. Full official
subtitles are aligned to the actual excerpt clock; where unavailable, Qwen's
separately declared canonical ASR supplies its text input. This is an exploratory
subset/input condition, not an official leaderboard score. The gate requires
complete core coverage and, for a positive decision, independent grounding review.
No larger run starts automatically after the pilot decision.

At the user's stop instruction, the SQLite backup passed integrity checks,
evidence/runtime artifacts were saved off-Pod, and the GPU was stopped. The
launcher is the next explicit start point. Tests cover scheduler concurrency,
quota exhaustion and cooldown, exact-model routing, immutable hot reload,
reconciliation/recovery, pause/resume/cancel, scoring, credential boundaries and
readonly backup access. The canonical package's 117 tests, type check and build
also passed. No production runtime or Cloud deployment was changed.


## Later partial pilot checkpoint

A subsequent development pilot started after the initial smoke handoff and was
paused before a complete comparison. Two Qwen answers completed on one roughly
52-minute LongVideoBench source: one correct, one incorrect. These are the only
completed pilot answers at this checkpoint; they do not estimate comparative
accuracy. Some input preparations completed for other sources, while native
transport/capability failures and unknown remote outcomes blocked coverage.

`data/pilot-partial-results.csv` records those measured answers;
`data/pilot-partial-summary.json` preserves denominators and partial cost. The
checkpoint gate is **inconclusive**. Known cash is partial, unknown charges are
retained, and provider estimates must not be added to observed cash. The paused
run and its source/attempt history remain available in the operator dashboard.
No publication expansion or paid restart was performed while adding the UI.
