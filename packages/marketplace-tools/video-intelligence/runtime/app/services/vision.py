"""Captions video clips through a hosted vision-language model.

Reached over the Vercel AI Gateway's OpenAI-compatible chat/completions
endpoint: frames are sent as image_url content parts (a presigned S3 URL
when a bucket is configured, a base64 data URI otherwise), and the model
returns per-clip captions. `SemanticVisionService` is the entry point the
pipeline calls; `GatewayVisionClient` is its HTTP implementation detail.
"""

from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Callable

import cv2
import numpy as np
import requests

from app.services.storage import FrameUploader, get_frame_uploader

DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1"
# Verify these ids against the live Vercel AI Gateway model catalog before
# deploying -- gateway model slugs are not guaranteed stable across providers.
# The bulk model runs per-clip during indexing (cheap, high-volume); the
# reasoning model is reserved for watch_original's dense final-verification
# pass over a bounded range, where accuracy matters more than throughput.
DEFAULT_MODEL = "google/gemini-3.6-flash"
# Direct verification uses the same gateway-available multimodal reader as
# indexing by default. Deployments can opt into a separately configured
# reasoning model, but an unavailable optional model must never turn a video
# answer into an empty result.
DEFAULT_REASONING_MODEL = DEFAULT_MODEL
# A multimodal request's latency tracks the number of images in it far more
# than anything else, so one deadline for every request either cuts off the
# large ones or lets the small ones hang. These bound it per image instead.
# Cutting a request off early is the expensive outcome: the retry re-sends the
# same frames, and a batch that keeps timing out degrades into one request per
# clip, which is what makes an index crawl.
REQUEST_TIMEOUT_BASE_SECS = 60
REQUEST_TIMEOUT_PER_IMAGE_SECS = 8
REQUEST_TIMEOUT_CEILING_SECS = 240


# Exact visual facts such as a value, label, or small icon are often a small
# part of a wide frame. Keep enough source detail for those facts while the
# bounded clip planner, batching, and JPEG compression keep the request size
# predictable.
MAX_VISION_FRAME_WIDTH = 960


def _timeout_for_images(image_count: int) -> int:
    return min(
        REQUEST_TIMEOUT_CEILING_SECS,
        REQUEST_TIMEOUT_BASE_SECS + REQUEST_TIMEOUT_PER_IMAGE_SECS * max(1, image_count),
    )

_SCHEMA = {
    "type": "object",
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "clipIndex": {"type": "integer"},
                    "summary": {"type": "string", "maxLength": 1200},
                    "entities": {
                        "type": "array",
                        "maxItems": 12,
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "maxLength": 120},
                                "what": {"type": "string", "maxLength": 160},
                                "howIdentified": {"type": "string", "maxLength": 200},
                            },
                            "required": ["name", "what", "howIdentified"],
                        },
                    },
                    "visibleText": {
                        "type": "array",
                        "maxItems": 12,
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "maxLength": 200},
                                "means": {"type": "string", "maxLength": 200},
                            },
                            "required": ["text", "means"],
                        },
                    },
                    "events": {
                        "type": "array",
                        "maxItems": 12,
                        "items": {
                            "type": "object",
                            "properties": {
                                "what": {"type": "string", "maxLength": 240},
                                "basis": {"type": "string", "enum": ["read", "inferred"]},
                            },
                            "required": ["what", "basis"],
                        },
                    },
                    "supportedClaims": {
                        "type": "array",
                        "maxItems": 3,
                        "items": {"type": "string", "maxLength": 220},
                    },
                    "sourceQuestions": {
                        "type": "array",
                        "maxItems": 12,
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "maxLength": 500},
                                "answer": {"type": "string", "maxLength": 500},
                                "basis": {
                                    "type": "string",
                                    "enum": ["spoken", "visible"],
                                },
                            },
                            "required": ["text", "answer", "basis"],
                        },
                    },
                    "claimQuestion": {"type": "string", "maxLength": 2000},
                    "claimVerdict": {
                        "type": "string",
                        "enum": ["direct", "partial", "not-established"],
                    },
                    "claimAnswer": {"type": "string", "maxLength": 360},
                    "claimBindings": {
                        "type": "array",
                        "maxItems": 8,
                        "items": {
                            "type": "object",
                            "properties": {
                                "subject": {"type": "string", "maxLength": 120},
                                "relation": {"type": "string", "maxLength": 80},
                                "value": {"type": "string", "maxLength": 120},
                            },
                            "required": ["subject", "relation", "value"],
                        },
                    },
                    "uncertainty": {"type": "string", "maxLength": 220},
                },
                "required": [
                    "clipIndex",
                    "summary",
                    "claimQuestion",
                    "claimVerdict",
                    "claimAnswer",
                    "claimBindings",
                ],
            },
        }
    },
    "required": ["clips"],
}


@dataclass(frozen=True)
class ClipCaptionRequest:
    clip_id: str
    start_ms: int
    end_ms: int
    frames: list[tuple[int, np.ndarray]]


@dataclass(frozen=True)
class SemanticObservation:
    start_ms: int
    end_ms: int
    text: str
    confidence: float


