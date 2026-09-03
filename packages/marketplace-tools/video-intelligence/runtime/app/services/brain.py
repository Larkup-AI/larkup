"""Bounded agent planner for video indexing.

The planner chooses a small, validated extraction policy. It never executes
arbitrary tools or code: the shared pipeline remains the only executor and
clamps every model-proposed budget before using it. Cloud and local runtimes
use this exact module; only provider credentials differ through environment
variables.
"""

from __future__ import annotations

import json
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from typing import Any

import requests


DEFAULT_AGENT_MODEL = "openai/gpt-5-mini"
DEFAULT_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1"


def _post_agent_request(
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout_seconds: int,
    attempts: int = 2,
) -> requests.Response:
    """Retry only transient provider failures and honor quota reset hints."""
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
                timeout=timeout_seconds,
            )
        except requests.RequestException as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(min(8.0, 0.5 * (2**attempt)))
                continue
            raise
        if response.ok or (response.status_code != 429 and response.status_code < 500):
            return response
        if response.status_code == 429 and (
            "PerDay" in response.text or "requests per day" in response.text.lower()
        ):
            return response
        if attempt + 1 >= attempts:
            return response
        retry_after = response.headers.get("Retry-After", "").strip()
        try:
            delay_seconds = float(retry_after)
        except ValueError:
            match = re.search(r'"retryDelay"\s*:\s*"([0-9.]+)s"', response.text)
            delay_seconds = float(match.group(1)) if match else 0.0
        if delay_seconds <= 0:
            delay_seconds = 60.0 if response.status_code == 429 else 1.5 * (2**attempt)
        time.sleep(min(60.0, max(0.5, delay_seconds)))
    assert last_error is not None
    raise last_error


_SOURCE_RANGE_SCHEMA = {
    "type": "object",
    "properties": {
        "startMs": {"type": "number"},
        "endMs": {"type": "number"},
    },
    "required": ["startMs", "endMs"],
    "additionalProperties": False,
}

PLANNER_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "maxLength": 240},
        "extractionFocus": {
            "type": "array",
            "maxItems": 8,
            "items": {"type": "string", "maxLength": 120},
        },
        "useTranscript": {"type": "boolean"},
        "useOcr": {"type": "boolean"},
        "useObjectDetection": {"type": "boolean"},
        "useSemanticVision": {"type": "boolean"},
        "useVideoEmbeddings": {"type": "boolean"},
        "useSceneCuts": {"type": "boolean"},
        "sampleIntervalSecs": {"type": "number"},
        "prioritySampleIntervalSecs": {"type": "number"},
        "clipWindowSecs": {"type": "number"},
        "framesPerClip": {"type": "integer"},
        "priorityRanges": {
            "type": "array",
            "maxItems": 12,
            "items": {
                "type": "object",
                "properties": {
                    "startSecs": {"type": "number"},
                    "endSecs": {"type": "number"},
                    "reason": {"type": "string", "maxLength": 200},
                },
                "required": ["startSecs", "endSecs", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "summary",
        "extractionFocus",
        "useTranscript",
        "useOcr",
        "useObjectDetection",
        "useSemanticVision",
        "useVideoEmbeddings",
        "useSceneCuts",
        "sampleIntervalSecs",
        "prioritySampleIntervalSecs",
        "clipWindowSecs",
        "framesPerClip",
        "priorityRanges",
    ],
    "additionalProperties": False,
}

KNOWLEDGE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "overview": {"type": "string", "maxLength": 1200},
        "participants": {
            "type": "array",
            "maxItems": 64,
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "maxLength": 120},
                    "role": {"type": "string", "maxLength": 160},
                    "evidence": {
                        "type": "array",
                        "maxItems": 6,
                        "items": _SOURCE_RANGE_SCHEMA,
                    },
                },
                "required": ["name", "role", "evidence"],
                "additionalProperties": False,
            },
        },
        "stateHistory": {
            "type": "array",
            "maxItems": 32,
            "items": {
                "type": "object",
                "properties": {
                    "startMs": {"type": "number"},
                    "endMs": {"type": "number"},
                    "state": {"type": "string", "maxLength": 240},
                    "confidence": {"type": "string", "enum": ["direct", "partial"]},
                },
                "required": ["startMs", "endMs", "state", "confidence"],
                "additionalProperties": False,
            },
        },
        "keyEvents": {
            "type": "array",
            "maxItems": 64,
            "items": {
                "type": "object",
                "properties": {
                    "startMs": {"type": "number"},
                    "endMs": {"type": "number"},
                    "event": {"type": "string", "maxLength": 240},
                    "confidence": {"type": "string", "enum": ["direct", "partial"]},
                },
                "required": ["startMs", "endMs", "event", "confidence"],
                "additionalProperties": False,
            },
        },
        "narrative": {
            "type": "array",
            "maxItems": 64,
            "items": {
                "type": "object",
                "properties": {
                    "startMs": {"type": "number"},
                    "endMs": {"type": "number"},
                    "text": {"type": "string", "maxLength": 600},
                    "confidence": {"type": "string", "enum": ["direct", "partial"]},
                },
                "required": ["startMs", "endMs", "text", "confidence"],
                "additionalProperties": False,
            },
        },
        "context": {
            "type": "array",
            "maxItems": 32,
            "items": {
                "type": "object",
                "properties": {
                    "fact": {"type": "string", "maxLength": 240},
                    "evidence": {
                        "type": "array",
                        "maxItems": 6,
                        "items": _SOURCE_RANGE_SCHEMA,
                    },
                },
                "required": ["fact", "evidence"],
                "additionalProperties": False,
            },
        },
        "uncertainties": {
            "type": "array",
            "maxItems": 16,
            "items": {"type": "string", "maxLength": 240},
        },
    },
    "required": [
        "overview",
        "participants",
        "stateHistory",
        "keyEvents",
        "narrative",
        "context",
        "uncertainties",
    ],
    "additionalProperties": False,
}

SOURCE_INVENTORY_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "maxItems": 256,
            "items": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": [
                            "question",
                            "heading",
                            "slide-item",
                            "board-item",
                            "list-item",
                        ],
                    },
                    "channel": {"type": "string", "enum": ["spoken", "visible"]},
                    "text": {"type": "string", "maxLength": 600},
                    "answer": {"type": "string", "maxLength": 600},
                    "startMs": {"type": "number"},
                    "endMs": {"type": "number"},
                },
                "required": [
                    "kind",
                    "channel",
                    "text",
                    "answer",
                    "startMs",
                    "endMs",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

CONSISTENCY_AUDIT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "overview": {"type": "string", "maxLength": 1200},
        "stateDecisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "keep": {"type": "boolean"},
                    "replacementState": {"type": "string", "maxLength": 240},
                    "neutralState": {"type": "string", "maxLength": 240},
                    "entityMappingSupported": {"type": "boolean"},
                    "reason": {"type": "string", "maxLength": 240},
                },
                "required": [
                    "index",
                    "keep",
                    "replacementState",
                    "neutralState",
                    "entityMappingSupported",
                    "reason",
                ],
                "additionalProperties": False,
            },
        },
        "eventDecisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "keep": {"type": "boolean"},
                    "reason": {"type": "string", "maxLength": 240},
                },
                "required": ["index", "keep", "reason"],
                "additionalProperties": False,
            },
        },
        "participantDecisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "keep": {"type": "boolean"},
                    "reason": {"type": "string", "maxLength": 240},
                },
                "required": ["index", "keep", "reason"],
                "additionalProperties": False,
            },
        },
        "contextDecisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "keep": {"type": "boolean"},
                    "replacementFact": {"type": "string", "maxLength": 240},
                    "reason": {"type": "string", "maxLength": 240},
                },
                "required": ["index", "keep", "replacementFact", "reason"],
                "additionalProperties": False,
            },
        },
        "uncertainties": {
            "type": "array",
            "maxItems": 8,
            "items": {"type": "string", "maxLength": 240},
        },
    },
    "required": [
        "overview",
        "stateDecisions",
        "eventDecisions",
        "participantDecisions",
        "contextDecisions",
        "uncertainties",
    ],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class PriorityRange:
    start_secs: float
    end_secs: float
    reason: str


@dataclass(frozen=True)
class ExtractionPlan:
    mode: str
    summary: str
    extraction_focus: list[str]
    use_transcript: bool
    use_ocr: bool
    use_object_detection: bool
    use_semantic_vision: bool
    use_video_embeddings: bool
    use_scene_cuts: bool
    sample_interval_secs: float
    priority_sample_interval_secs: float
    clip_window_secs: float
    frames_per_clip: int
    priority_ranges: list[PriorityRange] = field(default_factory=list)
    estimated_seconds: int = 0

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["priorityRanges"] = [
            {
                "startSecs": item.start_secs,
                "endSecs": item.end_secs,
                "reason": item.reason,
            }
            for item in self.priority_ranges
        ]
        for snake, camel in (
            ("extraction_focus", "extractionFocus"),
            ("use_transcript", "useTranscript"),
            ("use_ocr", "useOcr"),
            ("use_object_detection", "useObjectDetection"),
            ("use_semantic_vision", "useSemanticVision"),
            ("use_video_embeddings", "useVideoEmbeddings"),
            ("use_scene_cuts", "useSceneCuts"),
            ("sample_interval_secs", "sampleIntervalSecs"),
            ("priority_sample_interval_secs", "prioritySampleIntervalSecs"),
            ("clip_window_secs", "clipWindowSecs"),
            ("frames_per_clip", "framesPerClip"),
            ("estimated_seconds", "estimatedSeconds"),
        ):
            value[camel] = value.pop(snake)
        value.pop("priority_ranges", None)
        return value


