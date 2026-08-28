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
import threading
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

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
DEFAULT_MODEL = "google/gemini-3-flash"
DEFAULT_REASONING_MODEL = "alibaba/qwen3-vl-235b-a22b-instruct"
REQUEST_TIMEOUT_SECS = 60

_SCHEMA = {
    "type": "object",
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "clipIndex": {"type": "integer"},
                    "summary": {"type": "string", "maxLength": 360},
                    "supportedClaims": {
                        "type": "array",
                        "maxItems": 3,
                        "items": {"type": "string", "maxLength": 220},
                    },
                    "uncertainty": {"type": "string", "maxLength": 220},
                },
                "required": ["clipIndex", "summary"],
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
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        raise ValueError("could not encode frame as JPEG")
    payload = buffer.tobytes()
    if uploader:
        return uploader.upload(payload, f"{prefix}/{uuid.uuid4().hex}.jpg", "image/jpeg")
    return "data:image/jpeg;base64," + base64.b64encode(payload).decode("ascii")


def _build_prompt(
    batch: list[ClipCaptionRequest],
    goal: str,
    questions: list[str],
    spoken_context: dict[str, str] | None = None,
    known_entities: list[str] | None = None,
) -> str:
    prompt = (
        "You are given chronological frame groups from several bounded clips of one video, "
        "in the order the clips occur. Describe only facts visibly supported by each clip's "
        "own frames -- do not use one clip's content to guess another's. Read visible text "
        "when clear. If a clip's frames establish an outcome, state, count, or conclusion, "
        "name the evidence; otherwise explicitly say it is not established for that clip. "
        "Use the time-aligned spoken context only together with the frames: it can help ground "
        "a person, object, or event. When a question names a person, actively resolve that person's "
        "identity from the synchronized speech, who is speaking or being addressed, camera focus, and "
        "the chronological frames. Do not choose a person just because they are nearby or have a distinctive "
        "appearance. A bare mention alone is not enough to identify something visible. If identity cannot "
        "be grounded, say so rather than assigning an attribute, action, or appearance to the wrong subject. "
        "Do not invent context. Return one entry per clip, indexed the same as the clip "
        "order given (0-based). Keep each summary under 45 words and each claim short."
    )
    if goal:
        prompt += f" Investigation goal: {goal[:1200]}."
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
            prompt += f" Spoken context for this clip: {context[:900]}"
    return prompt


def _content_for_batch(batch: list[ClipCaptionRequest], urls_by_clip: dict[str, list[str]]) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    for index, clip in enumerate(batch):
        content.append({"type": "text", "text": f"--- CLIP {index} frames ---"})
        for url in urls_by_clip[clip.clip_id]:
            content.append({"type": "image_url", "image_url": {"url": url}})
    return content


def _post_with_retry(
    session: requests.Session, url: str, headers: dict[str, str], payload: dict[str, Any], attempts: int = 3
) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = session.post(url, headers=headers, json=payload, timeout=REQUEST_TIMEOUT_SECS)
            if response.status_code == 429 or response.status_code >= 500:
                raise RuntimeError(f"gateway returned {response.status_code}: {response.text[:300]}")
            return response
        except (RuntimeError, requests.RequestException) as error:
            last_error = error
            time.sleep(min(8.0, 0.5 * (2**attempt)))
    raise RuntimeError(f"gateway request failed after {attempts} attempts: {last_error}")


def _parse_response(raw_text: str, batch: list[ClipCaptionRequest]) -> dict[str, tuple[str, float]]:
    value = raw_text.strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    results: dict[str, tuple[str, float]] = {}
    try:
        parsed = json.loads(value)
        entries = parsed.get("clips") if isinstance(parsed, dict) else None
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                index = entry.get("clipIndex")
                if not isinstance(index, int) or not (0 <= index < len(batch)):
                    continue
                summary = str(entry.get("summary") or "").strip()
                claims = entry.get("supportedClaims")
                uncertainty = str(entry.get("uncertainty") or "").strip()
                parts = [summary]
                if isinstance(claims, list):
                    parts.extend(str(claim).strip() for claim in claims if str(claim).strip())
                if uncertainty:
                    parts.append(f"Uncertainty: {uncertainty}")
                text = "\n".join(part for part in parts if part)[:4000]
                if text:
                    results[batch[index].clip_id] = (text, 0.58)
    except json.JSONDecodeError:
        pass
    return results