class GatewayRateLimiter:
    """Thread-safe sliding-window limiter shared by every gateway call in a job."""

    def __init__(self, requests_per_minute: int):
        self.limit = max(1, requests_per_minute)
        self._lock = threading.Lock()
        self._window: deque[float] = deque()

    def acquire(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                while self._window and self._window[0] <= now - 60:
                    self._window.popleft()
                if len(self._window) < self.limit:
                    self._window.append(now)
                    return
                wait_secs = 60 - (now - self._window[0])
            time.sleep(max(0.05, wait_secs))


def _frame_to_url(frame: np.ndarray, uploader: FrameUploader | None, prefix: str) -> str:
    max_width = max(320, int(os.getenv("LARKUP_VIDEO_MAX_VISION_FRAME_WIDTH", MAX_VISION_FRAME_WIDTH)))
    height, width = frame.shape[:2]
    # Many broadcast and screen-recording sources are low resolution.  Their
    # labels are still useful evidence, but only when the VLM receives enough
    # pixels to read them.  This is a general text/UI readability pass, not a
    # content-specific crop or detector.
    if width != max_width:
        frame = cv2.resize(frame, (max_width, max(1, round(height * max_width / width))))
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        raise ValueError("could not encode frame as JPEG")
    payload = buffer.tobytes()
    if uploader:
        return uploader.upload(payload, f"{prefix}/{uuid.uuid4().hex}.jpg", "image/jpeg")
    return "data:image/jpeg;base64," + base64.b64encode(payload).decode("ascii")


def _frame_to_inline_data(frame: np.ndarray) -> dict[str, str]:
    """Encode one bounded frame for APIs that accept Gemini-style inline media."""
    max_width = max(320, int(os.getenv("LARKUP_VIDEO_MAX_VISION_FRAME_WIDTH", MAX_VISION_FRAME_WIDTH)))
    height, width = frame.shape[:2]
    if width != max_width:
        frame = cv2.resize(frame, (max_width, max(1, round(height * max_width / width))))
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        raise ValueError("could not encode frame as JPEG")
    return {"mime_type": "image/jpeg", "data": base64.b64encode(buffer.tobytes()).decode("ascii")}


def _precision_frames(
    frames: list[tuple[int, np.ndarray]],
    max_source_frames: int = 4,
) -> list[tuple[int, np.ndarray]]:
    """Keep a bounded chronology spanning the whole clip.

    A precision pass sends fewer frames than the frame budget so each one can
    be sent at higher fidelity. Both ends of the clip are always kept, so a
    before/after relationship inside the clip survives the reduction.
    """
    if not frames:
        return []
    source_count = min(max_source_frames, len(frames))
    indices = sorted(
        {
            round(index * (len(frames) - 1) / max(1, source_count - 1))
            for index in range(source_count)
        }
    )
    return [frames[index] for index in indices]


# How much detail a note carries, per indexing mode. A note is what the whole
# index is made of, so this -- not the frame count -- is what "coverage" means
# to whoever reads the answer later.
_DEPTH = {
    "fast": (
        "one or two sentences per clip, carrying only what the clip establishes",
        3,
    ),
    "balanced": (
        "a short paragraph per clip: what happens, who or what is involved, and "
        "any informative text on screen",
        6,
    ),
    "thorough": (
        "a full paragraph per clip: what happens and how it develops, every "
        "participant and how each was identified, every informative piece of "
        "on-screen text read exactly, and each change of state",
        12,
    ),
}


def _build_prompt(
    batch: list[ClipCaptionRequest],
    goal: str,
    questions: list[str],
    spoken_context: dict[str, str] | None = None,
    known_entities: list[str] | None = None,
    depth: str = "balanced",
) -> str:
    detail, item_limit = _DEPTH.get(depth, _DEPTH["balanced"])
    prompt = (
        "You are watching a video and taking notes, the way a person would if they had to answer "
        "questions about it later from their notes alone. Each group below is the chronological "
        "frames of one clip, in the order the clips occur.\n"
        "\n"
        "Write notes that carry the MEANING of what is happening, not a description of the pixels. "
        "A note saying what something IS ('the displayed total has reached 240') is worth ten notes "
        "saying something is visible ('a number is on screen'). Never write a note that only lists "
        "what objects are in frame.\n"
        "\n"
        "How to take these notes:\n"
        "- Say what is happening and what changes. A value that differs between two frames is an "
        "event; say so, and say what it changed from and to.\n"
        "- Read every piece of on-screen text that carries information: names, titles, labels, "
        "captions, times, totals, readouts, rankings. Transcribe them exactly, and say what each is "
        "attached to -- which column a value sits under, which person a caption sits beneath, which "
        "item a label points at. Read positions off the pixels; a script's reading direction never "
        "moves something from one side of the frame to the other.\n"
        "- On-screen text and synchronized speech are how people and things get identified, and you "
        "should use them that way. If a caption reads a name beneath someone, that is who they are: "
        "record the name and record what established it. Say someone is unidentified only when the "
        "source genuinely never names them -- not merely because you are being cautious.\n"
        "- Name a person only where this clip shows a readable name label, synchronized speech binds "
        "the name to them, or the supplied evidence explicitly preserves that identity across the cut.\n"
        "- Note appearance where it distinguishes participants: colours of clothing or livery, and "
        "which group wears what. That is often how a viewer tells two groups apart.\n"
        "- Keep an individual's name distinct from a collective one. A group, organization, role, "
        "or place is never a person's name. When only collective labels are visible, say so plainly "
        "instead of substituting one for a person.\n"
        "- Do not transfer a name, number, or caption from one person to another, and do not let a "
        "later close-up or caption retroactively identify whoever acted in an earlier wide shot "
        "unless the frames visibly track the same person across the transition.\n"
        "- Frames are samples, so a clip can show a moment without showing its result. Write what "
        "you saw, and mark anything you are concluding rather than reading with basis 'inferred'.\n"
        "- Never add background knowledge about the subject, place, people, or occasion, and never "
        "invent a name, number, or value you did not see or hear.\n"
        "- Record every question actually spoken or visibly written in this clip in sourceQuestions, "
        "using the source wording and language. Include its source-supported answer when this clip "
        "contains one, otherwise use an empty answer. The supplied goal and Questions to resolve are "
        "instructions to you, never sourceQuestions. Repeated generic headers are separate questions "
        "when their spoken or visible prompt/context differs.\n"
        "- Write the note and event prose in the dominant language of the synchronized speech. If "
        "there is no speech, use the language of the supplied goal/questions. Preserve names and "
        "on-screen text exactly as heard or read. Do not translate a source-language identity into "
        "a generic English description.\n"
        "\n"
        f"Detail level: {detail}. Give at most {item_limit} entities, {item_limit} visibleText "
        f"items, and {item_limit} events per clip -- the most informative ones.\n"
        "\n"
        "Alongside the notes, answer the supplied question for each clip. Set claimVerdict to "
        "'direct' only when this clip itself shows or says the answer, 'partial' when it points "
        "toward it, and 'not-established' when it does not bear on it. Fill claimAnswer for a "
        "direct verdict only. Set claimQuestion to the supplied question exactly. In claimBindings "
        "record each subject-relation-value the clip directly establishes.\n"
        "\n"
        "Return one entry per clip, indexed by the 0-based clip order given. Return JSON only, no "
        "markdown fence, with this exact top-level shape: "
        "{\"clips\":[{\"clipIndex\":0,\"summary\":\"the note\","
        "\"entities\":[{\"name\":\"...\",\"what\":\"...\",\"howIdentified\":\"...\"}],"
        "\"visibleText\":[{\"text\":\"exact text\",\"means\":\"what it conveys\"}],"
        "\"events\":[{\"what\":\"...\",\"basis\":\"read|inferred\"}],"
        "\"sourceQuestions\":[{\"text\":\"exact source question\",\"answer\":\"\","
        "\"basis\":\"spoken|visible\"}],"
        "\"supportedClaims\":[\"...\"],"
        "\"claimQuestion\":\"the supplied question\",\"claimVerdict\":\"direct|partial|not-established\","
        "\"claimAnswer\":\"...\",\"claimBindings\":[{\"subject\":\"...\","
        "\"relation\":\"...\",\"value\":\"...\"}],\"uncertainty\":\"...\"}]}. "
        "Include exactly one object for every supplied clip and no prose outside that JSON."
    )
    if goal:
        prompt += (
            f"\n\nWhat the person reading these notes cares about: {goal[:1200]}. "
            "Cover it in more detail than the rest, without skipping anything else that happens."
        )
    if questions:
        prompt += " Questions to resolve: " + " | ".join(questions[:4])[:1600] + "."
    if known_entities:
        prompt += (
            " Named people or entities that require visual grounding: "
            + " | ".join(known_entities[:20])[:1200]
            + "."
        )
    for index, clip in enumerate(batch):
        prompt += f"\n\nCLIP {index} covers {clip.start_ms / 1000:.1f}s-{clip.end_ms / 1000:.1f}s."
        context = (spoken_context or {}).get(clip.clip_id)
        if context:
            prompt += f" Aligned evidence context for this clip: {context[:4000]}"
    return prompt


def _content_for_batch(batch: list[ClipCaptionRequest], urls_by_clip: dict[str, list[str]]) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    for index, clip in enumerate(batch):
        content.append({"type": "text", "text": f"--- CLIP {index} frames ---"})
        for url in urls_by_clip[clip.clip_id]:
            content.append({"type": "image_url", "image_url": {"url": url}})
    return content


def _post_with_retry(
    session: requests.Session,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    attempts: int = 2,
    timeout_secs: int = REQUEST_TIMEOUT_CEILING_SECS,
) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = session.post(url, headers=headers, json=payload, timeout=timeout_secs)
            if response.status_code == 429 or response.status_code >= 500:
                last_error = RuntimeError(
                    f"gateway returned {response.status_code}: {response.text[:300]}"
                )
                # A daily/project hard limit cannot recover inside this job.
                # Return the provider diagnostic immediately rather than
                # sleeping and multiplying the same rejected batch.
                if response.status_code == 429 and (
                    "PerDay" in response.text or "requests per day" in response.text.lower()
                ):
                    break
                if attempt + 1 >= attempts:
                    break
                retry_after = response.headers.get("Retry-After", "").strip()
                delay_secs = 0.0
                try:
                    delay_secs = float(retry_after)
                except ValueError:
                    # Gemini quota responses expose a protobuf-style
                    # `retryDelay` (for example, "37s") in the JSON body.
                    # Respecting it prevents a synchronized retry burst from
                    # consuming another request only to receive the same 429.
                    match = re.search(r'"retryDelay"\s*:\s*"([0-9.]+)s"', response.text)
                    if match:
                        delay_secs = float(match.group(1))
                if delay_secs <= 0:
                    # Vercel's free-tier response currently omits Retry-After.
                    # Its model window resets on a minute cadence, so a short
                    # exponential retry only repeats the same rejected call.
                    delay_secs = (
                        60.0
                        if "free tier requests on this model are rate-limited"
                        in response.text.lower()
                        else min(15.0, 1.5 * (2**attempt))
                    )
                time.sleep(min(60.0, max(0.5, delay_secs)))
                continue
            return response
        except (RuntimeError, requests.RequestException) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(min(8.0, 0.5 * (2**attempt)))
    raise RuntimeError(f"gateway request failed after {attempts} attempts: {last_error}")


def _note_lines(entry: dict[str, Any]) -> list[str]:
    """Render the note fields as source-bearing lines.

    These sit above the claim protocol so retrieval, which strips the protocol
    envelope, still indexes everything the reader actually observed.
    """
    lines: list[str] = []
    for item in entry.get("entities") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:120]
        what = str(item.get("what") or "").strip()[:160]
        how = str(item.get("howIdentified") or "").strip()[:200]
        if name:
            lines.append(
                f"Present: {name}"
                + (f" — {what}" if what else "")
                + (f" (identified by {how})" if how else "")
            )
    for item in entry.get("visibleText") or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()[:200]
        means = str(item.get("means") or "").strip()[:200]
        if text:
            lines.append(f"On screen: {text!r}" + (f" — {means}" if means else ""))
    for item in entry.get("events") or []:
        if not isinstance(item, dict):
            continue
        what = str(item.get("what") or "").strip()[:240]
        basis = str(item.get("basis") or "").strip().lower()
        if what:
            lines.append(f"Happened{' (inferred)' if basis == 'inferred' else ''}: {what}")
    return lines


