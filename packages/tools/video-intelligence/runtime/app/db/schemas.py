from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=lambda value: _to_camel(value), populate_by_name=True)


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class VideoIndexingBrief(ApiModel):
    goal: str | None = Field(default=None, max_length=2_000)
    content_type: Literal[
        "general", "course", "sports", "surveillance", "meeting"
    ] = "general"
    known_entities: list[str] = Field(default_factory=list, max_length=50)
    expected_questions: list[str] = Field(default_factory=list, max_length=20)
    language: str = Field(default="auto", max_length=32)
    important_ranges: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    indexing_mode: Literal["fast", "balanced", "deep", "full-coverage"] = "balanced"
    processing_authority_confirmed: bool = False
    retain_source_hours: int = Field(default=0, ge=0, le=720)
    skip_transcription: bool = False

    @field_validator("goal", "language")
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

    @model_validator(mode="after")
    def validate_full_frame_authority(self) -> "VideoIndexingBrief":
        if self.indexing_mode == "full-coverage" and not self.processing_authority_confirmed:
            raise ValueError("full frame coverage requires explicit user authorization")
        return self


class VideoSource(ApiModel):
    upload_id: str
    file_name: str | None = None


class CreateJobRequest(ApiModel):
    source: VideoSource
    brief: VideoIndexingBrief = Field(default_factory=VideoIndexingBrief)


class JobProgress(ApiModel):
    stage: Literal[
        "queued", "probe", "decode", "transcribe", "ocr", "detect", "synthesize", "complete"
    ]
    percent: int = Field(ge=0, le=100)
    message: str


class UsageSummary(ApiModel):
    period_start: str
    period_end: str
    source_minutes_used: float
    source_minutes_limit: float | None
    active_jobs: int
    concurrent_jobs_limit: int
    allow_full_coverage: bool


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
    allow_full_coverage: bool = False
    max_uses: int = Field(default=1, ge=1, le=100_000)
    expires_at: str | None = None


class CreateAccessCodeResponse(ApiModel):
    code: str
    label: str
    max_uses: int
    expires_at: str | None
