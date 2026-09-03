from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=lambda value: _to_camel(value), populate_by_name=True)


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class VideoIndexingBrief(ApiModel):
    goal: str | None = Field(default=None, max_length=2_000)
    # Descriptive metadata only. The agent selects modalities from source
    # evidence and the user's goal, never from a fixed genre branch.
    content_type: str = Field(default="general", max_length=120)
    known_entities: list[str] = Field(default_factory=list, max_length=50)
    expected_questions: list[str] = Field(default_factory=list, max_length=20)
    language: str = Field(default="auto", max_length=32)
    important_ranges: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    indexing_mode: Literal["fast", "balanced", "thorough"] = "balanced"
    processing_authority_confirmed: bool = False
    retain_source_hours: int = Field(default=0, ge=0, le=720)
    skip_transcription: bool = False
    # A live bounded inspection publishes timestamped evidence immediately;
    # its clip vectors would not be stored or queried during that same turn.
    # Skip the optional retrieval index there to keep an answer independent of
    # an embedding worker cold start.
    skip_video_embeddings: bool = False
    # Semantic vision can answer ordinary visual questions directly. Reserve
    # CPU OCR/detection for requests that actually need those operators.
    skip_heavy_operators: bool = False
    # A bounded chat verification already decided that fresh visual evidence
    # is required. The runtime planner may tune sampling, but cannot disable
    # the only remaining visual evidence source for that pass.
    require_semantic_vision: bool = False
    # Read the requested range as one chronological sequence instead of
    # independent clips, so a before/after relationship inside it survives.
    continuous_sequence: bool = False
    # The retrieval agent may spend a denser visual budget on a bounded close
    # read. Whole-source indexing leaves this unset and follows the plan.
    max_frames: int | None = Field(default=None, ge=1, le=24)
    # A bounded conversational verification is already planned by the host.
    # It uses the deterministic fast lane in the worker and never changes the
    # behavior of a normal media-indexing request.
    interactive: bool = False
    # A selected external transcription provider can supply timestamped speech
    # to the semantic reader without forcing the worker to transcribe twice.
    transcript_context: list[dict[str, Any]] = Field(default_factory=list, max_length=2_000)

    @field_validator("goal", "language", "content_type")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("known_entities", "expected_questions")
    @classmethod
    def normalize_lists(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            candidate = item.strip()
            key = candidate.casefold()
            if candidate and key not in seen:
                normalized.append(candidate[:200])
                seen.add(key)
        return normalized

class VideoSource(ApiModel):
    upload_id: str
    file_name: str | None = None


class ProviderModelCredential(ApiModel):
    provider: str = Field(min_length=1, max_length=64)
    api_key: str = Field(min_length=1, max_length=2_048)
    model: str = Field(min_length=1, max_length=256)


class JobModelConfiguration(ApiModel):
    audio: ProviderModelCredential
    brain: ProviderModelCredential
    vision: ProviderModelCredential


class CreateJobRequest(ApiModel):
    source: VideoSource
    brief: VideoIndexingBrief = Field(default_factory=VideoIndexingBrief)
    # Custom-remote runtimes accept the same transient BYOK contract as
    # managed cloud. Local calls omit it and use process-scoped settings.
    model_configuration: JobModelConfiguration | None = None


class JobProgress(ApiModel):
    stage: Literal[
        "queued", "prepare", "probe", "decode", "transcribe", "ocr", "detect", "synthesize", "complete"
    ]
    percent: int = Field(ge=0, le=100)
    message: str
    # How far through `stage` alone the job is. A host that renders one bar
    # per step reads this instead of keeping its own copy of the pipeline's
    # phase budget, which would break silently whenever that budget changed.
    stage_percent: int | None = Field(default=None, ge=0, le=100)
    sequence: int | None = Field(default=None, ge=0)
    elapsed_seconds: int | None = Field(default=None, ge=0)
    estimated_remaining_seconds: int | None = Field(default=None, ge=0)
    current: int | None = Field(default=None, ge=0)
    total: int | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=80)


class UsageSummary(ApiModel):
    period_start: str
    period_end: str
    source_minutes_used: float
    source_minutes_limit: float | None
    active_jobs: int
    concurrent_jobs_limit: int


class JobResponse(ApiModel):
    id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    created_at: str
    updated_at: str
    progress: JobProgress
    estimated_source_minutes: float
    result: dict[str, Any] | None = None
    error: str | None = None


class RedeemAccessCodeRequest(ApiModel):
    code: str = Field(min_length=4, max_length=128)
    label: str | None = Field(default=None, max_length=120)


class RedeemAccessCodeResponse(ApiModel):
    api_key: str
    entitlement: dict[str, Any]


class CreateAccessCodeRequest(ApiModel):
    label: str = Field(min_length=1, max_length=120)
    source_minutes_per_month: float = Field(default=600, ge=1, le=1_000_000)
    max_concurrent_jobs: int = Field(default=1, ge=1, le=100)
    max_uses: int = Field(default=1, ge=1, le=100_000)
    expires_at: str | None = None


class CreateAccessCodeResponse(ApiModel):
    code: str
    label: str
    max_uses: int
    expires_at: str | None
