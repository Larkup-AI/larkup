# Larkup video benchmark: short strategic plan

November 17, 2026. **Build a neutral diagnostic pilot first; a new research gap is a hypothesis, not a confirmed claim.** Start with 3 videos, not 100. Do not design the benchmark to make Larkup win.

## 1. Verify novelty — before data collection

Compare [V-RAGBench](https://arxiv.org/abs/2606.13141), [AgentVidBench](https://arxiv.org/abs/2609.21386), [EG-VQA](https://arxiv.org/abs/2606.24797), [HERBench](https://arxiv.org/abs/2512.14870) and [SAVE](https://arxiv.org/abs/2611.15079). Retrieval/generation separation, temporal grounding and agent trajectories already exist.

**Candidate gap:** diagnose where evidence is lost across persistent indexing, retrieval, adaptive inspection and answering, under matched budgets and repeated queries. Deliver a one-page novelty matrix. If existing work covers this, extend it instead of claiming a new benchmark.

## 2. Freeze what we measure

| Aspect | Main measurement |
| --- | --- |
| Indexing/retrieval | Gold evidence retention, recall and timestamp localization |
| Temporal understanding | Event-instance order, changes and counts; mention versus occurrence |
| Visual/audio precision | Subject/time-bound attributes, OCR, speech and conflicting modalities |
| Source-wide coverage | Recall of an annotated fact inventory, not “all possible information” |
| Agentic verification | Evidence acquired and consumed; outcome quality rather than tool-call count |
| Grounding/abstention | Supported citations, answerability, false abstentions and unsupported claims |
| Efficiency/reliability | Cold indexing/warm query costs, latency, tokens, frames and infrastructure failures |

Evaluate observable evidence/actions, not private chain-of-thought or one prescribed tool sequence.

## 3. Build the 3-video development pilot

Reuse the indexed recipe, musical performance and long lecture in `capability_tests/demo/selection.json`. Add approximately **18–24 tasks total**, including distractors, unanswerable cases and multi-moment questions. These familiar videos stay development-only.

Reuse `capability_tests/`; start with cached evidence and one reader/Sonnet answer-only. This is not Sonnet-brain reindexing. Freeze cost/call limits before paid runs; preserve all previous results and unknown-outcome fences. No automatic GPU launch or full model matrix.

## 4. Create independently checked ground truth

For every task record: source/hash/rights, question, reference answer, capability/modality, answerability, supporting time ranges, event/fact IDs and scoring rubric. Allow multiple valid evidence sets. Use a second reviewer and adjudicate disagreements. Check question-only guessing and transcript-only shortcuts. Keep gold outside inference/indexing prompts and secure redistribution rights.

## 5. Evaluate controlled alternatives

Use **end-to-end, frozen-index, retrieval-only and oracle-evidence** conditions. Oracle clips versus verified textual facts help isolate perception/reasoning errors; they are diagnostic controls.

Compare static multimodal RAG, agentic/Larkup RAG with the same answer backbone, and native video inference where supported. Test inspection off/on. Keep indexing question-blind, charge adaptive inspection separately, match budgets and report unavailable black-box internals honestly.

## 6. Prove diagnostic value before expanding

Extend the existing scorers, using real annotations for evidence/fact metrics. Unit-test success is not accuracy; historical replay is not post-change evaluation. Save JSON/CSV, raw answers, traces, hashes, usage and unresolved charges. Validate LLM judges against humans.

**Go/no-go:** reproduce at least two independently verified failure stages, supported by oracle/intervention controls, and document ambiguous cases. Larkup need not win. If only final accuracy changes, refine the protocol first.

## 7. Expand gradually and protect the test set

After that gate: **10–15 videos / 80–120 tasks**; then consider **30–50 / 300–500** according to coverage, annotation budget and statistical precision. These are planning sizes, not publication requirements. Freeze development/held-out splits by source/series/uploader before tuning. Use video-level paired analysis and clustered uncertainty; cached repeats are not independent samples.

## 8. Prepare distinct research outputs

Publish a neutral benchmark name, dataset card, permitted media/references, annotations, frozen splits, scorer, generic adapters and reproducible baselines. A dataset paper needs demonstrated novelty. A separate Larkup method paper needs ablations and external comprehension plus agentic/retrieval validation; our dataset alone cannot establish general superiority. Two papers are possible, not guaranteed.

**Next deliverables:** novelty matrix → frozen task schema → 3-video annotation draft → scored pilot → go/no-go decision.

Use the existing [benchmarking guide](../../../../../larkup-cloud/docs/benchmarking-guide.md), [wrong-answer review](../../../../../larkup-cloud/benchmarks/multimodal/video-answer-review/blog.md), [capability-demo report](../../../../../larkup-cloud/benchmarks/multimodal/video-capability-testing/blog.md), and `capability_tests/README.md`. Do not create another inference service or duplicate the runbook.