class GatewayVisionClient:
    """Stateless HTTP client for the Vercel AI Gateway's chat/completions endpoint."""

    def __init__(self) -> None:
        self.api_key = os.getenv("AI_GATEWAY_APIKEY") or os.getenv("AI_GATEWAY_API_KEY") or ""
        self.base_url = os.getenv("AI_GATEWAY_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
        self.model = os.getenv("LARKUP_VIDEO_SEMANTIC_VISION_MODEL", DEFAULT_MODEL)
        self.reasoning_model = os.getenv(
            "LARKUP_VIDEO_REASONING_VISION_MODEL", DEFAULT_REASONING_MODEL
        )
        # A small batch preserves per-clip grounding and lets independent
        # batches run in parallel. Large batches previously spent the whole
        # output budget on hidden reasoning before returning valid JSON.
        self.batch_size = max(1, int(os.getenv("LARKUP_VIDEO_GATEWAY_BATCH_SIZE", "2")))
        self.max_concurrency = max(1, int(os.getenv("LARKUP_VIDEO_GATEWAY_CONCURRENCY", "4")))
        self.limiter = GatewayRateLimiter(
            int(os.getenv("LARKUP_VIDEO_GATEWAY_REQUESTS_PER_MINUTE", "60"))
        )
        self.frame_prefix = os.getenv("LARKUP_VIDEO_FRAME_PREFIX", "tmp-frames")
        self._uploader = get_frame_uploader(os.getenv("LARKUP_VIDEO_BUCKET") or None)
        self._session = requests.Session()

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
    ) -> dict[str, tuple[str, float]]:
        urls_by_clip = {clip.clip_id: self._urls_for_clip(clip) for clip in batch}
        content = _content_for_batch(batch, urls_by_clip)
        content.append(
            {
                "type": "text",
                "text": _build_prompt(batch, goal, questions, spoken_context, known_entities),
            }
        )
        payload: dict[str, Any] = {
            "model": model or self.model,
            "messages": [{"role": "user", "content": content}],
            # Gateway-reported Gemini reasoning tokens share `max_tokens`.
            # Its minimum reasoning allotment can consume roughly 600 tokens,
            # so the old 640-token cap truncated otherwise valid JSON and the
            # parser correctly rejected every clip. Reserve enough room for
            # the compact schema after that hidden work has completed.
            "max_tokens": max(2_560, 900 * len(batch)),
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "clip_observations", "schema": _SCHEMA},
            },
        }
        # The bulk reader extracts visible facts rather than exposing a long
        # reasoning trace. Keep its thinking budget small so output tokens are
        # available for structured evidence and an interactive answer stays
        # responsive; the dedicated deep model remains available for a later
        # precision verification pass.
        payload["reasoning"] = {
            "effort": os.getenv(
                "LARKUP_VIDEO_SEMANTIC_REASONING_EFFORT",
                "high" if (model or self.model) == self.reasoning_model else "minimal",
            )
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        self.limiter.acquire()
        try:
            response = _post_with_retry(self._session, f"{self.base_url}/chat/completions", headers, payload)
        except RuntimeError:
            return {}
        if response.status_code == 400:
            # Some gateway-routed models reject strict json_schema; retry loose.
            payload.pop("response_format", None)
            self.limiter.acquire()
            response = _post_with_retry(self._session, f"{self.base_url}/chat/completions", headers, payload)
        if not response.ok:
            return {}
        body = response.json()
        try:
            choice = body["choices"][0]
            text = choice["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            return {}
        # A truncated structured response cannot be safely cited. Re-run the
        # same source frames as singleton clips: independent singleton calls
        # retain chronological grounding while avoiding a repeated long batch.
        if choice.get("finish_reason") == "length" and len(batch) > 1:
            results: dict[str, tuple[str, float]] = {}
            for clip in batch:
                    results.update(
                        self._describe_batch(
                            [clip], goal, questions, spoken_context, known_entities, model
                        )
                    )
            return results
        return _parse_response(text, batch)

    def describe_clips(
        self,
        clips: list[ClipCaptionRequest],
        goal: str,
        questions: list[str],
        spoken_context: dict[str, str] | None = None,
        known_entities: list[str] | None = None,
        *,
        use_reasoning_model: bool = False,
    ) -> dict[str, tuple[str, float]]:
        """Returns clip_id -> (caption_text, confidence) for every clip that yielded evidence.

        `use_reasoning_model` switches from the bulk indexing model to the
        larger reasoning model -- reserved for watch_original's bounded,
        low-volume, high-stakes final verification pass, never for full-video
        indexing where its cost/latency would dominate the job.
        """
        if not self.enabled or not clips:
            return {}
        model = self.reasoning_model if use_reasoning_model else self.model
        batches = [clips[i : i + self.batch_size] for i in range(0, len(clips), self.batch_size)]
        results: dict[str, tuple[str, float]] = {}
        with ThreadPoolExecutor(max_workers=self.max_concurrency) as pool:
            for batch_result in pool.map(
                lambda batch: self._describe_batch(
                    batch, goal, questions, spoken_context, known_entities, model
                ),
                batches,
            ):
                results.update(batch_result)
        return results


class SemanticVisionService:
    """Full-coverage semantic reading over a video's per-clip frame sets."""

    def __init__(self, enabled: bool, disabled: bool) -> None:
        self.enabled = enabled and not disabled
        self.last_error: str | None = None
        self._client = GatewayVisionClient()

    def describe_clips(
        self,
        clips: dict[str, tuple[int, int, list[tuple[int, Any]]]],
        brief: dict[str, Any],
        transcript: list[dict[str, Any]] | None = None,
    ) -> list[SemanticObservation]:
        """`clips` maps clip_id -> (start_ms, end_ms, sampled (time_ms, frame) pairs).

        Bounded `deep`-mode inspection (watch_original) routes through the
        larger reasoning model: it runs over a handful of clips at most, so
        the added cost/latency is negligible next to full-index captioning,
        while accuracy on the final verification pass matters more.
        """
        if not self.enabled or not clips:
            return []
        if not self._client.enabled:
            self.last_error = "AI_GATEWAY_APIKEY is not configured; semantic vision is disabled"
            return []
        goal = str(brief.get("goal") or "")
        questions = [
            str(value).strip() for value in brief.get("expectedQuestions", []) if str(value).strip()
        ]
        known_entities = [
            str(value).strip() for value in brief.get("knownEntities", []) if str(value).strip()
        ]
        requests_ = [
            ClipCaptionRequest(clip_id=clip_id, start_ms=start_ms, end_ms=end_ms, frames=frames)
            for clip_id, (start_ms, end_ms, frames) in clips.items()
            if frames
        ]
        spoken_context = {
            request.clip_id: " ".join(
                str(segment.get("text") or "").strip()
                for segment in (transcript or [])
                if float(segment.get("endMs") or 0) >= request.start_ms
                and float(segment.get("startMs") or 0) <= request.end_ms
                and str(segment.get("text") or "").strip()
            )[:900]
            for request in requests_
        }
        use_reasoning_model = brief.get("indexingMode") == "deep"
        try:
            captions = self._client.describe_clips(
                requests_,
                goal,
                questions,
                spoken_context,
                known_entities,
                use_reasoning_model=use_reasoning_model,
            )
            self.last_error = None
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
