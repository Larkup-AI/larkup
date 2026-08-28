# How a video gets indexed and answered

Short version of the pipeline in `run_pipeline` (`app/services/pipeline.py`) and the chat tools in `apps/web/app/api/chat/tools.ts`. See the top-level `README.md` for setup/deployment; this is just "what happens, in order."

## Portable Python package

This directory is a standalone `uv` package. It intentionally keeps the
runtime import path as `app` so the Docker, RunPod, and cloud-worker entry
points remain compatible, but runtime code uses absolute `app.*` imports only.

```bash
cd runtime
uv sync --extra cpu --extra test
uv run larkup-video-runtime
uv run larkup-video-runtime-worker job_123
uv run --extra cpu --extra test python -m unittest discover -s tests -p 'test_*.py'
```

Use the `cpu` extra for a portable local worker and the `gpu` extra in a
CUDA-compatible environment. Docker retains its target-specific dependency
layers, while `pyproject.toml` and `uv.lock` are the portable source of truth.

## Indexing (upload -> evidence)

1. **Probe the file** for duration, fps, resolution, audio presence. *(ffprobe, PyAV fallback)*
2. **Transcribe speech** with word-level timestamps, if audio is present. *(`TranscriptionService`: `WhisperProvider` local, or `DeepgramProvider` hosted)*
3. **Plan clip boundaries** across the video (or just the requested important ranges). *(`SceneDetector`: PySceneDetect scene-cut detection, fixed-window fallback)*
4. **Decode and sample frames** at the mode's cadence, running object detection and OCR on each sampled frame, and building anonymous cross-frame tracks. *(`VisualOperators`: YOLOX/ONNX Runtime for detection, PaddleOCR/RapidOCR for text)*
5. **Keep a motion-biased spread of frames per clip** (not every decoded frame) for captioning/embedding. *(`MotionSampler`)*
6. **Caption each clip** in natural language. *(`SemanticVisionService`, via the Vercel AI Gateway VLM)*
7. **Embed each clip** for cross-modal search -- optional, skipped unless configured. *(`VideoEmbeddingProvider`: DashScope, RunPod, or Hugging Face dedicated `Qwen3-VL-Embedding-8B` deployment)*
8. **Assemble the evidence bundle** -- transcript, OCR, detections, tracks, captions, embeddings, and an answering guide -- and return it to the app, which stores it as the asset's active evidence.

## Retrieval (chat question -> answer)

1. **Find the asset.** *(`searchKnowledgeBase` -- RAG lookup over the user's knowledge base returns the `mediaAssetId`)*
2. **Search the active evidence hierarchy** for the question -- chapters -> scenes -> events/states -> active evidence -- combined with hybrid semantic (vector) + lexical retrieval, plus any visual clip-embedding candidates. *(`queryVideoKnowledge` tool)*
3. **Verify the evidence actually supports the claim** being made, not just that it's topically related. *(`verifyMediaEvidence` -> `claimVerification.status`: `ok` / `insufficient` / `needs_inspection`)*
4. **If evidence is thin:** widen the candidate range to the nearest real structural boundary (scene/chapter), or browse the hierarchy for a better one. *(`expand_range` tool; `planVideoInvestigation` tool)*
5. **If verification calls for it:** request one bounded, authorized deep re-analysis of that specific range (max 30s of source) for fresh OCR/detection/tracks, then repeat step 2 with the same sub-question. *(`inspectVideoKnowledge` / "watch_original" tool -- dispatches to the configured GPU provider, Modal or RunPod)*
6. **Read the full literal record** in a narrowed range when the question needs everything there, not a ranked search. *(`read_evidence` tool)*
7. **For cross-timestamp computation** (counts, aggregates, comparisons across many evidence points): *(Python sandbox tool -- pandas/numpy over the retrieved evidence)*

## When nothing indexed answers the question

The agent doesn't guess. It's instructed to exhaust the loop above first -- search, verify, expand/inspect, search again -- and only after that say plainly that the answer isn't in the indexed evidence, rather than inferring beyond what's returned as active evidence or promoting a local observation into a broader conclusion.
