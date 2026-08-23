from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import runpod

from .config import Settings
from .pipeline import run_pipeline
from .ranges import normalized_important_ranges
from .remote_source import extract_bounded_remote_clip, materialize_remote_source
from .schemas import VideoIndexingBrief


def handler(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("input") or {}
    source_url = str(payload.get("sourceUrl") or "")
    if not source_url.startswith("https://"):
        raise ValueError("sourceUrl must be an HTTPS signed URL")
    brief = VideoIndexingBrief.model_validate(payload.get("brief") or {})
    source_duration_secs = float(payload.get("sourceDurationSecs") or 0)
    settings = Settings.from_env()
    with tempfile.TemporaryDirectory(prefix="larkup-runpod-video-") as temporary:
        source_path = Path(temporary) / "source.mp4"
        important_ranges = normalized_important_ranges(
            brief.model_dump(by_alias=True), source_duration_secs
        )
        timestamp_offset_secs = 0.0
        analysis_brief = brief.model_dump(by_alias=True)
        if len(important_ranges) == 1:
            timestamp_offset_secs, end_secs = important_ranges[0]
            extract_bounded_remote_clip(
                source_url, source_path, timestamp_offset_secs, end_secs
            )
            # The local worker file is now only the requested clip. Avoid a
            # second seek using source-video timestamps inside the pipeline.
            analysis_brief["importantRanges"] = []
        else:
            # Full indexing (or disjoint planned ranges) keeps the existing
            # path. The interactive inspector sends exactly one bounded range.
            materialize_remote_source(source_url, source_path)
        result, actual_minutes = run_pipeline(
            source_path,
            analysis_brief,
            settings.model_dir,
            settings.device,
            lambda *_: None,
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
