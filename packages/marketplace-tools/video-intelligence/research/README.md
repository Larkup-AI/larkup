# Video research and evaluation

This directory contains research infrastructure, not a result claiming superiority.
Use the shared Cloud [benchmarking runbook](../../../../../larkup-cloud/docs/benchmarking-guide.md)
for the iteration and publication workflow. The runner supports Python 3.9+ without
third-party dependencies. Product/runtime tests use the runtime's Python 3.12 environment.

The current architecture is in [pipeline.svg](pipeline.svg), with editable
[Graphviz source](pipeline.dot) and a vector [PDF](pipeline.pdf) for a paper.
The figure describes the current implementation. The dense candidate scanner
described below is a research extension and is deliberately absent from the figure. Regenerate with:

```sh
dot -Tsvg research/pipeline.dot -o research/pipeline.svg
dot -Tpdf research/pipeline.dot -o research/pipeline.pdf
python3 -m unittest discover -s research -p 'test_*.py'
```

## Prepare public labeled multiple-choice subsets

Acquire media and annotations from the dataset authors, respecting each dataset's
terms. Pin the annotation revision, split and media checksums. No dataset media,
API credentials, labels, or paid runs ship with this package.

| Dataset | Accepted annotation format | Scope |
|---|---|---|
| [Video-MME](https://github.com/MME-Benchmarks/Video-MME) | Nested `questions`, `videoID`, question `options` and letter `answer` | Public labeled MCQ; keep subtitle/no-subtitle conditions separate |
| [LongVideoBench](https://github.com/longvideobench/LongVideoBench) | `id`, `video_path`, `question`, `candidates`, zero-based `correct_choice` | Labeled validation; use the authors' subtitle alignment for subtitle runs |
| [MLVU](https://github.com/JUNJIE99/MLVU) | One MCQ task JSON: `video`, `question`, `candidates`, `answer` | MCQ only; preserve task labels and report task macro-average separately; six-option test cases are supported |
| [EgoSchema](https://github.com/egoschema/EgoSchema) | `q_uid`, `question`, `option 0` through `option 4`; separate public label map | Public labeled subset only; hidden test labels require official evaluation |

Export columnar downloads into the corresponding JSON row format first. Point
`--media-root` at the directory containing the referenced video files (for example
LongVideoBench's `videos/`). Label maps for EgoSchema are JSON objects mapping UID
to a zero-based choice. Free-response MLVU tasks need their official evaluator;
this runner deliberately does not turn them into MCQ accuracy.

```sh
python3 research/benchmark.py prepare --dataset longvideobench \
  --annotations /datasets/lvb/lvb_val.json --media-root /datasets/lvb/videos \
  --split validation --output /tmp/video-eval/cases.jsonl
```

Use `--task` for a specific MLVU task. Each case gets a SHA-256 source fingerprint;
run admission rechecks actual media before any adapter is invoked. Missing or
hidden labels, duplicate IDs and media outside the supplied root are rejected.
The format adapters have synthetic regression fixtures; full dataset downloads
have not been run or validated in this change.

## Service adapters and measurements

Provide a trusted executable adapter for the service under test. The runner starts
it once per question with JSON on stdin; stdout must contain exactly one JSON
response. It uses no shell. Set keys in the adapter's environment, never its
command line or protocol JSON. Provider stderr is not copied into reports.
Larkup, Gemini and Twelve Labs API adapters are **not bundled**: authenticated chat,
media upload, polling, cache policy and billing reconciliation must be implemented
and verified for each service before a live comparison. This is a tested comparison
harness, not an already executed competitor integration.

Input (answer labels and evaluator metadata are withheld):

```json
{"case":{"id":"...","question":"...","options":["...","..."],"media":{"path":"/absolute/source.mp4","sha256":"..."}},"protocol":{"system":"...","revision":"...","models":["..."],"cacheMode":"cold","subtitles":false,"hardware":"..."}}
```

Successful response:

```json
{"status":"ok","prediction":"B","indexCostUsd":0.02,"queryCostUsd":0.001,"indexSeconds":4.2,"querySeconds":1.3,"ttfbSeconds":0.4,"framesInspected":18,"modelCalls":2,"peakRssBytes":100000000}
```

The numbers above illustrate the schema, not measured service results. Prediction
must be an exact option, uppercase option letter or zero-based integer. A successful
but malformed prediction is incorrect. Auth, quota, upload, indexing and provider
failures must return `status: "error"` or a nonzero exit; the runner aborts rather
than scoring infrastructure as wrong answers. Missing metrics remain blank/unknown.
Charge uploads, model calls, retries, GPU startup, storage and preprocessing to the
cost ledger; never infer USD from tokens without a pinned pricing snapshot.

Create a protocol JSON with the required fields shown above plus dataset revision,
source preparation, pricing provenance, index reuse, frame/context caps and seeds.
For a warm run the adapter must reuse the same source index and report only newly
incurred index cost. For cold runs clear answer memory and source caches according
to the declared protocol. Do not pool cold and warm measurements.

```sh
BENCHMARK_QUESTION_IDS='longvideobench:validation:multiple-choice:<id>' \
python3 research/benchmark.py run --cases /tmp/video-eval/cases.jsonl \
  --protocol /tmp/video-eval/protocol.json \
  --output /tmp/benchmarks/video/understanding \
  --adapter python3 /path/to/verified_service_adapter.py
```

`--adapter` must be last. The runner measures total adapter wall time independently
of provider-reported latency and writes `results.csv`, `blog.md` and
`data/protocol.json` only after all selected cases complete. Keep the case manifest
and minimum reproducibility state under `data/` when publishing; do not publish
local absolute paths or private sources. All systems must see the same selected
questions, media fingerprints and subtitle policy. Official scores still require
the dataset's evaluation protocol. Do not collapse MLVU tasks into an unlabeled
micro-average or infer rare-event recall from multiple-choice accuracy.

## Isolated storage measurement

Run each strategy in a fresh runtime Python process:

```sh
runtime/.venv/bin/python research/measure_frames.py --strategy raw
runtime/.venv/bin/python research/measure_frames.py --strategy spooled
```

One local macOS run used 100 clips, four 640×360 frames per clip, random seed 42,
and identical full-pixel checksums. The raw strategy peaked at 318,324,736 bytes
RSS and took 0.193 s; temporary lossless arrays peaked at 64,503,808 bytes and took
0.229 s, using 276,531,200 temporary bytes. This is approximately 80% less process
peak RSS in this synthetic storage test, with extra disk I/O. It excludes source
decode, scout, OCR, models, uploads and chat. It does not establish end-to-end
latency, performance on an eight-hour source, or a competitor advantage. The
script includes an extra active clip allocation and process baseline in both cases.
NumPy arrays avoid redundant compression, preserve every pixel, and close file
handles before returning read-only frames so Windows cleanup is possible.

## Current capability audit

- Existing: initial-goal planning, sparse scout, optional scene detection,
  motion-biased retention, parallel transcription/vision/embedding work,
  timestamped notes, source inventory, revision-scoped answer memory and bounded
  conversational reinspection. Complete speech requests already use chronological
  source paging; maintain original language and artifacts rather than a giant prompt.
- This change: priority ranges no longer add unbounded extra model-read clips.
  Completed clip pixels move to a job-scoped lossless store and load lazily for
  model requests. Raw retention is limited to the active clip instead of all clips.
  Disk consumption still scales with retained frames. Scout frames and concurrent
  request payloads consume additional memory; this is not constant whole-job RAM.
- Important limitation: a sparse scout and later sparse decode can both miss a
  short event. Motion scores on already sampled frames do not solve this. Neither
  a successful clip-count coverage gate nor an observed tracking duration proves
  that every event was seen. The result contract now makes that limitation explicit.
- Embeddings are a configured retrieval invariant, not currently fully decided
  by the planner. Preserve it until an ablation measures retrieval degradation.
- Live camera streaming is not provided by this offline file/job pipeline. Chat
  reinspection seeks a bounded range but transfer, cold start and model latency
  remain part of user-perceived response time. No live latency improvement was
  measured in this change.

For the paper's rare-event claim, implement a general typed candidate directive:
query-derived motion/color/region constraints, a dense low-resolution temporal
scan, bounded candidate windows, then high-resolution temporal vision verification.
A red region is a candidate, never proof of a person or a crossing. Keep an
independent uniform audit stream, record scanned cadence and uncovered gaps, and
measure event recall and false positives against annotated event intervals. Events
shorter than the scan interval may still be missed; adversarial unknown events
cannot be guaranteed by a finite skim. Frame decoding also has real CPU and I/O cost.

Evaluate 0.2/1/5-second events at randomized offsets in long static footage,
camera motion, lighting changes, color distractors, small distant subjects,
repeated scenes and silent clips. Hold these scenarios out from development.
Separately evaluate native-language transcript coverage (WER/CER plus segment
coverage), lecture notes, citation entailment and output artifacts. These are
additional capability tests, not official benchmark leaderboard metrics.

Before a superiority claim, run matched-backbone and matched-accuracy cost/latency
comparisons; report the accuracy/cost/latency frontier, per-task scores and uncertainty.
Ablate scene cuts, motion retention, the proposed candidate scan, embeddings,
continuity notes and reinspection separately. Include cold indexing, warm-query
p50/p95/TTFB, complete USD cost, frame/model-call counts and peak resources. A new
agent skill alone cannot fix missing temporal observations or establish novelty.
