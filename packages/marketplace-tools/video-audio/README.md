# Video Intelligence

> Evidence-first, attention-driven video reasoning for Larkup.

## What this tool is

This is not a video-to-text RAG indexer. It gives the agent a source-backed
timeline it can investigate: speech, OCR, visual observations, state changes,
and the source ranges that support them. Generated summaries are navigation
projections, never the final authority for a detailed claim.

The original video is retained. When the indexed evidence is insufficient, the
agent can rewind only a small, policy-bounded range and persist the new
evidence as a revision before answering.

## Attention-driven pipeline

1. **Keep the source** — raw media remains available for later rewinds.
2. **Cheap attention pass** — coverage anchors, scene changes, and a
   low-resolution activity scan identify moments worth inspecting.
3. **Focused observation** — vision analysis runs on bounded chronological
   frame bundles; audio transcription and OCR carry independent timestamps.
4. **Evidence graph** — Larkup Core stores immutable evidence, observations,
   state transitions, conflicts, revisions, and searchable projections.
5. **Investigate on demand** — chat retrieves evidence first; a count,
   comparison, code/OCR, or visual fact can trigger a bounded source rewind.

## How chat investigates a question

Every substantive video question runs a fresh investigation. The agent starts
with the active temporal tree—**chapters → scenes → events/states → source
evidence**—and uses vector search as an additional routing signal, not as a
substitute for proof. Simple questions normally resolve from the matching
chapter/scene and its evidence. Complex questions receive candidate time ranges
for targeted tracking, counting, OCR, comparison, or visual verification.

The temporal tree is cached briefly per active knowledge revision and normalized
question. This makes repeated follow-ups fast, while a new revision immediately
uses a different cache key. Evidence retrieval still runs for every question so
the answer can benefit from new source inspections or refinements.

This avoids paying vision-model cost for every source frame while remaining
honest about gaps. Adaptive samples are not continuous observation: when an
answer needs stronger proof, the agent must inspect the original range or say
that the evidence is insufficient.

## Capabilities

- Multilingual timestamped transcription
- Full source-caption ingestion (for example, YouTube manual or automatic captions) before any paid audio transcription
- Activity- and scene-aware visual attention
- Structured visual observations and visible-text OCR
- Timeline and state-change evidence with confidence and conflict handling
- Bounded source rewind for verification, high-resolution OCR, comparison,
  counting, and tracking
- Anonymous, bounded person tracks inside an inspected range
- Local file, direct URL, YouTube video, and playlist import

The tool does **not** identify people, perform facial recognition, or match a
person between different videos. Track IDs are anonymous and valid only within
the inspected source bundle.

## How answers stay grounded

For a complex question such as “what changed before the object disappeared?”,
the agent should retrieve the relevant timeline evidence and reason over its
order. It must cite the supporting time ranges and carry uncertainty forward.
If the visual anchors do not establish the answer, it requests a bounded rewind
instead of searching captions or inventing a conclusion.

Frame seeking is labelled estimated unless a source operation establishes more
precise timing. Do not treat a broad scene window or an LLM summary as proof.

## Requirements

- **ffmpeg** is bundled on supported platforms; a system installation is only
  a fallback.
- The YouTube downloader is prepared on first YouTube use. Local files and
  direct URLs do not need it.
- Select an audio provider in Marketplace Tool Settings. It is independent
  from the chat/vision provider and never silently falls back to OpenAI.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| Baseline coverage interval | 10s | Maximum gap for cheap anchors. Activity and scene signals add denser evidence; it is not a fixed sampling rate. |
| Maximum retained frames | 600 | Hard evidence budget; use a bounded refinement for work beyond it. |
| Knowledge chunk duration | 300s | Work unit for long, resumable videos. |
| Inspection spend budget | $0.50 | Per-query ceiling for source rewind. Larger requests need approval. |
| Video Knowledge Engine | Enabled | Enables evidence revisions, verification, and source-grounded chat citations. |

## Maintaining this package

Keep media primitives in this package and product knowledge/reasoning in
`@larkup/core`. The web worker supplies model credentials and persists only
schema-validated output. Any new detector must expose source timestamps,
confidence, limitations, and a bounded cost model; it must not add a hidden
whole-video scan or treat model prose as durable evidence.