@dataclass(frozen=True)
class PlannerDiagnostics:
    attempted: bool
    provider: str
    model: str
    requests: int
    latency_ms: int
    fallback: bool
    error: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "attempted": self.attempted,
            "provider": self.provider,
            "model": self.model,
            "requests": self.requests,
            "latencyMs": self.latency_ms,
            "fallback": self.fallback,
            "error": self.error,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
        }


# How much work each mode may do. The agent picks freely inside its mode's
# bounds, but the bounds themselves do not overlap in the direction that
# matters: the densest plan Fast can propose is still lighter than the
# lightest plan Balanced can, and likewise for Balanced against Thorough. That
# is what makes the three modes mean something -- with overlapping ranges a
# Fast run could legitimately come out slower than a Balanced one, which is
# what a user picking Fast is choosing against.
MODE_BOUNDS: dict[str, dict[str, tuple[float, float]]] = {
    "fast": {
        "sample": (10.0, 45.0),
        "priority": (2.5, 12.0),
        "clip": (40.0, 120.0),
        "frames": (2, 4),
    },
    "balanced": {
        "sample": (4.0, 10.0),
        "priority": (1.0, 2.5),
        "clip": (15.0, 40.0),
        "frames": (4, 6),
    },
    "thorough": {
        "sample": (1.0, 4.0),
        "priority": (0.3, 1.0),
        "clip": (6.0, 15.0),
        "frames": (6, 14),
    },
}


def normalize_mode(value: object) -> str:
    mode = str(value or "balanced").strip().lower()
    return mode if mode in {"fast", "balanced", "thorough"} else "balanced"


def fallback_plan(mode: str, duration_secs: float, has_audio: bool) -> ExtractionPlan:
    """Provider-independent safe plan used when an agent endpoint is absent."""
    normalized = normalize_mode(mode)
    # Start each mode in the middle of its own budget, so a fallback plan is
    # representative of the mode rather than its cheapest or densest extreme.
    bounds = MODE_BOUNDS[normalized]
    interval, priority_interval, clip_window = (
        sum(bounds[key]) / 2 for key in ("sample", "priority", "clip")
    )
    frames = round(sum(bounds["frames"]) / 2)
    detect, embeddings, cuts = {
        "fast": (False, False, False),
        "balanced": (True, True, False),
        "thorough": (True, True, True),
    }[normalized]
    estimate = _estimate_runtime_seconds(
        duration_secs=duration_secs,
        sample_interval_secs=interval,
        priority_sample_interval_secs=priority_interval,
        clip_window_secs=clip_window,
        frames_per_clip=frames,
        priority_ranges=[],
        use_transcript=has_audio,
        use_ocr=True,
        use_object_detection=detect,
        use_semantic_vision=True,
        use_video_embeddings=embeddings,
        use_scene_cuts=cuts,
    )
    return ExtractionPlan(
        mode=normalized,
        summary=f"Bounded {normalized} coverage with content-adaptive visual sampling.",
        extraction_focus=[
            "timestamped facts",
            "visible state changes",
            "named entities",
            "key events",
        ],
        use_transcript=has_audio,
        use_ocr=True,
        use_object_detection=detect,
        use_semantic_vision=True,
        use_video_embeddings=embeddings,
        use_scene_cuts=cuts,
        sample_interval_secs=interval,
        priority_sample_interval_secs=priority_interval,
        clip_window_secs=clip_window,
        frames_per_clip=frames,
        estimated_seconds=max(15, estimate),
    )


