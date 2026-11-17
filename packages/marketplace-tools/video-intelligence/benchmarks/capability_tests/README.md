# Video capability tests and three-video demo

These are research diagnostics around the existing canonical video tool, not a
second inference runtime. Follow the existing repository benchmarking guide;
this document defines measurement semantics and command interfaces only.
No GPU is started, media downloaded, or index rebuilt by these commands.

Run from `packages/marketplace-tools/video-intelligence/benchmarks`:

```sh
# Offline contract tests, with machine-readable output.
python3 -m capability_tests.unit
# Three already indexed videos: recipe, musical performance, long lecture.
python3 -m capability_tests.demo --mode replay
# Current canonical retrieval against the saved index, without model calls.
python3 -m capability_tests.demo --mode integration --suite full_video_info
# Optional paid Sonnet FINAL ANSWER only on the existing Gemini-reader indexes.
python3 -m capability_tests.demo --mode live --max-paid-calls 3
# Finite automatic loop on source edits; no autonomous code/gold changes.
python3 -m capability_tests.watch --mode integration --max-rounds 3 --timeout-seconds 600
```

Replay defaults to frozen historic outputs. It cannot measure a new code change.
Integration runs the actual imported canonical bridge, but cannot measure answer
accuracy without an answer model. Live is explicitly an **answer-only ablation**:
it does not reindex with Sonnet or substitute Sonnet for every internal brain
role. It uses the existing private benchmark.env Gateway key. No credentials
are placed in JSON artifacts. Live inspection requires the existing canonical
runtime/harness; this demo does not pretend an offline trace is a live GPU run.
Its offline runtime endpoint intentionally refuses inspection; unresolved tool
execution blocks the case instead of becoming an incorrect answer.

`demo/selection.json` selects 1-3 sources from the existing immutable database.
The default cases were already examined during debugging: this is a development
demo, **not held-out research evidence**. Missing files stop preparation; they
never cause paid reindexing. For other cases create a separate frozen manifest:

```sh
python3 -m capability_tests prepare-demo --database PATH --run RUN_ID \
  --case temporal_understanding:QUESTION_ID --variant-regex REGEX --out MANIFEST.json
python3 -m capability_tests run --manifest MANIFEST.json --out OUTPUT_DIR --mode replay
```

## Separate measurements

| Module | Actual measurement | Reference needed |
| --- | --- | --- |
| evidence_retrieval.py | recall@k, precision@k, reciprocal rank | Independently relevant evidence IDs |
| temporal_understanding.py | event recall, exact order, pairwise order | Unique ordered event-instance IDs; mentions/actions are distinct |
| visual_precision.py | exact annotated attribute accuracy | Subject + moment + attribute ground truth |
| full_video_info.py | annotated fact precision/recall/F1 | Human checked source-fact inventory; not "all possible information" |
| agentic_live_analysis.py | submitted -> completed -> requeried consumption | Recorded job trace, not merely an action name |
| abstention.py | coverage, selective accuracy, false abstentions | Correctness/answerability adjudication |
| answer_formatting.py | JSON fields, choice letters, evidence time bounds | Declared output contract |

The three-video MCQ demo reports **answer-accuracy proxies** per assigned category.
It does not fabricate evidence relevance, source-fact recall, pixel precision or
live-analysis success from those three answers. Unannotated metrics remain
unavailable. The synthetic examples show the scoring interface; they are not
video-model accuracy results:

```sh
python3 -m capability_tests score-capabilities \
  --cases capability_tests/demo/annotations.example.json \
  --predictions capability_tests/demo/predictions.example.json \
  --out data/capability-tests/annotated-scores.json
```

Each capability module can also be run independently, for example:

```sh
python3 -m capability_tests.temporal_understanding \
  --reference capability_tests/demo/temporal-reference.example.json \
  --prediction capability_tests/demo/temporal-prediction.example.json \
  --out data/capability-tests/temporal-scores.json
```

Reference IDs must be independently mapped to source-grounded output; allowing
an answer model to self-label the expected IDs is not valid measurement. Freeze
annotations before inference. Use separate videos for development and held-out
testing, and preserve failed runs instead of selecting only successful ones.

## Output and budget contract

Default outputs are under `data/capability-tests/`:

- `demo/manifest.json`: immutable source/question/index references and historical
  labels; only public question fields enter model requests.
- `demo/results/scores.json`, `results.csv`, `progress.json`: current report.
- `demo/results/runs/<unique-run-id>.json`: each completed run, including failures.
- `contracts/scores.json`: synthetic unit-test results, explicitly not accuracy.
- `paid-cache/`: shared exact-request cache and durable pre-submission fences.

Canonical tool responses are also cached by the index, question, directive and canonical source hashes, keeping generated evidence IDs/timing stable for exact paid-request reuse. Exact cached requests are reused even across output directories. A single lock
prevents concurrent demo runners from duplicating paid calls. Unknown submissions
are never retried automatically, and completed raw answers/usage are saved before
scoring. Model, prompt/schema, input/index identity define a paid request. Model
or prompt changes may legitimately create a new paid request. The default maximum
is three new requests per run; the watcher applies its cap across all rounds.
The 60,000-character input and 512 output-token bounds prevent unlimited input;
**these are not a guaranteed USD spending cap**. Oversized context is blocked,
not silently truncated and presented as full coverage. Infrastructure/budget
failures stop subsequent live/integration cases and are excluded from accuracy.

Reports include manifest digest, source-file hashes (including dirty source),
Git revision, model/profile provenance, raw responses, per-category denominators,
Wilson intervals and explicit unavailable metrics. Intervals over answers are
only descriptive because repeated questions/models on one video are correlated.
For a paper use enough independently held-out videos, video-clustered intervals,
matched protocols and paired comparisons. Three demo questions do not establish
high accuracy. The default target is 0.85 with at least 30 scored cases; both are
configurable. `--enforce-gate` exits nonzero if unmet/insufficient. Setting a high
target does not make the tool improve itself: source changes remain deliberate,
reviewed, and tested, with no expected-answer injection or autonomous paid loop.

MCQ correctness reuses `harness.scoring.parse_option`, and the canonical bridge,
final-answer prompt and schema are imported rather than reimplemented here.
Historic correctness is independently rechecked and any mismatch is blocked,
never silently migrated to a new historical score.

For formal publication, commit the exact evaluated source (including any parallel changes) and archive the environment/lockfile. Source hashes expose dirty differences but do not replace a source archive or reproducible environment. The live demo default output budget matches the validated 512-token smoke request.