def _normalized_source_terms(value: str) -> list[str]:
    return re.findall(r"[\w]+", value.casefold(), re.UNICODE)


def _source_question_is_grounded(
    *,
    text: str,
    basis: str,
    entry: dict[str, Any],
    clip: ClipCaptionRequest,
    spoken_context: dict[str, str] | None,
) -> bool:
    """Require the claimed source channel to contain the question itself."""
    if basis == "visible":
        source = " ".join(
            str(item.get("text") or "")
            for item in entry.get("visibleText") or []
            if isinstance(item, dict)
        )
    else:
        source = str((spoken_context or {}).get(clip.clip_id) or "")
    source_normalized = " ".join(_normalized_source_terms(source))
    question_terms = _normalized_source_terms(text)
    question_normalized = " ".join(question_terms)
    if not source_normalized or not question_normalized:
        return False
    if question_normalized in source_normalized:
        return True
    # ASR/OCR can differ in one or two words while still preserving a prompt.
    # A high term-coverage threshold rejects the unrelated per-clip analysis
    # instruction without requiring exact punctuation or spelling.
    matched = sum(1 for term in question_terms if term in source_normalized)
    return len(question_terms) >= 3 and matched / len(question_terms) >= 0.75


def _parse_response(
    raw_text: str,
    batch: list[ClipCaptionRequest],
    spoken_context: dict[str, str] | None = None,
) -> dict[str, tuple[str, float]]:
    value = raw_text.strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    results: dict[str, tuple[str, float]] = {}
    try:
        # Gateway-routed multimodal models occasionally prefix an otherwise
        # valid object with a short acknowledgement.  That prose is not
        # evidence, but rejecting the complete JSON object after it forces a
        # second expensive visual pass. Decode the first object rather than
        # guessing from prose; malformed/non-JSON replies still yield none.
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            object_start = value.find("{")
            parsed = (
                json.JSONDecoder().raw_decode(value[object_start:])[0]
                if object_start >= 0
                else None
            )
        entries = parsed.get("clips") if isinstance(parsed, dict) else None
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                index = entry.get("clipIndex")
                if not isinstance(index, int) or not (0 <= index < len(batch)):
                    continue
                summary = str(entry.get("summary") or "").strip()
                note_lines = _note_lines(entry)
                claims = entry.get("supportedClaims")
                source_questions = entry.get("sourceQuestions")
                claim_question = str(entry.get("claimQuestion") or "").strip()
                claim_verdict = str(entry.get("claimVerdict") or "").strip()
                claim_answer = str(entry.get("claimAnswer") or "").strip()
                raw_bindings = entry.get("claimBindings")
                claim_bindings = []
                if isinstance(raw_bindings, list):
                    for binding in raw_bindings[:8]:
                        if not isinstance(binding, dict):
                            continue
                        subject = str(binding.get("subject") or "").strip()[:120]
                        relation = str(binding.get("relation") or "").strip()[:80]
                        value = str(binding.get("value") or "").strip()[:120]
                        if subject and relation and value:
                            claim_bindings.append(
                                {"subject": subject, "relation": relation, "value": value}
                            )
                uncertainty = str(entry.get("uncertainty") or "").strip()
                summary_prefix = (
                    "Observed context (not a complete answer): "
                    if claim_verdict == "partial" and summary
                    else ""
                )
                parts = [summary_prefix + summary]
                # Source-authored questions are an exhaustive retrieval surface,
                # so keep them ahead of optional detail that may fill the note's
                # bounded text budget.
                if isinstance(source_questions, list):
                    for source_question in source_questions[:12]:
                        if not isinstance(source_question, dict):
                            continue
                        source_text = str(source_question.get("text") or "").strip()[:500]
                        source_answer = str(source_question.get("answer") or "").strip()[:500]
                        source_basis = str(source_question.get("basis") or "").strip().lower()
                        if (
                            source_text
                            and source_basis in {"spoken", "visible"}
                            and _source_question_is_grounded(
                                text=source_text,
                                basis=source_basis,
                                entry=entry,
                                clip=batch[index],
                                spoken_context=spoken_context,
                            )
                        ):
                            parts.append(f"Source question ({source_basis}): {source_text}")
                            if source_answer:
                                parts.append(f"Source answer: {source_answer}")
                parts.extend(note_lines)
                if isinstance(claims, list):
                    parts.extend(
                        "Direct component: " + str(claim).strip()
                        for claim in claims
                        if str(claim).strip() and claim_verdict != "not-established"
                    )
                if claim_question and claim_verdict in {"direct", "partial", "not-established"}:
                    parts.append(f"Claim question: {claim_question}")
                    parts.append(f"Claim verdict: {claim_verdict}")
                    if claim_verdict == "direct" and claim_answer:
                        parts.append(f"Claim answer: {claim_answer}")
                        if claim_bindings:
                            parts.append(
                                "Claim bindings: "
                                + json.dumps(claim_bindings, ensure_ascii=False, separators=(",", ":"))
                            )
                if uncertainty:
                    parts.append(f"Uncertainty: {uncertainty}")
                text = "\n".join(part for part in parts if part)[:4000]
                if text:
                    confidence = {
                        "direct": 0.62,
                        "partial": 0.42,
                        "not-established": 0.25,
                    }.get(claim_verdict, 0.58)
                    results[batch[index].clip_id] = (text, confidence)
    except json.JSONDecodeError:
        pass
    return results