class AgentPlanner:
    """Calls one configured text model and validates its proposed extraction policy."""

    def __init__(self) -> None:
        self.provider = (
            os.getenv("LARKUP_VIDEO_AGENT_PROVIDER", "vercel_ai_gateway")
            .strip()
            .lower()
        )
        self.model = os.getenv("LARKUP_VIDEO_AGENT_MODEL", DEFAULT_AGENT_MODEL).strip()
        self.planner_model = os.getenv(
            "LARKUP_VIDEO_PLANNER_MODEL", self.model
        ).strip()
        shared_vision_key = (
            os.getenv("LARKUP_VIDEO_VISION_API_KEY")
            if self.provider
            == os.getenv("LARKUP_VIDEO_VISION_PROVIDER", "vercel_ai_gateway")
            .strip()
            .lower()
            else None
        )
        self.api_key = (
            os.getenv("LARKUP_VIDEO_AGENT_API_KEY")
            or shared_vision_key
            or os.getenv("AI_GATEWAY_API_KEY")
            or ""
        )
        default_url = {
            "anthropic": "https://api.anthropic.com/v1",
            "cohere": "https://api.cohere.ai/compatibility/v1",
            "deepseek": "https://api.deepseek.com",
            "google": "https://generativelanguage.googleapis.com/v1beta",
            "mistral": "https://api.mistral.ai/v1",
            "openai": "https://api.openai.com/v1",
        }.get(self.provider, DEFAULT_GATEWAY_URL)
        self.base_url = os.getenv("LARKUP_VIDEO_AGENT_BASE_URL", default_url).rstrip(
            "/"
        )
        self.enabled = os.getenv(
            "LARKUP_VIDEO_AGENT_ENABLED", "true"
        ).strip().lower() not in {
            "0",
            "false",
            "no",
            "off",
        }
        self.requests = 0
        self.latency_ms = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.last_error: str | None = None
        self.errors: list[str] = []
        self.fallback_used = False

    def plan(
        self,
        *,
        brief: dict[str, Any],
        duration_secs: float,
        width: int,
        height: int,
        fps: float,
        has_audio: bool,
        signals: dict[str, Any] | None = None,
        previous: ExtractionPlan | None = None,
        visual_samples: list[dict[str, Any]] | None = None,
    ) -> ExtractionPlan:
        fallback = previous or fallback_plan(
            str(brief.get("indexingMode")), duration_secs, has_audio
        )
        if not self.enabled or not self.api_key:
            self.last_error = "agent model is disabled or has no API key"
            self.errors.append(self.last_error)
            self.fallback_used = True
            return fallback
        prompt = _planner_prompt(
            brief=brief,
            duration_secs=duration_secs,
            width=width,
            height=height,
            fps=fps,
            has_audio=has_audio,
            signals=signals,
            previous=previous,
        )
        started = time.monotonic()
        try:
            raw, usage = self._complete(
                prompt,
                visual_samples or [],
                model_override=self.planner_model,
                # Planning has a complete deterministic fallback. Never let
                # an optional refinement hold indexing behind a slow model.
                timeout_seconds=15,
                json_schema=PLANNER_JSON_SCHEMA,
                request_attempts=1,
            )
            self.requests += 1
            self.prompt_tokens += usage.get("promptTokens", 0)
            self.completion_tokens += usage.get("completionTokens", 0)
            plan = _validated_plan(
                raw, fallback, duration_secs, bool(brief.get("skipHeavyOperators"))
            )
            self.last_error = None
            return plan
        except Exception as error:
            self.requests += 1
            self.last_error = f"{type(error).__name__}: {error}"[:500]
            self.errors.append(self.last_error)
            self.fallback_used = True
            return fallback
        finally:
            self.latency_ms += round((time.monotonic() - started) * 1_000)

    def diagnostics(self) -> PlannerDiagnostics:
        return PlannerDiagnostics(
            attempted=self.requests > 0,
            provider=self.provider,
            model=self.model,
            requests=self.requests,
            latency_ms=self.latency_ms,
            fallback=self.fallback_used,
            error=" | ".join(self.errors[-3:]) or None,
            prompt_tokens=self.prompt_tokens,
            completion_tokens=self.completion_tokens,
        )

    def synthesize_knowledge(
        self,
        *,
        brief: dict[str, Any],
        duration_secs: float,
        plan: ExtractionPlan,
        semantic_observations: list[dict[str, Any]],
        transcript: list[dict[str, Any]],
        overlay_text: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Consolidate timestamped evidence into a generic, auditable index."""
        if not self.enabled or not self.api_key:
            return _fallback_knowledge_summary(semantic_observations)
        prompt = _synthesis_prompt(
            brief=brief,
            duration_secs=duration_secs,
            plan=plan,
            semantic_observations=semantic_observations,
            transcript=transcript,
            overlay_text=overlay_text or [],
        )
        started = time.monotonic()
        try:
            last_error: Exception | None = None
            for attempt in range(2):
                self.requests += 1
                try:
                    raw, usage = self._complete(
                        (
                            prompt
                            if attempt == 0 and self.provider != "google"
                            else _synthesis_prompt(
                                brief=brief,
                                duration_secs=duration_secs,
                                plan=plan,
                                semantic_observations=semantic_observations,
                                transcript=transcript,
                                overlay_text=overlay_text or [],
                                compact=True,
                            )
                        ),
                        [],
                        max_output_tokens=10_000,
                        timeout_seconds=75,
                        json_schema=KNOWLEDGE_JSON_SCHEMA,
                        request_attempts=1,
                    )
                    self.prompt_tokens += usage.get("promptTokens", 0)
                    self.completion_tokens += usage.get("completionTokens", 0)
                    summary = _validated_knowledge_summary(raw, duration_secs)
                    if not summary["overview"] or not any(
                        summary[key]
                        for key in (
                            "participants",
                            "stateHistory",
                            "keyEvents",
                            "context",
                        )
                    ):
                        raise ValueError(
                            "agent synthesis returned no supported knowledge"
                        )
                    # The audit is a second read of the same evidence. It pays
                    # for itself only when the draft actually makes claims that
                    # can contradict each other across time -- two states, or a
                    # state plus an event that would move it.
                    if len(summary["stateHistory"]) >= 2 or (
                        summary["stateHistory"] and len(summary["keyEvents"]) >= 2
                    ):
                        try:
                            self.requests += 1
                            audit_raw, audit_usage = self._complete(
                                _consistency_audit_prompt(
                                    summary=summary,
                                    semantic_observations=semantic_observations,
                                ),
                                [],
                                max_output_tokens=3_000,
                                timeout_seconds=75,
                                json_schema=CONSISTENCY_AUDIT_JSON_SCHEMA,
                                request_attempts=1,
                            )
                            self.prompt_tokens += audit_usage.get("promptTokens", 0)
                            self.completion_tokens += audit_usage.get(
                                "completionTokens", 0
                            )
                            summary = _apply_consistency_audit(summary, audit_raw)
                        except Exception as audit_error:
                            self.errors.append(
                                f"knowledge consistency audit: {type(audit_error).__name__}: {audit_error}"[
                                    :500
                                ]
                            )
                    self.last_error = None
                    return summary
                except Exception as error:
                    last_error = error
                    # A second immediate synthesis request cannot replenish a
                    # project quota window. Fall back to the deterministic
                    # chronology now instead of making chat/indexing wait on
                    # another guaranteed rejection.
                    if "429" in str(error):
                        break
            assert last_error is not None
            raise last_error
        except Exception as error:
            self.last_error = f"{type(error).__name__}: {error}"[:500]
            self.errors.append(self.last_error)
            self.fallback_used = True
            return _fallback_knowledge_summary(semantic_observations)
        finally:
            self.latency_ms += round((time.monotonic() - started) * 1_000)

    def extract_source_inventory(
        self,
        *,
        duration_secs: float,
        transcript: list[dict[str, Any]],
        semantic_observations: list[dict[str, Any]],
        overlay_text: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        """Map every source-authored question and visible list unit in bounded time chunks."""
        fallback = _fallback_source_inventory(semantic_observations, duration_secs)
        if not self.enabled or not self.api_key:
            return fallback
        chunks = _source_inventory_chunks(
            duration_secs=duration_secs,
            transcript=transcript,
            semantic_observations=semantic_observations,
            overlay_text=overlay_text or [],
        )
        if not chunks:
            return fallback
        started = time.monotonic()
        completed: dict[int, list[dict[str, Any]]] = {}
        errors: list[str] = []
        usage_totals = {"promptTokens": 0, "completionTokens": 0}

        def map_chunk(index: int, chunk: dict[str, Any]):
            raw, usage = self._complete(
                _source_inventory_prompt(chunk),
                [],
                max_output_tokens=10_000,
                timeout_seconds=30,
                json_schema=SOURCE_INVENTORY_JSON_SCHEMA,
                request_attempts=1,
            )
            return index, _validated_source_inventory(raw, duration_secs, chunk), usage

        try:
            # These requests contain disjoint time ranges and are independent.
            # Four concurrent maps keep an hour-long source to one short wave.
            with ThreadPoolExecutor(max_workers=min(4, len(chunks))) as executor:
                futures = {
                    executor.submit(map_chunk, index, chunk): index
                    for index, chunk in enumerate(chunks)
                }
                for future in as_completed(futures):
                    self.requests += 1
                    try:
                        index, items, usage = future.result()
                        completed[index] = items
                        usage_totals["promptTokens"] += usage.get("promptTokens", 0)
                        usage_totals["completionTokens"] += usage.get("completionTokens", 0)
                    except Exception as error:
                        errors.append(
                            f"source inventory chunk {futures[future]}: "
                            f"{type(error).__name__}: {error}"[:500]
                        )
            self.prompt_tokens += usage_totals["promptTokens"]
            self.completion_tokens += usage_totals["completionTokens"]
            if errors:
                self.errors.extend(errors[-3:])
            return _merge_source_inventory(
                fallback,
                *[completed[index] for index in sorted(completed)],
            )
        finally:
            self.latency_ms += round((time.monotonic() - started) * 1_000)

    def _complete(
        self,
        prompt: str,
        visual_samples: list[dict[str, Any]],
        max_output_tokens: int = 1_400,
        timeout_seconds: int = 60,
        json_schema: dict[str, Any] | None = None,
        request_attempts: int = 2,
        model_override: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, int]]:
        configured_model = model_override or self.model
        if self.provider == "google":
            model = (
                configured_model.split("/", 1)[1]
                if configured_model.startswith("google/")
                else configured_model
            )
            parts: list[dict[str, Any]] = [{"text": prompt}]
            for sample in visual_samples[:6]:
                data_url = str(sample.get("dataUrl") or "")
                if "," not in data_url:
                    continue
                header, encoded = data_url.split(",", 1)
                parts.extend(
                    [
                        {
                            "text": f"SCOUT FRAME @ {round(float(sample.get('timeMs') or 0))}ms"
                        },
                        {
                            "inline_data": {
                                "mime_type": (
                                    "image/jpeg"
                                    if "image/jpeg" in header
                                    else "image/png"
                                ),
                                "data": encoded,
                            }
                        },
                    ]
                )
            generation_config: dict[str, Any] = {
                "maxOutputTokens": max_output_tokens,
                "responseMimeType": "application/json",
            }
            if model.startswith("gemini-3"):
                thinking_level = (
                    os.getenv("LARKUP_VIDEO_AGENT_THINKING_LEVEL", "minimal")
                    .strip()
                    .lower()
                )
                if thinking_level not in {"minimal", "low", "medium", "high"}:
                    thinking_level = "minimal"
                generation_config["thinkingConfig"] = {"thinkingLevel": thinking_level}
            else:
                generation_config["temperature"] = 0
            if json_schema is not None:
                generation_config["responseSchema"] = _google_response_schema(
                    json_schema
                )
            response = _post_agent_request(
                f"{self.base_url}/models/{model}:generateContent",
                headers={
                    "x-goog-api-key": self.api_key,
                    "Content-Type": "application/json",
                },
                payload={
                    "contents": [{"role": "user", "parts": parts}],
                    "generationConfig": generation_config,
                },
                timeout_seconds=timeout_seconds,
                attempts=request_attempts,
            )
            if not response.ok:
                raise RuntimeError(
                    f"agent provider returned {response.status_code}: {response.text[:240]}"
                )
            payload = response.json()
            candidate = payload["candidates"][0]
            if candidate.get("finishReason") == "MAX_TOKENS":
                raise RuntimeError("agent response reached its output limit")
            text = "\n".join(
                str(part.get("text") or "")
                for part in candidate["content"]["parts"]
                if not part.get("thought")
            )
            metadata = payload.get("usageMetadata") or {}
            usage = {
                "promptTokens": int(metadata.get("promptTokenCount") or 0),
                "completionTokens": int(metadata.get("candidatesTokenCount") or 0),
            }
            return _json_object(text), usage

        model = configured_model
        if model.startswith(f"{self.provider}/"):
            model = model.split("/", 1)[1]
        if self.provider == "anthropic":
            content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
            for sample in visual_samples[:6]:
                data_url = str(sample.get("dataUrl") or "")
                if "," not in data_url:
                    continue
                header, encoded = data_url.split(",", 1)
                content.extend(
                    [
                        {
                            "type": "text",
                            "text": f"SCOUT FRAME @ {round(float(sample.get('timeMs') or 0))}ms",
                        },
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": (
                                    "image/jpeg" if "image/jpeg" in header else "image/png"
                                ),
                                "data": encoded,
                            },
                        },
                    ]
                )
            response = _post_agent_request(
                f"{self.base_url}/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                payload={
                    "model": model,
                    "temperature": 0,
                    "max_tokens": max_output_tokens,
                    "messages": [{"role": "user", "content": content}],
                },
                timeout_seconds=timeout_seconds,
                attempts=request_attempts,
            )
            if not response.ok:
                raise RuntimeError(
                    f"agent provider returned {response.status_code}: {response.text[:240]}"
                )
            payload = response.json()
            usage_payload = payload.get("usage") or {}
            usage = {
                "promptTokens": int(usage_payload.get("input_tokens") or 0),
                "completionTokens": int(usage_payload.get("output_tokens") or 0),
            }
            text = "\n".join(
                str(item.get("text") or "")
                for item in payload.get("content") or []
                if isinstance(item, dict) and item.get("type") == "text"
            )
            return _json_object(text), usage

        content: str | list[dict[str, Any]] = prompt
        if visual_samples:
            content = [{"type": "text", "text": prompt}]
            for sample in visual_samples[:6]:
                content.extend(
                    [
                        {
                            "type": "text",
                            "text": f"SCOUT FRAME @ {round(float(sample.get('timeMs') or 0))}ms",
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": str(sample.get("dataUrl") or "")},
                        },
                    ]
                )
        request_payload: dict[str, Any] = {
            "model": model,
            "temperature": 0,
            "max_tokens": max_output_tokens,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": content}],
        }
        if self.provider == "vercel_ai_gateway":
            request_payload["reasoning"] = {"effort": "minimal"}
        if json_schema is not None and self.provider in {"openai", "vercel_ai_gateway"}:
            request_payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "video_knowledge_index",
                    "strict": True,
                    "schema": json_schema,
                },
            }
        response = _post_agent_request(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            payload=request_payload,
            timeout_seconds=timeout_seconds,
            attempts=request_attempts,
        )
        if not response.ok:
            raise RuntimeError(
                f"agent provider returned {response.status_code}: {response.text[:240]}"
            )
        payload = response.json()
        usage_payload = payload.get("usage") or {}
        usage = {
            "promptTokens": int(
                usage_payload.get("prompt_tokens")
                or usage_payload.get("input_tokens")
                or 0
            ),
            "completionTokens": int(
                usage_payload.get("completion_tokens")
                or usage_payload.get("output_tokens")
                or 0
            ),
        }
        choice = payload["choices"][0]
        if choice.get("finish_reason") == "length":
            raise RuntimeError("agent response reached its output limit")
        message_content = choice["message"]["content"]
        if isinstance(message_content, list):
            message_content = "\n".join(
                str(item.get("text") or "")
                for item in message_content
                if isinstance(item, dict)
            )
        return _json_object(str(message_content)), usage


def _planner_prompt(
    *,
    brief: dict[str, Any],
    duration_secs: float,
    width: int,
    height: int,
    fps: float,
    has_audio: bool,
    signals: dict[str, Any] | None,
    previous: ExtractionPlan | None,
) -> str:
    mode = normalize_mode(brief.get("indexingMode"))
    payload = {
        "requestedMode": mode,
        "userHint": str(brief.get("goal") or "")[:2000],
        "knownEntities": list(brief.get("knownEntities") or [])[:50],
        "expectedQuestions": list(brief.get("expectedQuestions") or [])[:20],
        "video": {
            "durationSecs": round(duration_secs, 3),
            "width": width,
            "height": height,
            "fps": round(fps, 3),
            "hasAudio": has_audio,
        },
        "signals": signals or {},
        "previousPlan": previous.to_dict() if previous else None,
    }
    return (
        "You are the bounded planning brain for a general-purpose video indexer. "
        "Choose what evidence services should run and where denser sampling is justified. "
        "Use only the supplied source metadata, user hint, chronological scout signals, OCR snippets, "
        "timestamped transcript excerpts, and any attached timestamped scout frames. Never assume a "
        "content genre, invent entities, or encode "
        "domain-specific rules. Maintain coarse coverage across the entire requested source; priorityRanges "
        "only add density around source-supported moments. Fast favors latency, Balanced favors useful recall, "
        "and Thorough favors accuracy. Disable a service when it cannot materially help the requested goal. "
        "Return JSON only with: summary (string), extractionFocus (array of short strings), useTranscript, "
        "useOcr, useObjectDetection, useSemanticVision, useVideoEmbeddings, useSceneCuts (booleans), "
        "sampleIntervalSecs, prioritySampleIntervalSecs, clipWindowSecs, framesPerClip "
        "(numbers), and priorityRanges (array of {startSecs,endSecs,reason}). Keep at most 12 ranges and "
        "do not include a range unless a supplied timestamped signal supports it. Keep summary under "
        "30 words and extractionFocus at 8 items or fewer.\nINPUT:\n"
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    )


def _evenly_spaced(items: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if limit <= 0 or not items:
        return []
    if len(items) <= limit:
        return list(items)
    if limit == 1:
        return [items[0]]
    step = (len(items) - 1) / (limit - 1)
    return [items[round(index * step)] for index in range(limit)]


def _select_synthesis_observations(
    observations: list[dict[str, Any]],
    overlay_text: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    """Keep chronological coverage plus the moments where the source changes.

    Both ends of the source are always represented. Beyond that, a moment
    where a persistent on-screen overlay first appeared or last disappeared
    is where something in the video changed, whatever the video is about, so
    those observations survive the budget ahead of an even sample.
    """
    if len(observations) <= limit:
        return list(observations)
    change_times = [
        time_ms
        for overlay in overlay_text
        for time_ms in (
            int(overlay.get("firstSeenMs") or 0),
            int(overlay.get("lastSeenMs") or 0),
        )
    ]
    boundary_width = min(3, len(observations))
    priority_indexes = [
        *range(boundary_width),
        *range(len(observations) - boundary_width, len(observations)),
    ]
    for index, item in enumerate(observations):
        start_ms = int(item.get("startMs") or 0)
        end_ms = int(item.get("endMs") or start_ms)
        if any(
            end_ms >= time_ms - 2_000 and start_ms <= time_ms + 2_000
            for time_ms in change_times
        ):
            priority_indexes.append(index)
    priority_indexes = list(dict.fromkeys(priority_indexes))
    if len(priority_indexes) > limit:
        sampled_priority = _evenly_spaced(
            [{"index": index} for index in priority_indexes], limit
        )
        selected_indexes = {int(item["index"]) for item in sampled_priority}
    else:
        selected_indexes = set(priority_indexes)
        remaining = limit - len(selected_indexes)
        sampled_all = _evenly_spaced(
            [{"index": index} for index in range(len(observations))],
            min(len(observations), max(remaining * 2, remaining)),
        )
        for item in sampled_all:
            selected_indexes.add(int(item["index"]))
            if len(selected_indexes) >= limit:
                break
    return [observations[index] for index in sorted(selected_indexes)]


def _source_inventory_chunks(
    *,
    duration_secs: float,
    transcript: list[dict[str, Any]],
    semantic_observations: list[dict[str, Any]],
    overlay_text: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    window_ms = 15 * 60 * 1_000
    duration_ms = max(1, round(duration_secs * 1_000))
    chunks: list[dict[str, Any]] = []
    for start_ms in range(0, duration_ms, window_ms):
        end_ms = min(duration_ms, start_ms + window_ms)

        def timed(items: list[dict[str, Any]], text_limit: int):
            selected: list[dict[str, Any]] = []
            for item in items:
                item_start = round(float(item.get("startMs") or 0))
                item_end = round(float(item.get("endMs") or item_start))
                text = str(item.get("text") or "").strip()[:text_limit]
                if text and item_start < end_ms and item_end >= start_ms:
                    selected.append(
                        {"startMs": item_start, "endMs": item_end, "text": text}
                    )
            return selected

        visible = timed(
            [
                {
                    **item,
                    # Claim fields describe the indexing task supplied to the
                    # analyzer. They are not source-authored content and must
                    # never be offered to the source-inventory mapper.
                    "text": "\n".join(
                        line
                        for line in str(item.get("text") or "").splitlines()
                        if not re.match(
                            r"^Claim (?:question|verdict|answer|bindings):",
                            line.strip(),
                            re.I,
                        )
                    ),
                }
                for item in semantic_observations
            ],
            2_000,
        )
        spoken = timed(transcript, 500)
        recurring = [
            {
                "startMs": round(float(item.get("firstSeenMs") or 0)),
                "endMs": round(float(item.get("lastSeenMs") or 0)),
                "text": str(item.get("text") or "").strip()[:300],
            }
            for item in overlay_text
            if str(item.get("text") or "").strip()
            and float(item.get("firstSeenMs") or 0) < end_ms
            and float(item.get("lastSeenMs") or 0) >= start_ms
        ]
        if spoken or visible or recurring:
            chunks.append(
                {
                    "range": {"startMs": start_ms, "endMs": end_ms},
                    "spokenEvidence": spoken,
                    "visibleEvidence": visible,
                    "recurringVisibleText": recurring,
                }
            )
    return chunks


def _source_inventory_prompt(chunk: dict[str, Any]) -> str:
    return (
        "Create an exhaustive inventory of discrete source-authored units in this timestamped "
        "portion of a recording. The source can be any kind of recording. Extract only: questions "
        "actually asked by a speaker or visibly written; headings or titles; individual slide, "
        "board, or explicitly enumerated list items. Do not turn ordinary narration, conversation, "
        "descriptions, model instructions, or analysis prompts into inventory items. Preserve the "
        "source language and wording. For a spoken question, start at the actual interrogative or "
        "request and omit surrounding banter, answers, and reactions. If a nearby source passage "
        "explicitly answers a question, "
        "copy the answer; otherwise use an empty answer. Give the narrowest supplied timestamp "
        "that supports each item. A recurring header is one item in this portion, while separate "
        "questions or differently worded items remain separate. Never infer missing words or add "
        "outside facts. Return JSON only: {items:[{kind:'question'|'heading'|'slide-item'|"
        "'board-item'|'list-item',channel:'spoken'|'visible',text:string,answer:string,"
        "startMs:number,endMs:number}]}.\nINPUT:\n"
        + json.dumps(chunk, ensure_ascii=False, separators=(",", ":"))
    )


def _inventory_terms(value: str) -> list[str]:
    return re.findall(r"[\w\u0600-\u06ff]+", value.casefold(), re.UNICODE)


def _looks_like_spoken_question(value: str) -> bool:
    text = value.strip()
    if re.search(r"[?؟]\s*$", text):
        return True
    cue = re.compile(
        r"^(?:who|what|when|where|why|how|which|whose|whom|is|are|was|were|do|does|did|"
        r"can|could|would|will|name|list|identify|describe|tell|give|"
        r"من|ما|ماذا|متى|أين|اين|كيف|كم|هل|أي|اي|لماذا|مين|إيه|ايه|فين|امتى|ازاي|"
        r"اذكر|أذكر|حدد|سم|سمي)$",
        re.I,
    )
    return any(cue.match(term) for term in _inventory_terms(text)[:4])


def _inventory_item_is_grounded(
    item: dict[str, Any], source_chunk: dict[str, Any]
) -> bool:
    channel = item["channel"]
    source_key = "spokenEvidence" if channel == "spoken" else "visibleEvidence"
    candidate_terms = _inventory_terms(item["text"])
    if not candidate_terms:
        return False
    start_ms = item["startMs"]
    end_ms = item["endMs"]
    nearby = [
        source
        for source in source_chunk.get(source_key) or []
        if float(source.get("startMs") or 0) <= end_ms + 5_000
        and float(source.get("endMs") or source.get("startMs") or 0)
        >= start_ms - 5_000
    ]
    if not nearby:
        nearby = source_chunk.get(source_key) or []
    source_terms = set(
        _inventory_terms(" ".join(str(source.get("text") or "") for source in nearby))
    )
    matched = sum(1 for term in candidate_terms if term in source_terms)
    return matched / len(candidate_terms) >= 0.7


def _validated_source_inventory(
    raw: dict[str, Any],
    duration_secs: float,
    source_chunk: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    duration_ms = max(1, round(duration_secs * 1_000))
    allowed_kinds = {"question", "heading", "slide-item", "board-item", "list-item"}
    allowed_channels = {"spoken", "visible"}
    items: list[dict[str, Any]] = []
    for candidate in raw.get("items") or []:
        if not isinstance(candidate, dict):
            continue
        kind = str(candidate.get("kind") or "").strip()
        channel = str(candidate.get("channel") or "").strip()
        text = str(candidate.get("text") or "").strip()[:600]
        if kind not in allowed_kinds or channel not in allowed_channels or not text:
            continue
        try:
            start_ms = min(
                duration_ms, max(0, round(float(candidate.get("startMs"))))
            )
            end_ms = min(
                duration_ms,
                max(start_ms, round(float(candidate.get("endMs")))),
            )
        except (TypeError, ValueError):
            continue
        item = {
            "kind": kind,
            "channel": channel,
            "text": text,
            "answer": str(candidate.get("answer") or "").strip()[:600],
            "startMs": start_ms,
            "endMs": end_ms,
        }
        if kind == "question" and channel == "spoken" and not _looks_like_spoken_question(text):
            continue
        if source_chunk is not None and not _inventory_item_is_grounded(item, source_chunk):
            continue
        items.append(item)
    return items


def _fallback_source_inventory(
    semantic_observations: list[dict[str, Any]], duration_secs: float
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for observation in semantic_observations:
        lines = str(observation.get("text") or "").splitlines()
        for index, line in enumerate(lines):
            match = re.match(
                r"^Source question \((spoken|visible)\):\s*(.+)$", line.strip(), re.I
            )
            if not match:
                continue
            answer_match = (
                re.match(r"^Source answer:\s*(.*)$", lines[index + 1].strip(), re.I)
                if index + 1 < len(lines)
                else None
            )
            items.append(
                {
                    "kind": "question",
                    "channel": match.group(1).lower(),
                    "text": match.group(2).strip()[:600],
                    "answer": (answer_match.group(1).strip()[:600] if answer_match else ""),
                    "startMs": observation.get("startMs") or 0,
                    "endMs": observation.get("endMs") or observation.get("startMs") or 0,
                }
            )
    return _validated_source_inventory({"items": items}, duration_secs)


def _merge_source_inventory(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()
    for item in sorted(
        (item for group in groups for item in group),
        key=lambda value: (value["startMs"], value["endMs"], value["kind"]),
    ):
        normalized = re.sub(r"\s+", " ", item["text"].casefold()).strip()
        key = (item["kind"], normalized, round(item["startMs"] / 5_000))
        if not normalized or key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged[:2_000]


def _synthesis_prompt(
    *,
    brief: dict[str, Any],
    duration_secs: float,
    plan: ExtractionPlan,
    semantic_observations: list[dict[str, Any]],
    transcript: list[dict[str, Any]],
    overlay_text: list[dict[str, Any]],
    compact: bool = False,
) -> str:
    observation_limit = 28 if compact else 160
    transcript_limit = 32 if compact else 160
    selected_observations = _select_synthesis_observations(
        semantic_observations,
        overlay_text,
        observation_limit,
    )
    # A note leads with what happened and ends with the readings and events
    # that support it. Truncating it mid-way keeps the narration and discards
    # exactly the timestamped specifics the index is built to preserve.
    evidence = [
        {
            "startMs": round(float(item.get("startMs") or 0)),
            "endMs": round(float(item.get("endMs") or 0)),
            "text": str(item.get("text") or "")[: 700 if compact else 2_000],
        }
        for item in selected_observations
        if str(item.get("text") or "").strip()
    ]
    transcript_signal = [
        {
            "startMs": round(float(item.get("startMs") or 0)),
            "endMs": round(float(item.get("endMs") or 0)),
            "text": str(item.get("text") or "")[: 180 if compact else 300],
        }
        for item in _evenly_spaced(transcript, transcript_limit)
        if str(item.get("text") or "").strip()
    ]
    coverage_scale = max(1, min(8, round(duration_secs / (15 * 60))))
    participant_limit = 12 if compact else min(64, max(12, coverage_scale * 8))
    state_limit = 8 if compact else min(32, max(8, coverage_scale * 4))
    event_limit = 14 if compact else min(64, max(14, coverage_scale * 8))
    narrative_limit = 10 if compact else min(48, max(12, coverage_scale * 6))
    context_limit = 8 if compact else min(32, max(8, coverage_scale * 4))
    uncertainty_limit = 8 if compact else min(16, max(8, coverage_scale * 2))
    payload = {
        "durationMs": round(duration_secs * 1_000),
        "goal": str(brief.get("goal") or "")[:2_000],
        "questions": list(brief.get("expectedQuestions") or [])[:20],
        "extractionFocus": plan.extraction_focus,
        "sourceLanguage": str(
            brief.get("detectedLanguage") or brief.get("language") or "auto"
        )[:32],
        "semanticEvidence": evidence,
        "transcriptEvidence": transcript_signal,
        "recurringOnScreenText": [
            {
                "text": str(item.get("text") or "")[:120],
                "firstSeenMs": int(item.get("firstSeenMs") or 0),
                "lastSeenMs": int(item.get("lastSeenMs") or 0),
                "observations": int(item.get("observations") or 0),
            }
            for item in overlay_text[:60]
        ],
    }
    return (
        "Build a video knowledge index from timestamped evidence, so that someone who never saw "
        "the video can answer questions about it. The video may be of any kind; infer nothing from "
        "its subject matter and add no facts from outside the supplied evidence.\n"
        "Rules:\n"
        "- Every participant, state, event, and context fact must cite at least one supplied source range.\n"
        "- Write what the evidence establishes, in the evidence's own terms. Where two observations "
        "disagree, prefer the one that repeats across separate source ranges, and record the "
        "disagreement in uncertainties rather than choosing one silently.\n"
        "- The evidence records what it observed as lines: a note, 'Present: <name> — <what> "
        "(identified by <what established it>)', 'On screen: <exact text> — <what it conveys>', and "
        "'Happened: <event>'. A 'Present:' line that carries an 'identified by' clause has already "
        "established that identity from the source; use the name. Do not name anyone the evidence "
        "did not name, and never infer an identity from appearance, a number, a role, or outside "
        "knowledge.\n"
        "- Context facts may preserve a directly visible distinction between multiple otherwise unnamed "
        "subjects (such as position, a visible attribute, or a stated role), with their source range. "
        "Use a stable descriptor from the evidence; never invent a name to make the distinction useful.\n"
        "- A later close-up, label, caption, presentation, celebration, or reaction does not identify "
        "who performed an earlier action. Bind the name to that earlier actor only when an uninterrupted "
        "sequence tracks the same subject or the supplied evidence explicitly states the relationship.\n"
        "- stateHistory tracks things that persist and change: a displayed value, a location, a phase, "
        "a condition. Record each distinct value once with the span it held, and keep the sequence "
        "self-consistent -- one thing cannot hold two values at the same time, and a value it never "
        "reached cannot appear between two values it did.\n"
        "- Edited video re-shows moments: a recap, a repeat, an inset, a slowed-down retake, a preview of "
        "something still to come. Evidence from a re-shown moment describes when it originally happened, "
        "not the point in the video where it appears. When a later observation shows the earlier state "
        "still holding, the apparent change was a re-showing, and it belongs in neither the ledger nor "
        "the events.\n"
        "- keyEvents are moments something happened. Include one when the evidence shows it, and say what "
        "the evidence shows rather than what it implies. An event that would move a tracked value belongs "
        "here only when the ledger actually moves to that value and stays there.\n"
        "- narrative is the human notebook: a compact, continuous chronological account that combines "
        "the synchronized speech, named participants, visual layout, appearance, on-screen labels, states, "
        "and events. Each entry must make sense after the preceding entry, so preserve who is on which side "
        "or in which group and carry that identity forward only while the evidence supports it. Replace vague "
        "descriptions such as 'two people discuss something' with the supported names, relationships, and "
        "purpose available anywhere in the supplied evidence. Do not invent a bridge across an edit. Write "
        "narrative text in the dominant spoken language identified by sourceLanguage (or the dominant language "
        "of transcriptEvidence when it is auto), while preserving names and exact on-screen text as supplied. "
        "Do not repeatedly say 'the video shows' or describe the act of analysis.\n"
        "- recurringOnScreenText lists short text that stayed legible across several frames. It marks "
        "where a display existed and when it changed. It never states what that text means: use it to "
        "corroborate or locate, never as a fact on its own.\n"
        "Return JSON only: {overview:string, participants:[{name,role,evidence:[{startMs,endMs}]}], "
        "stateHistory:[{startMs,endMs,state,confidence:'direct'|'partial'}], "
        "keyEvents:[{startMs,endMs,event,confidence:'direct'|'partial'}], "
        "narrative:[{startMs,endMs,text,confidence:'direct'|'partial'}], "
        "context:[{fact,evidence:[{startMs,endMs}]}], uncertainties:[string]}. "
        "Use 'direct' when the cited evidence states it outright and 'partial' when it is inferred from "
        "context. Deduplicate, keep chronological order, and cover the whole supplied span rather than "
        "clustering on one part of it. Stay within "
        f"{participant_limit} participants, {state_limit} states, {event_limit} events, "
        f"{narrative_limit} narrative entries, "
        f"{context_limit} context facts, and {uncertainty_limit} uncertainties, each under 20 words.\n"
        "INPUT:\n" + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    )


def _consistency_audit_prompt(
    *,
    summary: dict[str, Any],
    semantic_observations: list[dict[str, Any]],
) -> str:
    cited_ranges: list[tuple[int, int]] = []
    for event in summary.get("keyEvents") or []:
        cited_ranges.append(
            (int(event.get("startMs") or 0), int(event.get("endMs") or 0))
        )
    for participant in summary.get("participants") or []:
        for source_range in participant.get("evidence") or []:
            cited_ranges.append(
                (
                    int(source_range.get("startMs") or 0),
                    int(source_range.get("endMs") or 0),
                )
            )
    for state in summary.get("stateHistory") or []:
        cited_ranges.append(
            (int(state.get("startMs") or 0), int(state.get("endMs") or 0))
        )
    for context in summary.get("context") or []:
        for source_range in context.get("evidence") or []:
            cited_ranges.append(
                (
                    int(source_range.get("startMs") or 0),
                    int(source_range.get("endMs") or 0),
                )
            )
    focused_evidence = []
    for item in semantic_observations[:160]:
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        start_ms = round(float(item.get("startMs") or 0))
        end_ms = round(float(item.get("endMs") or 0))
        if cited_ranges and not any(
            end_ms >= cited_start - 2_000 and start_ms <= cited_end + 2_000
            for cited_start, cited_end in cited_ranges
        ):
            continue
        focused_evidence.append(
            # The audit judges claims against these notes, so it needs the
            # readings and events a note ends with, not only its narration.
            {"startMs": start_ms, "endMs": end_ms, "text": text[:1_400]}
        )
    focused_evidence = _select_synthesis_observations(focused_evidence, [], 24)
    return (
        "A draft index was written from the video evidence below. Check each of its claims against that "
        "evidence and say which survive. This is a consistency check on any kind of video; infer nothing "
        "from the subject matter and add no facts.\n"
        "Return one decision for every candidate index in every category.\n"
        "Keep a claim when the cited evidence states it. Drop it when the evidence only suggests it, when "
        "it contradicts other evidence at a different time, or when it is not in the evidence at all.\n"
        "Read candidateStates as one sequence and make it coherent before judging anything else. A thing "
        "that persists holds one value at a time and moves between values in an order the evidence "
        "supports. Where the sequence doubles back -- a value appears, changes, then the earlier value is "
        "shown again later -- the odd one out came from a moment the video re-showed (a recap, repeat, "
        "inset, or preview), not from the state changing twice. Drop the interloper and keep the "
        "sequence the later, settled evidence supports.\n"
        "- stateDecisions: when keep=true, replacementState may restate the claim more precisely in the "
        "evidence's own words; leave it empty to keep the original wording. neutralState restates the same "
        "observation with no entity attributed to it, for use when the evidence shows the value but not "
        "whose it is. Set entityMappingSupported=true only when the evidence itself attaches that value to "
        "that entity; when it does not, the neutral wording is used instead.\n"
        "- eventDecisions: keep an event when the evidence shows it happening. Drop it when only its "
        "aftermath, a reaction, or a later mention is present, or when a later observation shows the "
        "situation unchanged.\n"
        "- participantDecisions: keep a name where the evidence names that person -- a 'Present:' "
        "line whose 'identified by' clause cites source text or speech has already established it, "
        "and dropping such a name loses a fact the source actually stated. Drop a name the evidence "
        "only implies: appearance, a number, a role, or outside knowledge never establishes "
        "identity, and a later label, close-up, presentation, or reaction never retroactively "
        "identifies the performer of an earlier action without uninterrupted tracking or an "
        "explicit relationship in the supplied evidence.\n"
        "- contextDecisions: a fact may describe only what its cited ranges show. replacementFact narrows "
        "an overreaching one; an empty replacement keeps the original.\n"
        "Rewrite the overview so it agrees with what survived, and add concise uncertainties for what was "
        "dropped. Return JSON only as "
        "{overview:string,stateDecisions:[{index,keep,replacementState,neutralState,entityMappingSupported,reason}],"
        "eventDecisions:[{index,keep,reason}],participantDecisions:[{index,keep,reason}],"
        "contextDecisions:[{index,keep,replacementFact,reason}],uncertainties:[string]}.\nINPUT:\n"
        + json.dumps(
            {
                "candidateStates": summary.get("stateHistory") or [],
                "candidateEvents": summary.get("keyEvents") or [],
                "candidateParticipants": summary.get("participants") or [],
                "candidateContext": summary.get("context") or [],
                "draftOverview": summary.get("overview") or "",
                "draftUncertainties": summary.get("uncertainties") or [],
                "candidateEvidence": focused_evidence,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )


def _apply_consistency_audit(
    summary: dict[str, Any], audit: dict[str, Any]
) -> dict[str, Any]:
    state_decisions = {
        item.get("index"): item
        for item in audit.get("stateDecisions") or []
        if isinstance(item, dict) and isinstance(item.get("index"), int)
    }
    event_decisions = {
        item.get("index"): item.get("keep") is True
        for item in audit.get("eventDecisions") or []
        if isinstance(item, dict) and isinstance(item.get("index"), int)
    }
    participant_decisions = {
        item.get("index"): item.get("keep") is True
        for item in audit.get("participantDecisions") or []
        if isinstance(item, dict) and isinstance(item.get("index"), int)
    }
    context_decisions = {
        item.get("index"): item
        for item in audit.get("contextDecisions") or []
        if isinstance(item, dict) and isinstance(item.get("index"), int)
    }
    states = list(summary.get("stateHistory") or [])
    events = list(summary.get("keyEvents") or [])
    participants = list(summary.get("participants") or [])
    context = list(summary.get("context") or [])
    # A partial audit is not authoritative. Apply a category only when every
    # candidate received an explicit decision.
    if set(event_decisions) == set(range(len(events))):
        summary["keyEvents"] = [
            item
            for index, item in enumerate(events)
            if event_decisions.get(index, False)
        ]
    if set(participant_decisions) == set(range(len(participants))):
        summary["participants"] = [
            item
            for index, item in enumerate(participants)
            if participant_decisions.get(index, False)
        ]
    if set(state_decisions) == set(range(len(states))):
        audited_states = []
        for index, item in enumerate(states):
            decision = state_decisions[index]
            if decision.get("keep") is not True:
                continue
            # An attributed state ("X is at 3") is far more useful than a
            # neutral one ("the value is 3"), so it is kept whenever the
            # auditor confirms the evidence itself makes that attribution.
            # The neutral wording is the fallback for when it does not.
            attributed = str(decision.get("replacementState") or "").strip()[:500]
            neutral = str(decision.get("neutralState") or "").strip()[:500]
            replacement = (
                attributed
                if decision.get("entityMappingSupported") is True and attributed
                else neutral or str(item.get("state") or "").strip()[:500]
            )
            if not replacement:
                continue
            if (
                audited_states
                and audited_states[-1]["state"].casefold() == replacement.casefold()
            ):
                audited_states[-1]["endMs"] = max(
                    audited_states[-1]["endMs"], item["endMs"]
                )
                if item.get("confidence") != "direct":
                    audited_states[-1]["confidence"] = "partial"
                continue
            audited_states.append({**item, "state": replacement})
        summary["stateHistory"] = audited_states
    if set(context_decisions) == set(range(len(context))):
        audited_context = []
        for index, item in enumerate(context):
            decision = context_decisions[index]
            if decision.get("keep") is not True:
                continue
            replacement = str(decision.get("replacementFact") or "").strip()[:500]
            audited_context.append({**item, "fact": replacement or item["fact"]})
        summary["context"] = audited_context
    audited_overview = str(audit.get("overview") or "").strip()[:2_000]
    if audited_overview:
        summary["overview"] = audited_overview
    extra_uncertainties = [
        str(item).strip()[:500]
        for item in audit.get("uncertainties") or []
        if str(item).strip()
    ]
    summary["uncertainties"] = list(
        dict.fromkeys([*(summary.get("uncertainties") or []), *extra_uncertainties])
    )[:40]
    return summary


def _validated_knowledge_summary(
    raw: dict[str, Any], duration_secs: float
) -> dict[str, Any]:
    duration_ms = max(1, round(duration_secs * 1_000))

    def source_range(value: Any) -> dict[str, int] | None:
        if not isinstance(value, dict):
            return None
        try:
            start = min(duration_ms, max(0, round(float(value.get("startMs")))))
            end = min(duration_ms, max(start, round(float(value.get("endMs")))))
        except (TypeError, ValueError):
            return None
        return {"startMs": start, "endMs": end}

    def ranges(value: Any) -> list[dict[str, int]]:
        return [
            item for candidate in (value or []) if (item := source_range(candidate))
        ][:12]

    participants: list[dict[str, Any]] = []
    for candidate in raw.get("participants") or []:
        if not isinstance(candidate, dict):
            continue
        name = str(candidate.get("name") or "").strip()[:160]
        evidence = ranges(candidate.get("evidence"))
        if name and evidence:
            participants.append(
                {
                    "name": name,
                    "role": str(candidate.get("role") or "participant").strip()[:200],
                    "evidence": evidence,
                }
            )
        if len(participants) == 50:
            break

    def timeline(key: str, text_key: str, limit: int) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for candidate in raw.get(key) or []:
            if not isinstance(candidate, dict):
                continue
            evidence = source_range(candidate)
            text = str(candidate.get(text_key) or "").strip()[:500]
            if not evidence or not text:
                continue
            items.append(
                {
                    **evidence,
                    text_key: text,
                    "confidence": (
                        candidate.get("confidence")
                        if candidate.get("confidence") in {"direct", "partial"}
                        else "partial"
                    ),
                }
            )
            if len(items) == limit:
                break
        return sorted(items, key=lambda item: (item["startMs"], item["endMs"]))

    context: list[dict[str, Any]] = []
    for candidate in raw.get("context") or []:
        if not isinstance(candidate, dict):
            continue
        fact = str(candidate.get("fact") or "").strip()[:500]
        evidence = ranges(candidate.get("evidence"))
        if fact and evidence:
            context.append({"fact": fact, "evidence": evidence})
        if len(context) == 40:
            break
    uncertainties = [
        str(item).strip()[:500]
        for item in raw.get("uncertainties") or []
        if str(item).strip()
    ][:40]
    return {
        "overview": str(raw.get("overview") or "").strip()[:2_000],
        "participants": participants,
        "stateHistory": timeline("stateHistory", "state", 80),
        "keyEvents": timeline("keyEvents", "event", 80),
        "narrative": timeline("narrative", "text", 64),
        "context": context,
        "uncertainties": uncertainties,
    }


def _fallback_knowledge_summary(
    semantic_observations: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a useful deterministic chronology when optional model synthesis fails."""
    ordered = sorted(
        semantic_observations,
        key=lambda item: (float(item.get("startMs") or 0), float(item.get("endMs") or 0)),
    )
    key_events: list[dict[str, Any]] = []
    narrative: list[dict[str, Any]] = []
    participants_by_name: dict[str, dict[str, Any]] = {}
    state_history: list[dict[str, Any]] = []
    context_by_fact: dict[str, dict[str, Any]] = {}
    uncertainties: list[str] = []

    for item in ordered[:80]:
        start_ms = round(float(item.get("startMs") or 0))
        end_ms = round(float(item.get("endMs") or start_ms))
        lines = [line.strip() for line in str(item.get("text") or "").splitlines() if line.strip()]
        if not lines:
            continue
        key_events.append(
            {
                "startMs": start_ms,
                "endMs": end_ms,
                "event": lines[0][:500],
                "confidence": "partial",
            }
        )
        narrative.append(
            {
                "startMs": start_ms,
                "endMs": end_ms,
                "text": lines[0][:500],
                "confidence": "partial",
            }
        )
        evidence = {"startMs": start_ms, "endMs": end_ms}
        for line in lines[1:]:
            participant = re.match(r"^Present:\s*(.+?)\s+—\s+(.+)$", line)
            if participant:
                name = participant.group(1).strip()[:160]
                role = re.sub(r"\s*\(identified by.*$", "", participant.group(2)).strip()[:200]
                if name and role and any(
                    token in role.casefold()
                    for token in ("person", "participant", "host", "man", "woman", "individual", "speaker")
                ):
                    key = name.casefold()
                    existing = participants_by_name.get(key)
                    if existing:
                        if evidence not in existing["evidence"] and len(existing["evidence"]) < 12:
                            existing["evidence"].append(evidence)
                    else:
                        participants_by_name[key] = {
                            "name": name,
                            "role": role or "participant",
                            "evidence": [evidence],
                        }
                continue

            visible = re.match(r"^On screen:\s*(.+?)(?:\s+—\s+(.+))?$", line)
            if visible:
                shown = visible.group(1).strip()
                meaning = (visible.group(2) or "visible text").strip()
                fact = f"{shown} — {meaning}"[:500]
                if fact:
                    key = fact.casefold()
                    existing = context_by_fact.get(key)
                    if existing:
                        if evidence not in existing["evidence"] and len(existing["evidence"]) < 12:
                            existing["evidence"].append(evidence)
                    elif len(context_by_fact) < 40:
                        context_by_fact[key] = {"fact": fact, "evidence": [evidence]}
                continue

            if line.startswith("Claim bindings:"):
                try:
                    bindings = json.loads(line.split(":", 1)[1].strip())
                except (json.JSONDecodeError, TypeError):
                    bindings = []
                for binding in bindings if isinstance(bindings, list) else []:
                    if not isinstance(binding, dict):
                        continue
                    state = " ".join(
                        str(binding.get(key) or "").strip()
                        for key in ("subject", "relation", "value")
                    ).strip()[:500]
                    if not state:
                        continue
                    candidate = {
                        "startMs": start_ms,
                        "endMs": end_ms,
                        "state": state,
                        "confidence": "direct",
                    }
                    if state_history and state_history[-1]["state"].casefold() == state.casefold():
                        state_history[-1]["endMs"] = max(state_history[-1]["endMs"], end_ms)
                    elif len(state_history) < 80:
                        state_history.append(candidate)
                continue

            if line.startswith("Direct component:") and len(state_history) < 80:
                state = line.split(":", 1)[1].strip()[:500]
                if state:
                    state_history.append(
                        {
                            "startMs": start_ms,
                            "endMs": end_ms,
                            "state": state,
                            "confidence": "direct",
                        }
                    )
                continue

            if line.startswith("Uncertainty:"):
                uncertainty = line.split(":", 1)[1].strip()[:500]
                if uncertainty and uncertainty not in uncertainties:
                    uncertainties.append(uncertainty)

    if not key_events:
        overview = "No timestamped semantic observations were produced."
    elif len(key_events) == 1:
        overview = key_events[0]["event"]
    else:
        overview = (
            f"The sequence opens with {key_events[0]['event']} "
            f"By the final indexed moment, {key_events[-1]['event']}"
        )[:2_000]
    return {
        "overview": overview,
        "participants": list(participants_by_name.values())[:50],
        "stateHistory": state_history,
        "keyEvents": key_events,
        "narrative": narrative,
        "context": list(context_by_fact.values())[:40],
        "uncertainties": uncertainties,
    }


def _json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("agent response must be a JSON object")
    return value


def _google_response_schema(value: Any, *, property_map: bool = False) -> Any:
    """Translate the shared strict schema to Gemini's compact supported subset."""
    if isinstance(value, dict):
        if property_map:
            return {key: _google_response_schema(item) for key, item in value.items()}
        supported = {"type", "properties", "required", "items", "enum"}
        return {
            key: _google_response_schema(item, property_map=key == "properties")
            for key, item in value.items()
            if key in supported
        }
    if isinstance(value, list):
        return [_google_response_schema(item) for item in value]
    return value


def _validated_plan(
    raw: dict[str, Any],
    fallback: ExtractionPlan,
    duration_secs: float,
    heavy_disabled: bool,
) -> ExtractionPlan:
    mode = fallback.mode
    bounds = MODE_BOUNDS[mode]

    def bounded_number(key: str, low: float, high: float, default: float) -> float:
        try:
            return min(high, max(low, float(raw.get(key, default))))
        except (TypeError, ValueError):
            return default

    ranges: list[PriorityRange] = []
    for candidate in raw.get("priorityRanges") or []:
        if not isinstance(candidate, dict):
            continue
        try:
            start = max(0.0, float(candidate.get("startSecs")))
            end = min(duration_secs, float(candidate.get("endSecs")))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        ranges.append(
            PriorityRange(
                start, end, str(candidate.get("reason") or "source signal")[:160]
            )
        )
        if len(ranges) == 12:
            break

    focus = [
        str(item).strip()[:160]
        for item in raw.get("extractionFocus") or []
        if str(item).strip()
    ]
    focus = list(dict.fromkeys(focus))[:12] or fallback.extraction_focus

    def flag(key: str, default: bool) -> bool:
        value = raw.get(key)
        return value if isinstance(value, bool) else default

    sample = bounded_number(
        "sampleIntervalSecs", *bounds["sample"], fallback.sample_interval_secs
    )
    priority = bounded_number(
        "prioritySampleIntervalSecs",
        *bounds["priority"],
        fallback.priority_sample_interval_secs,
    )
    clip = bounded_number("clipWindowSecs", *bounds["clip"], fallback.clip_window_secs)
    frames = round(
        bounded_number("framesPerClip", *bounds["frames"], fallback.frames_per_clip)
    )
    use_transcript = flag("useTranscript", fallback.use_transcript)
    use_ocr = False if heavy_disabled else flag("useOcr", fallback.use_ocr)
    use_object_detection = (
        False
        if heavy_disabled
        else flag("useObjectDetection", fallback.use_object_detection)
    )
    use_semantic_vision = flag("useSemanticVision", fallback.use_semantic_vision)
    use_video_embeddings = flag("useVideoEmbeddings", fallback.use_video_embeddings)
    use_scene_cuts = flag("useSceneCuts", fallback.use_scene_cuts)
    priority = min(sample, priority)
    estimated = _estimate_runtime_seconds(
        duration_secs=duration_secs,
        sample_interval_secs=sample,
        priority_sample_interval_secs=priority,
        clip_window_secs=clip,
        frames_per_clip=frames,
        priority_ranges=ranges,
        use_transcript=use_transcript,
        use_ocr=use_ocr,
        use_object_detection=use_object_detection,
        use_semantic_vision=use_semantic_vision,
        use_video_embeddings=use_video_embeddings,
        use_scene_cuts=use_scene_cuts,
    )
    return ExtractionPlan(
        mode=mode,
        summary=str(raw.get("summary") or fallback.summary).strip()[:500],
        extraction_focus=focus,
        use_transcript=use_transcript,
        use_ocr=use_ocr,
        use_object_detection=use_object_detection,
        use_semantic_vision=use_semantic_vision,
        use_video_embeddings=use_video_embeddings,
        use_scene_cuts=use_scene_cuts,
        sample_interval_secs=sample,
        priority_sample_interval_secs=priority,
        clip_window_secs=clip,
        frames_per_clip=frames,
        priority_ranges=ranges,
        estimated_seconds=estimated,
    )


def _vision_request_seconds(images_per_request: int) -> float:
    """How long one multimodal request takes, from its image count.

    Measured against the gateway: a request's latency is driven by how many
    frames it carries, not by how many clips those frames belong to. A flat
    per-request constant under-predicts a full batch by several times over,
    which makes the ETA promise a finish that never arrives.
    """
    base = float(os.getenv("LARKUP_VIDEO_VISION_REQUEST_BASE_SECONDS", "8"))
    # Current gateway batches are decoded in one multimodal request; image
    # count adds a small serialization/inference cost, not a fresh request's
    # latency per frame. The older 4s/image fallback predicted ~13.5 minutes
    # for a pipeline measured at ~6 minutes. Keep both values configurable,
    # then replace this forecast with observed clip throughput after batch 1.
    per_image = float(
        os.getenv("LARKUP_VIDEO_VISION_REQUEST_PER_IMAGE_SECONDS", "0.35")
    )
    return max(1.0, base + per_image * max(1, images_per_request))


def _estimate_runtime_seconds(
    *,
    duration_secs: float,
    sample_interval_secs: float,
    priority_sample_interval_secs: float,
    clip_window_secs: float,
    frames_per_clip: int,
    priority_ranges: list[PriorityRange],
    use_transcript: bool,
    use_ocr: bool,
    use_object_detection: bool,
    use_semantic_vision: bool,
    use_video_embeddings: bool,
    use_scene_cuts: bool,
    actual_clip_count: int | None = None,
) -> int:
    """Forecast wall time from bounded work, never from model opinion.

    Parallel vision requests are estimated as waves rather than sequential
    clips. Validation timings can tune these constants without changing an
    agent plan or the evidence contract.
    """
    duration = max(0.001, duration_secs)
    base_samples = math.ceil(duration / max(sample_interval_secs, 0.001)) + 1
    priority_duration = sum(
        max(0.0, min(duration, item.end_secs) - max(0.0, item.start_secs))
        for item in priority_ranges
    )
    priority_samples = math.ceil(
        priority_duration / max(priority_sample_interval_secs, 0.001)
    )
    sampled_frames = base_samples + priority_samples
    clip_count = actual_clip_count or max(
        1, math.ceil(duration / max(clip_window_secs, 0.001))
    )

    estimate = 12.0
    if use_transcript:
        transcription_provider = (
            os.getenv("LARKUP_VIDEO_TRANSCRIPTION_PROVIDER", "whisper").strip().lower()
        )
        # Hosted Nova transcription runs bounded audio chunks concurrently;
        # local Whisper scales much closer to source duration. Keep these
        # forecasts provider-aware so Fast does not inherit the old Whisper
        # ETA after managed workers switch to Nova.
        estimate += max(
            12.0 if transcription_provider == "deepgram" else 4.0,
            duration * (0.018 if transcription_provider == "deepgram" else 0.08),
        )
    estimate += sampled_frames * (
        0.04 + (0.12 if use_ocr else 0.0) + (0.08 if use_object_detection else 0.0)
    )
    if use_scene_cuts:
        estimate += duration * 0.025
    if use_semantic_vision:
        batch_size = max(
            1, min(8, int(os.getenv("LARKUP_VIDEO_GATEWAY_BATCH_SIZE", "4")))
        )
        max_images = max(
            1,
            min(
                32, int(os.getenv("LARKUP_VIDEO_GATEWAY_MAX_IMAGES_PER_REQUEST", "20"))
            ),
        )
        clips_per_request = max(
            1, min(batch_size, max_images // max(frames_per_clip, 1))
        )
        request_count = math.ceil(clip_count / clips_per_request)
        if (
            os.getenv("LARKUP_VIDEO_VISION_PROVIDER", "vercel_ai_gateway")
            .strip()
            .lower()
            == "google"
        ):
            concurrency = max(
                1, min(8, int(os.getenv("LARKUP_VIDEO_GOOGLE_CONCURRENCY", "4")))
            )
            requests_per_minute = max(
                1, int(os.getenv("LARKUP_VIDEO_GOOGLE_REQUESTS_PER_MINUTE", "12"))
            )
            request_seconds = _vision_request_seconds(
                clips_per_request * frames_per_clip
            )
        else:
            concurrency = max(
                1, min(24, int(os.getenv("LARKUP_VIDEO_GATEWAY_CONCURRENCY", "24")))
            )
            requests_per_minute = max(
                1, int(os.getenv("LARKUP_VIDEO_GATEWAY_REQUESTS_PER_MINUTE", "60"))
            )
            request_seconds = _vision_request_seconds(
                clips_per_request * frames_per_clip
            )
        concurrency_seconds = request_seconds * max(
            1, math.ceil(request_count / concurrency)
        )
        rate_limit_seconds = (
            60.0 * ((request_count - 1) // requests_per_minute) + request_seconds
        )
        estimate += max(concurrency_seconds, rate_limit_seconds)
    if use_video_embeddings:
        estimate += 20.0 + clip_count * 0.15
    return max(15, round(estimate))


def estimate_plan_runtime(
    plan: ExtractionPlan,
    duration_secs: float,
    actual_clip_count: int | None = None,
) -> int:
    """Recompute an ETA after the executor applies service availability."""
    estimate = _estimate_runtime_seconds(
        duration_secs=duration_secs,
        sample_interval_secs=plan.sample_interval_secs,
        priority_sample_interval_secs=plan.priority_sample_interval_secs,
        clip_window_secs=plan.clip_window_secs,
        frames_per_clip=plan.frames_per_clip,
        priority_ranges=plan.priority_ranges,
        use_transcript=plan.use_transcript,
        use_ocr=plan.use_ocr,
        use_object_detection=plan.use_object_detection,
        use_semantic_vision=plan.use_semantic_vision,
        use_video_embeddings=plan.use_video_embeddings,
        use_scene_cuts=plan.use_scene_cuts,
        actual_clip_count=actual_clip_count,
    )
    # Planner refinement and the final evidence audit are text-model calls,
    # independent of source duration. Production validation puts their
    # combined median close to a minute; keep a small buffer before live unit
    # throughput replaces this initial forecast.
    return estimate + 70
