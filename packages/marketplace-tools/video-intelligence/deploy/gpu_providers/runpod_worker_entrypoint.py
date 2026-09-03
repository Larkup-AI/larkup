from __future__ import annotations

import tempfile
import time
from pathlib import Path
from typing import Any

import runpod

from .config import Settings
from .model_configuration import temporary_model_environment
from .progress import create_progress_reporter
from .remote_source import (
    extract_bounded_remote_clip,
    materialize_remote_source,
    rebase_transcript_context,
)
from .db.schemas import VideoIndexingBrief
from .services.pipeline import run_pipeline
from .utils.timing import normalized_important_ranges


def progress_reporter(event: dict[str, Any]):
    """Forward bounded, structured pipeline updates to the RunPod status API."""
    return create_progress_reporter(
        lambda payload: runpod.serverless.progress_update(event, payload)
    )


def handler(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("input") or {}
    source_url = str(payload.get("sourceUrl") or "")
    if not source_url.startswith("https://"):
        raise ValueError("sourceUrl must be an HTTPS signed URL")
    brief = VideoIndexingBrief.model_validate(payload.get("brief") or {})
    source_duration_secs = float(payload.get("sourceDurationSecs") or 0)
    # The control plane forwards the user's model bundle only in this job.
    # Scope it so a warm worker cannot expose it to the next invocation.
    with temporary_model_environment(payload):
        settings = Settings.from_env()
        return run_video_job(event, payload, source_url, brief, source_duration_secs, settings)


def run_video_job(
    event: dict[str, Any],
    payload: dict[str, Any],
    source_url: str,
    brief: VideoIndexingBrief,
    source_duration_secs: float,
    settings: Settings,
) -> dict[str, Any]:
    report = progress_reporter(event)
    preparation_started = time.monotonic()

    def preparation_progress(percent: int, message: str) -> None:
        bounded = max(0, min(99, int(percent)))
        elapsed = max(0.0, time.monotonic() - preparation_started)
        estimated_remaining = (
            max(1, round(elapsed * (100 - bounded) / bounded)) if bounded >= 2 else None
        )
        report(
            "prepare",
            min(20, 1 + round(bounded * 0.19)),
            message,
            bounded,
            {
                "elapsedSeconds": round(elapsed),
                "current": bounded,
                "total": 100,
                "unit": "source preparation",
                **(
                    {"estimatedRemainingSeconds": estimated_remaining}
                    if estimated_remaining is not None
                    else {}
                ),
            },
        )

    def pipeline_progress(
        stage: str,
        percent: int,
        message: str,
        stage_percent: int,
        details: dict[str, int | float | str],
    ) -> None:
        report(
            stage,
            min(99, 20 + round(max(0, min(99, percent)) * 0.79)),
            message,
            stage_percent,
            details,
        )

    with tempfile.TemporaryDirectory(prefix="larkup-runpod-video-") as temporary:
        source_path = Path(temporary) / "source.mp4"
        important_ranges = normalized_important_ranges(
            brief.model_dump(by_alias=True), source_duration_secs
        )
        full_source_range = (
            len(important_ranges) == 1
            and important_ranges[0][0] <= 0.1
            and source_duration_secs > 0
            and important_ranges[0][1] >= source_duration_secs - 0.5
        )
        timestamp_offset_secs = 0.0
        analysis_brief = brief.model_dump(by_alias=True)
        if len(important_ranges) == 1 and not full_source_range:
            timestamp_offset_secs, end_secs = important_ranges[0]
            extract_bounded_remote_clip(
                source_url,
                source_path,
                timestamp_offset_secs,
                end_secs,
                preparation_progress,
            )
            # The local worker file is now only the requested clip. Rebase
            # the range to its local clock instead of dropping it: the
            # pipeline uses this signal to retain dense, chronological frames
            # for a direct verification request, while avoiding a second seek
            # with source-video timestamps.
            analysis_brief["importantRanges"] = [
                {
                    "startSecs": 0.0,
                    "endSecs": max(0.001, end_secs - timestamp_offset_secs),
                    "note": "bounded-local-verification",
                }
            ]
            transcript_context = analysis_brief.get("transcriptContext")
            if isinstance(transcript_context, list):
                analysis_brief["transcriptContext"] = rebase_transcript_context(
                    [segment for segment in transcript_context if isinstance(segment, dict)],
                    timestamp_offset_secs,
                    end_secs,
                )
        else:
            # Full indexing (or disjoint planned ranges) keeps the existing
            # path. The interactive inspector sends exactly one bounded range.
            materialize_remote_source(
                source_url,
                source_path,
                source_duration_secs or None,
                preparation_progress,
                prefer_stream_copy=brief.indexing_mode == "fast",
            )
        result, actual_minutes = run_pipeline(
            source_path,
            analysis_brief,
            settings.model_dir,
            settings.device,
            pipeline_progress,
            settings.disable_heavy_operators,
            # Managed RunPod jobs are explicitly requested for cloud video
            # investigation. Keep semantic VLM evidence on even if a stale
            # platform-level environment variable leaks into a worker.
            True,
            settings.semantic_vision_model,
            timestamp_offset_secs=timestamp_offset_secs,
            source_duration_secs=source_duration_secs or None,
        )
        # Keep the stored investigation request meaningful to callers even
        # though the worker analyzes a rebased temporary clip internally.
        result["brief"] = brief.model_dump(by_alias=True)
    return {"result": result, "actualSourceMinutes": actual_minutes}

if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