class GatewayVisionClient:
    """OpenAI-compatible VLM client for Vercel AI Gateway and direct OpenAI."""

    def __init__(self) -> None:
        self.provider = os.getenv("LARKUP_VIDEO_VISION_PROVIDER", "vercel_ai_gateway")
        self.api_key = (
            os.getenv("LARKUP_VIDEO_VISION_API_KEY")
            or os.getenv("AI_GATEWAY_API_KEY")
            or ""
        )
        default_base_url = "https://api.openai.com/v1" if self.provider == "openai" else DEFAULT_BASE_URL
        self.base_url = os.getenv("LARKUP_VIDEO_VISION_BASE_URL", default_base_url).rstrip("/")
        self.model = os.getenv("LARKUP_VIDEO_SEMANTIC_VISION_MODEL", DEFAULT_MODEL)
        self.reasoning_model = os.getenv(
            "LARKUP_VIDEO_REASONING_VISION_MODEL", DEFAULT_REASONING_MODEL
        )
        # A small batch preserves per-clip grounding and lets independent
        # batches run in parallel. Large batches previously spent the whole
        # output budget on hidden reasoning before returning valid JSON.
        self.batch_size = max(1, min(8, int(os.getenv("LARKUP_VIDEO_GATEWAY_BATCH_SIZE", "4"))))
        # VLM latency is driven far more by images than clip count. A thorough
        # verification clip can contain many chronological frames, so never
        # put several of those dense clips into one oversized gateway request.
        # The separate requests still run in parallel below.
        self.max_images_per_request = max(
            1, min(32, int(os.getenv("LARKUP_VIDEO_GATEWAY_MAX_IMAGES_PER_REQUEST", "20")))
        )
        # Each request covers the same four clips and frames. Raising only
        # parallelism shortens a full-video run without reducing coverage or
        # changing the visual evidence sent to the model.
        self.max_concurrency = max(1, min(24, int(os.getenv("LARKUP_VIDEO_GATEWAY_CONCURRENCY", "24"))))
        self.limiter = GatewayRateLimiter(
            int(os.getenv("LARKUP_VIDEO_GATEWAY_REQUESTS_PER_MINUTE", "60"))
        )
        # How much detail each note carries. Set per job from the brief's
        # indexing mode before dispatch; see SemanticVisionService.describe_clips.
        self.depth = "balanced"
        self.frame_prefix = os.getenv("LARKUP_VIDEO_FRAME_PREFIX", "tmp-frames")
        self._uploader = get_frame_uploader(os.getenv("LARKUP_VIDEO_BUCKET") or None)
        self._sessions = threading.local()
        self.last_error: str | None = None
        self._fatal_error = threading.Event()
        self._fatal_error_lock = threading.Lock()
        self._fatal_error_message: str | None = None

    def _record_http_error(self, label: str, response: requests.Response) -> None:
        message = f"{label} returned {response.status_code}: {response.text[:300]}"
        self.last_error = message
        # Authentication, billing, and permission failures apply to every
        # batch in this job. Stop queued requests immediately instead of
        # spending a full rate-limit window proving the same failure again.
        if response.status_code in {401, 402, 403}:
            with self._fatal_error_lock:
                self._fatal_error_message = self._fatal_error_message or message
                self._fatal_error.set()

    def _describe_each(
        self,
        clips: list[ClipCaptionRequest],
        goal: str,
        questions: list[str],
        spoken_context: dict[str, str] | None,
        known_entities: list[str] | None,
        model: str | None,
        max_output_tokens: int | None = None,
        reasoning_effort: str | None = None,
    ) -> dict[str, tuple[str, float]]:
        """Re-request clips one at a time, but all at once.

        A batch that was truncated, rejected, or came back missing entries is
        recovered by asking for its clips individually. Those requests are
        independent, so running them together costs one round trip instead of
        one per clip -- the difference between seconds and minutes on a batch
        that lost several clips. The shared rate limiter still paces them.
        """
        if not clips:
            return {}
        if len(clips) == 1:
            return self._describe_batch(
                clips,
                goal,
                questions,
                spoken_context,
                known_entities,
                model,
                max_output_tokens,
                reasoning_effort,
            )
        recovered: dict[str, tuple[str, float]] = {}
        with ThreadPoolExecutor(max_workers=min(self.max_concurrency, len(clips))) as pool:
            for result in pool.map(
                lambda clip: self._describe_batch(
                    [clip],
                    goal,
                    questions,
                    spoken_context,
                    known_entities,
                    model,
                    max_output_tokens,
                    reasoning_effort,
                ),
                clips,
            ):
                recovered.update(result)
        return recovered

    def _model_for_request(self, model: str) -> str:
        if self.provider == "openai" and model.startswith("openai/"):
            return model.split("/", 1)[1]
        return model

    def _session(self) -> requests.Session:
        session = getattr(self._sessions, "session", None)
        if session is None:
            session = requests.Session()
            self._sessions.session = session
        return session

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def _urls_for_clip(self, clip: ClipCaptionRequest) -> list[str]:
        return [
            _frame_to_url(frame, self._uploader, f"{self.frame_prefix}/{clip.clip_id}")
            for _, frame in clip.frames
        ]

    def _describe_batch(
        self,
        batch: list[ClipCaptionRequest],
        goal: str,
        questions: list[str],
        spoken_context: dict[str, str] | None = None,
        known_entities: list[str] | None = None,
        model: str | None = None,
        max_output_tokens: int | None = None,
        reasoning_effort: str | None = None,
    ) -> dict[str, tuple[str, float]]:
        if self._fatal_error.is_set():
            return {}
        urls_by_clip = {clip.clip_id: self._urls_for_clip(clip) for clip in batch}
        content = _content_for_batch(batch, urls_by_clip)
        content.append(
            {
                "type": "text",
                "text": _build_prompt(
                    batch, goal, questions, spoken_context, known_entities, self.depth
                ),
            }
        )
        payload: dict[str, Any] = {
            "model": self._model_for_request(model or self.model),
            "messages": [{"role": "user", "content": content}],
            # Reasoning tokens share `max_tokens` on gateway-routed models, and
            # a run that hits the cap returns truncated JSON that the parser
            # correctly rejects -- losing every clip in the batch and forcing
            # a slow one-at-a-time recovery. Buying headroom here is far
            # cheaper than paying for those retries.
            # Reasoning tokens share this budget on gateway-routed models, and a
            # run that hits the cap returns truncated JSON the parser correctly
            # rejects -- losing every clip in the batch. Measured: a single
            # terse answer from a current reader spends ~1.2k tokens before it
            # emits any content, so a note carrying entities, readings, and
            # events needs real headroom or it reliably returns nothing.
            "max_tokens": max_output_tokens or max(8_192, 2_600 * len(batch)),
        }
        # Gateway model support for strict response schemas is not uniform.
        # The prompt carries the complete contract, so plain JSON is the
        # reliable default. Deployments may opt into provider-enforced schema
        # validation without changing the evidence protocol.
        if os.getenv("LARKUP_VIDEO_USE_STRICT_JSON_SCHEMA", "").lower() in {"1", "true", "yes"}:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "clip_observations", "schema": _SCHEMA},
            }
        # The bulk reader extracts visible facts rather than exposing a long
        # reasoning trace. Keep its thinking budget small so output tokens are
        # available for structured evidence and an interactive answer stays
        # responsive; the dedicated reasoning model remains available for a later
        # precision verification pass.
        if self.provider == "vercel_ai_gateway":
            selected_model = model or self.model
            payload["reasoning"] = {
                "effort": reasoning_effort
                or os.getenv(
                    "LARKUP_VIDEO_SEMANTIC_REASONING_EFFORT",
                    "high"
                    if selected_model == self.reasoning_model and self.reasoning_model != self.model
                    else "minimal",
                )
            }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        request_timeout = _timeout_for_images(sum(len(urls) for urls in urls_by_clip.values()))
        self.limiter.acquire()
        if self._fatal_error.is_set():
            return {}
        try:
            response = _post_with_retry(
                self._session(),
                f"{self.base_url}/chat/completions",
                headers,
                payload,
                timeout_secs=request_timeout,
            )
        except RuntimeError as error:
            self.last_error = str(error)[:500]
            if len(batch) > 1 and "429" not in str(error):
                return self._describe_each(
                    batch,
                    goal,
                    questions,
                    spoken_context,
                    known_entities,
                    model,
                    max_output_tokens,
                    reasoning_effort,
                )
            return {}
        if response.status_code == 400:
            # Some gateway-routed models reject strict json_schema; retry loose.
            payload.pop("response_format", None)
            self.limiter.acquire()
            response = _post_with_retry(
                self._session(),
                f"{self.base_url}/chat/completions",
                headers,
                payload,
                timeout_secs=request_timeout,
            )
        if not response.ok:
            self._record_http_error("gateway", response)
            return {}
        try:
            body = response.json()
        except ValueError as error:
            self.last_error = f"gateway returned invalid JSON: {error}"[:500]
            return {}
        try:
            choice = body["choices"][0]
            text = choice["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as error:
            self.last_error = f"gateway response had no message content: {error}"[:500]
            return {}
        # A truncated structured response cannot be safely cited. Re-run the
        # same source frames as singleton clips: independent singleton calls
        # retain chronological grounding while avoiding a repeated long batch.
        if choice.get("finish_reason") == "length" and len(batch) > 1:
            return self._describe_each(
                batch,
                goal,
                questions,
                spoken_context,
                known_entities,
                model,
                max_output_tokens,
                reasoning_effort,
            )
        parsed = _parse_response(text, batch, spoken_context)
        if parsed:
            missing = [clip for clip in batch if clip.clip_id not in parsed]
            if missing and len(batch) > 1:
                parsed.update(
                    self._describe_each(
                        missing,
                        goal,
                        questions,
                        spoken_context,
                        known_entities,
                        model,
                        max_output_tokens,
                        reasoning_effort,
                    )
                )
            self.last_error = None if len(parsed) == len(batch) else "gateway omitted clip observations"
            return parsed
        # A few gateway-routed vision models acknowledge JSON Schema but
        # occasionally emit an unparseable/empty structured message. Retry
        # that same small frame batch once with ordinary JSON instructions
        # before declaring the source inconclusive. This is a recovery path,
        # not a second analysis strategy, and never manufactures evidence.
        fallback_payload = dict(payload)
        fallback_payload.pop("response_format", None)
        fallback_payload["messages"] = [
            *payload["messages"],
            {
                "role": "user",
                "content": (
                    "Your previous response was not usable. Return JSON only with exactly this shape: "
                    "{\"clips\":[{\"clipIndex\":0,\"summary\":\"...\",\"supportedClaims\":[\"...\"],"
                    "\"sourceQuestions\":[{\"text\":\"...\",\"answer\":\"\","
                    "\"basis\":\"spoken|visible\"}],"
                    "\"claimQuestion\":\"...\",\"claimVerdict\":\"direct|partial|not-established\","
                    "\"claimAnswer\":\"...\",\"claimBindings\":[{\"subject\":\"...\","
                    "\"relation\":\"...\",\"value\":\"...\"}],"
                    "\"uncertainty\":\"...\"}]}. "
                    "Include one entry for every clip."
                ),
            },
        ]
        self.limiter.acquire()
        try:
            fallback = _post_with_retry(
                self._session(),
                f"{self.base_url}/chat/completions",
                headers,
                fallback_payload,
                timeout_secs=request_timeout,
            )
        except RuntimeError as error:
            self.last_error = str(error)[:500]
            return {}
        if not fallback.ok:
            self._record_http_error("gateway fallback", fallback)
            return {}
        try:
            fallback_text = fallback.json()["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError, ValueError) as error:
            self.last_error = f"gateway fallback had no message content: {error}"[:500]
            return {}
        parsed = _parse_response(fallback_text, batch, spoken_context)
        if not parsed:
            self.last_error = "gateway returned no valid clip observations"
        else:
            self.last_error = None
        return parsed

    def describe_clips(
        self,
        clips: list[ClipCaptionRequest],
        goal: str,
        questions: list[str],
        spoken_context: dict[str, str] | None = None,
        known_entities: list[str] | None = None,
        *,
        use_reasoning_model: bool = False,
        on_progress: Callable[[int, int], None] | None = None,
        interactive: bool = False,
    ) -> dict[str, tuple[str, float]]:
        """Returns clip_id -> (caption_text, confidence) for every clip that yielded evidence.

        `use_reasoning_model` switches from the bulk indexing model to the
        larger reasoning model -- reserved for watch_original's bounded,
        low-volume, high-stakes final verification pass, never for full-video
        indexing where its cost/latency would dominate the job.
        """
        if not self.enabled or not clips:
            return {}
        self._fatal_error.clear()
        self._fatal_error_message = None
        model = self.reasoning_model if use_reasoning_model else self.model
        reasoning_effort = os.getenv(
            (
                "LARKUP_VIDEO_REASONING_THINKING_LEVEL"
                if use_reasoning_model
                else "LARKUP_VIDEO_SEMANTIC_THINKING_LEVEL"
            ),
            "low" if use_reasoning_model else "minimal",
        ).strip().lower()
        if reasoning_effort not in {"minimal", "low", "medium", "high"}:
            reasoning_effort = "low" if use_reasoning_model else "minimal"
        # A live answer needs one concise, timestamped observation, not the
        # large multi-clip index payload used during offline ingestion.  A
        # smaller output ceiling materially reduces gateway latency while the
        # same evidence schema and coverage checks preserve grounding.
        # A close read can carry a dozen chronological frames.  Some gateway
        # models account their compact visual reasoning against this same
        # output ceiling, so 1k tokens can truncate otherwise-valid JSON and
        # turn a useful observation into a failed job.  Keep the small fast
        # budget for ordinary looks, but give denser reads enough room to
        # finish one concise evidence object instead of retrying the images.
        # A live look still has to finish one complete evidence object. Current
        # readers spend most of a small budget before emitting any content, so a
        # tight ceiling here does not return a shorter answer -- it returns an
        # unparseable one, and the question comes back unanswered.
        interactive_frame_count = max((len(clip.frames) for clip in clips), default=0)
        max_output_tokens = (
            (4_096 if interactive_frame_count > 8 else 3_072) if interactive else None
        )
        batches = self._batches_for(clips)
        results: dict[str, tuple[str, float]] = {}
        completed = 0
        with ThreadPoolExecutor(max_workers=min(self.max_concurrency, len(batches))) as pool:
            futures = {
                pool.submit(
                    self._describe_batch,
                    batch,
                    goal,
                    questions,
                    spoken_context,
                    known_entities,
                    model,
                    max_output_tokens,
                    reasoning_effort,
                ): len(batch)
                for batch in batches
            }
            for future in as_completed(futures):
                batch_result = future.result()
                results.update(batch_result)
                # Report usable evidence, not merely finished HTTP requests.
                # A rejected batch must not make live progress claim that its
                # clips were analyzed before the coverage gate fails the job.
                completed += len(batch_result)
                if on_progress:
                    on_progress(completed, len(clips))
        missing_count = len(clips) - len(results)
        if missing_count:
            provider_error = (
                self._fatal_error_message
                or self.last_error
                or "one or more provider batches returned no evidence"
            )
            self.last_error = (
                f"semantic vision returned {len(results)}/{len(clips)} clips: {provider_error}"
            )[:500]
        else:
            self.last_error = None
        return results

    def _batches_for(self, clips: list[ClipCaptionRequest]) -> list[list[ClipCaptionRequest]]:
        batches: list[list[ClipCaptionRequest]] = []
        batch: list[ClipCaptionRequest] = []
        image_count = 0
        for clip in clips:
            clip_images = max(1, len(clip.frames))
            if batch and (
                len(batch) >= self.batch_size
                or image_count + clip_images > self.max_images_per_request
            ):
                batches.append(batch)
                batch, image_count = [], 0
            batch.append(clip)
            image_count += clip_images
        if batch:
            batches.append(batch)
        return batches


class GeminiVisionClient(GatewayVisionClient):
    """Native Gemini client for users who configured Google directly in AI Models."""

    def __init__(self) -> None:
        super().__init__()
        self.provider = "google"
        self.fallback_api_key = os.getenv(
            "LARKUP_VIDEO_GOOGLE_FALLBACK_API_KEY", ""
        ).strip()
        # Direct Gemini projects commonly enforce a much lower concurrent
        # request ceiling than an aggregating gateway.
        self.max_concurrency = max(
            1, min(8, int(os.getenv("LARKUP_VIDEO_GOOGLE_CONCURRENCY", "4")))
        )
        self.batch_size = max(
            1, min(4, int(os.getenv("LARKUP_VIDEO_GOOGLE_BATCH_SIZE", "1")))
        )
        self.max_images_per_request = max(
            1, min(16, int(os.getenv("LARKUP_VIDEO_GOOGLE_MAX_IMAGES_PER_REQUEST", "8")))
        )
        self.limiter = GatewayRateLimiter(
            # New Gemini projects commonly start at 15 RPM. Keep headroom for
            # the planner/brain, which may use the same project and has its own
            # process-local limiter.
            int(os.getenv("LARKUP_VIDEO_GOOGLE_REQUESTS_PER_MINUTE", "12"))
        )
        self.base_url = os.getenv(
            "LARKUP_VIDEO_GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"
        ).rstrip("/")
        self.model = self._native_model(self.model)
        self.reasoning_model = self._native_model(self.reasoning_model)
        self.use_interactions_api = os.getenv(
            "LARKUP_VIDEO_GOOGLE_USE_INTERACTIONS_API", "true"
        ).strip().lower() not in {"0", "false", "no", "off"}

    @staticmethod
    def _native_model(model: str) -> str:
        return model.split("/", 1)[1] if model.startswith("google/") else model

    def _describe_batch(
        self,
        batch: list[ClipCaptionRequest],
        goal: str,
        questions: list[str],
        spoken_context: dict[str, str] | None = None,
        known_entities: list[str] | None = None,
        model: str | None = None,
        max_output_tokens: int | None = None,
        reasoning_effort: str | None = None,
    ) -> dict[str, tuple[str, float]]:
        if self._fatal_error.is_set():
            return {}
        parts: list[dict[str, Any]] = []
        for index, clip in enumerate(batch):
            parts.append({"text": f"--- CLIP {index} frames ---"})
            for _, frame in clip.frames:
                parts.append({"inline_data": _frame_to_inline_data(frame)})
        parts.append(
            {
                "text": _build_prompt(
                    batch, goal, questions, spoken_context, known_entities, self.depth
                )
            }
        )
        selected_model = self._native_model(model or self.model)
        generation_config: dict[str, Any] = {
            # Native Gemini does not charge hidden thinking against this cap.
            # A bounded ceiling keeps extraction responsive while still
            # allowing a full paragraph plus entities/events for every clip.
            "maxOutputTokens": max_output_tokens or max(2_048, 1_400 * len(batch)),
            "responseMimeType": "application/json",
            "responseSchema": _SCHEMA,
        }
        if selected_model.startswith("gemini-3"):
            generation_config["thinkingConfig"] = {
                "thinkingLevel": reasoning_effort or "minimal"
            }
        elif selected_model.startswith("gemini-2.5"):
            # Gemini 2.5 uses a numeric budget instead of Gemini 3's level.
            # Bulk extraction is direct perception plus schema filling, so
            # disabling hidden thinking preserves the visual answer while
            # removing avoidable per-batch latency.
            generation_config["thinkingConfig"] = {"thinkingBudget": 0}
            generation_config["temperature"] = 0
        else:
            generation_config["temperature"] = 0
        use_interactions = self.use_interactions_api and selected_model.startswith("gemini-3")
        if use_interactions:
            interaction_input: list[dict[str, Any]] = []
            for part in parts:
                if "text" in part:
                    interaction_input.append({"type": "text", "text": part["text"]})
                elif "inline_data" in part:
                    interaction_input.append(
                        {
                            "type": "image",
                            "data": part["inline_data"]["data"],
                            "mime_type": part["inline_data"]["mime_type"],
                        }
                    )
            interaction_generation = {
                "max_output_tokens": generation_config["maxOutputTokens"],
                "thinking_level": reasoning_effort or "minimal",
            }
            payload = {
                "model": selected_model,
                "input": interaction_input,
                "response_format": {
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": _SCHEMA,
                },
                "generation_config": interaction_generation,
                "store": False,
            }
            request_url = f"{self.base_url}/interactions"
        else:
            payload = {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": generation_config,
            }
            request_url = f"{self.base_url}/models/{selected_model}:generateContent"
        headers = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        request_timeout = _timeout_for_images(sum(len(clip.frames) for clip in batch))
        self.limiter.acquire()
        if self._fatal_error.is_set():
            return {}
        try:
            response = _post_with_retry(
                self._session(),
                request_url,
                headers,
                payload,
                attempts=1 if self.fallback_api_key else 3,
                timeout_secs=request_timeout,
            )
        except RuntimeError as error:
            # Managed Cloud can carry a second independently configured key.
            # Rotate only on quota exhaustion; malformed requests and model
            # errors must remain visible instead of being duplicated.
            if self.fallback_api_key and "429" in str(error):
                headers = {
                    "x-goog-api-key": self.fallback_api_key,
                    "Content-Type": "application/json",
                }
                try:
                    response = _post_with_retry(
                        self._session(),
                        request_url,
                        headers,
                        payload,
                        attempts=1,
                        timeout_secs=request_timeout,
                    )
                except RuntimeError as fallback_error:
                    self.last_error = str(fallback_error)[:500]
                    return {}
            else:
                self.last_error = str(error)[:500]
                if len(batch) > 1 and "429" not in str(error):
                    return self._describe_each(
                        batch,
                        goal,
                        questions,
                        spoken_context,
                        known_entities,
                        model,
                        max_output_tokens,
                        reasoning_effort,
                    )
                return {}
        if not response.ok:
            self._record_http_error("Gemini", response)
            return {}
        try:
            response_payload = response.json()
            if use_interactions:
                text = "\n".join(
                    str(content.get("text") or "")
                    for step in response_payload.get("steps") or []
                    if step.get("type") == "model_output"
                    for content in step.get("content") or []
                    if content.get("type") == "text"
                )
            else:
                response_parts = response_payload["candidates"][0]["content"]["parts"]
                text = "\n".join(str(part.get("text") or "") for part in response_parts)
        except (KeyError, IndexError, TypeError, ValueError) as error:
            self.last_error = f"Gemini response had no text content: {error}"[:500]
            return {}
        parsed = _parse_response(text, batch, spoken_context)
        missing = [clip for clip in batch if clip.clip_id not in parsed]
        # Structured output normally guarantees one item per clip. If a model
        # still omits one from a multi-clip response, retry only the omitted
        # source clip so coverage is recovered without repeating good work.
        if missing and len(batch) > 1:
            parsed.update(
                self._describe_each(
                    missing,
                    goal,
                    questions,
                    spoken_context,
                    known_entities,
                    model,
                    max_output_tokens,
                    reasoning_effort,
                )
            )
        self.last_error = None if parsed else "Gemini returned no valid clip observations"
        return parsed


class SemanticVisionService:
    """Agent-planned semantic reading over a video's per-clip frame sets."""

    def __init__(self, enabled: bool, disabled: bool) -> None:
        self.enabled = enabled and not disabled
        self.last_error: str | None = None
        provider = os.getenv("LARKUP_VIDEO_VISION_PROVIDER", "vercel_ai_gateway").strip().lower()
        self._client = GeminiVisionClient() if provider == "google" else GatewayVisionClient()

    def describe_clips(
        self,
        clips: dict[str, tuple[int, int, list[tuple[int, Any]]]],
        brief: dict[str, Any],
        transcript: list[dict[str, Any]] | None = None,
        on_progress: Callable[[int, int], None] | None = None,
        visual_observations: list[dict[str, Any]] | None = None,
    ) -> list[SemanticObservation]:
        """`clips` maps clip_id -> (start_ms, end_ms, sampled (time_ms, frame) pairs).

        Bounded `thorough` inspection (watch_original) routes through the
        larger reasoning model: it runs over a handful of clips at most, so
        the added cost/latency is negligible next to full-index captioning,
        while accuracy on the final verification pass matters more.
        """
        if not self.enabled or not clips:
            return []
        if not self._client.enabled:
            self.last_error = "A vision provider API key is not configured; semantic vision is disabled"
            return []
        goal = str(brief.get("goal") or "")
        # Coverage is a promise about how much the notes say, not only about how
        # many frames were read. A bounded interactive look always reads closely:
        # it exists because something needed establishing.
        self._client.depth = (
            "thorough"
            if brief.get("interactive") is True
            else str(brief.get("indexingMode") or "balanced").strip().lower()
        )
        questions = [
            str(value).strip() for value in brief.get("expectedQuestions", []) if str(value).strip()
        ]
        known_entities = [
            str(value).strip() for value in brief.get("knownEntities", []) if str(value).strip()
        ]
        extraction_focus = [
            str(value).strip()
            for value in brief.get("agentExtractionFocus", [])
            if str(value).strip()
        ]
        if extraction_focus:
            goal = "\n".join(
                part
                for part in (
                    goal,
                    "Agent-selected extraction focus: " + " | ".join(extraction_focus[:12])[:1400],
                )
                if part
            )
        requests_ = [
            ClipCaptionRequest(clip_id=clip_id, start_ms=start_ms, end_ms=end_ms, frames=frames)
            for clip_id, (start_ms, end_ms, frames) in clips.items()
            if frames
        ]
        spoken_context: dict[str, str] = {}
        for request in requests_:
            speech = " ".join(
                str(segment.get("text") or "").strip()
                for segment in (transcript or [])
                if float(segment.get("endMs") or 0) >= request.start_ms
                and float(segment.get("startMs") or 0) <= request.end_ms
                and str(segment.get("text") or "").strip()
            )[:900]
            ocr_candidates: list[tuple[float, int, str]] = []
            seen_ocr: set[str] = set()
            for observation in visual_observations or []:
                time_ms = int(observation.get("timeMs") or 0)
                if not request.start_ms <= time_ms <= request.end_ms:
                    continue
                for line in observation.get("ocr") or []:
                    text = str(line.get("text") or "").strip()
                    confidence = float(line.get("confidence") or 0)
                    key = text.casefold()
                    if len(text) < 2 or confidence < 0.75 or key in seen_ocr:
                        continue
                    seen_ocr.add(key)
                    ocr_candidates.append((confidence, time_ms, text[:120]))
            selected_ocr = sorted(ocr_candidates, reverse=True)[:40]
            selected_ocr.sort(key=lambda item: item[1])
            ocr = "; ".join(
                f"{time_ms / 1000:.1f}s {text!r}"
                for _confidence, time_ms, text in selected_ocr
            )[:1400]
            context_parts = []
            if speech:
                context_parts.append(f"Synchronized speech: {speech}")
            if ocr:
                context_parts.append(f"Machine-read visible text: {ocr}")
            spoken_context[request.clip_id] = " | ".join(context_parts)
        # A bounded thorough pass runs over a handful of clips after retrieval
        # has already narrowed the source, so the separately configured
        # reasoning reader's cost and latency are negligible there while its
        # accuracy on a close read is not. Hosts can opt out for a
        # latency-sensitive deployment.
        use_reasoning_model = (
            brief.get("interactive") is True
            and brief.get("indexingMode") == "thorough"
            and os.getenv("LARKUP_VIDEO_USE_REASONING_VISION_MODEL", "true").strip().lower()
            not in {"0", "false", "no", "off"}
        )
        if use_reasoning_model:
            try:
                requested_frames = int(brief.get("maxFrames") or 0)
            except (TypeError, ValueError):
                requested_frames = 0
            requests_ = [
                ClipCaptionRequest(
                    clip_id=request.clip_id,
                    start_ms=request.start_ms,
                    end_ms=request.end_ms,
                    frames=_precision_frames(
                        request.frames,
                        max_source_frames=(
                            min(24, max(6, requested_frames))
                            if request.clip_id == "clip_continuous_sequence"
                            else 4
                        ),
                    ),
                )
                for request in requests_
            ]
        try:
            captions = self._client.describe_clips(
                requests_,
                goal,
                questions,
                spoken_context,
                known_entities,
                use_reasoning_model=use_reasoning_model,
                on_progress=on_progress,
                interactive=brief.get("interactive") is True,
            )
            self.last_error = self._client.last_error
        except Exception as error:
            # Object/OCR evidence remains useful when the gateway is
            # unreachable. Do not fail an entire index, but preserve a
            # bounded diagnostic for cloud operations.
            self.last_error = f"{type(error).__name__}: {error}"[:500]
            return []
        bounds = {clip_id: (start_ms, end_ms) for clip_id, (start_ms, end_ms, _) in clips.items()}
        return [
            SemanticObservation(
                start_ms=bounds[clip_id][0],
                end_ms=bounds[clip_id][1],
                text=text,
                confidence=confidence,
            )
            for clip_id, (text, confidence) in captions.items()
            if text.strip()
        ]
