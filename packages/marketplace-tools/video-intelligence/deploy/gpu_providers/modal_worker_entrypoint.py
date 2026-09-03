"""Modal worker entrypoint -- deployed separately with `modal deploy`.

Unlike RunPod's image-baked worker (built into the shared Dockerfile), a
Modal Function is deployed straight from this file. This has been deployed
for real (real `modal deploy`, real image build, real YOLOX weight download
inside the build) with this exact command -- module mode, not a plain
script path, because this file (like remote_source.py) uses a top-level
relative import:

    cd packages/marketplace-tools/video-intelligence
    modal deploy -m deploy.gpu_providers.modal_worker_entrypoint

That builds WORKER_IMAGE below and registers `process_video_job` under
APP_NAME, which modal_provider.ModalProvider looks up by default
(LARKUP_VIDEO_MODAL_APP / LARKUP_VIDEO_MODAL_FUNCTION override both if you
deploy under different names). Same shared `runtime/app` pipeline as every
other provider -- this only adds the Modal-specific glue around it.

Image build, function registration, and a real end-to-end job run are all
deploy-verified: a 14m36s source was indexed here on an A10G in 255s with
live progress polled from PROGRESS_DICT_NAME, and its index matched the one
the same pipeline produced locally.
"""

from __future__ import annotations

import tempfile
import time
from pathlib import Path
from typing import Any

import modal

from .remote_source import (
    extract_bounded_remote_clip,
    materialize_remote_source,
    rebase_transcript_context,
)

APP_NAME = "larkup-video-intelligence"
FUNCTION_NAME = "process_video_job"
PROGRESS_DICT_NAME = "larkup-video-intelligence-progress"
YOLOX_MODEL_URL = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx"

WORKER_IMAGE = (
    modal.Image.from_registry(
        "nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04", add_python="3.12"
    )
    .apt_install("ffmpeg", "libgomp1", "curl", "ca-certificates")
    .run_commands(
        "python3 -m pip install --no-cache-dir --upgrade pip",
        "python3 -m pip install --no-cache-dir paddlepaddle==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/",
    )
    .pip_install_from_requirements("runtime/requirements.txt")
    .run_commands(
        "mkdir -p /models /data",
        f"curl --fail --location --retry 4 {YOLOX_MODEL_URL} --output /models/yolox_s.onnx",
        # Download lazy model assets while building the immutable image. A
        # live indexing/chat request must never spend minutes fetching them.
        "python3 -c \"from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-small')\"",
    )
    .add_local_dir("runtime/app", remote_path="/service/app")
)

app = modal.App(APP_NAME)

@app.function(
    image=WORKER_IMAGE,
    gpu="A10G",
    timeout=6 * 60 * 60,
    # Indexing is commonly followed by several chat refinements. Reuse the
    # loaded OCR/transcription models across that interactive window.
    scaledown_window=10 * 60,
    env={
        "LARKUP_VIDEO_GATEWAY_CONCURRENCY": "4",
        "LARKUP_VIDEO_GATEWAY_REQUESTS_PER_MINUTE": "10",
        # Structured output prevents a dense interactive visual read from
        # becoming unusable prose or truncated markdown before the evidence
        # parser can retain it. Gateway clients that do not support schemas
        # automatically retry loose JSON in SemanticVisionService.
        "LARKUP_VIDEO_USE_STRICT_JSON_SCHEMA": "true",
        "LARKUP_VIDEO_TRANSCRIPTION_CHUNK_SECONDS": "300",
        "LARKUP_VIDEO_TRANSCRIPTION_CONCURRENCY": "6",
        "LARKUP_VIDEO_TRANSCRIPTION_REQUEST_TIMEOUT_SECONDS": "120",
        "LARKUP_VIDEO_GOOGLE_CONCURRENCY": "2",
        "LARKUP_VIDEO_GOOGLE_BATCH_SIZE": "2",
        "LARKUP_VIDEO_GOOGLE_USE_INTERACTIONS_API": "false",
        "LARKUP_VIDEO_GOOGLE_REQUESTS_PER_MINUTE": "8",
        "LARKUP_VIDEO_GOOGLE_MAX_IMAGES_PER_REQUEST": "8",
    },
)
def process_video_job(payload: dict[str, Any]) -> dict[str, Any]:
    import sys

    sys.path.insert(0, "/service")
    from app.config import Settings
    from app.db.schemas import VideoIndexingBrief
    from app.model_configuration import temporary_model_environment
    from app.services.pipeline import run_pipeline
    from app.utils.timing import normalized_important_ranges

    source_url = str(payload.get("sourceUrl") or "")
    if not source_url.startswith("https://"):
        raise ValueError("sourceUrl must be an HTTPS signed URL")
    brief = VideoIndexingBrief.model_validate(payload.get("brief") or {})
    source_duration_secs = float(payload.get("sourceDurationSecs") or 0)
    progress = modal_progress_reporter()
    with temporary_model_environment(payload):
        settings = Settings.from_env()
        return run_video_job(
            source_url,
            brief,
            source_duration_secs,
            settings,
            run_pipeline,
            normalized_important_ranges,
            progress,
        )


def run_video_job(
    source_url: str,
    brief: Any,
    source_duration_secs: float,
    settings: Any,
    run_pipeline: Any,
    normalized_important_ranges: Any,
    progress: Any,
) -> dict[str, Any]:
    preparation_started = time.monotonic()
    report_preparation = preparation_progress(progress, preparation_started)
    with tempfile.TemporaryDirectory(prefix="larkup-modal-video-") as temporary:
        source_path = Path(temporary) / "source.mp4"
        important_ranges = normalized_important_ranges(
            brief.model_dump(by_alias=True), source_duration_secs
        )
        full_source_range = _is_full_source_range(
            important_ranges, source_duration_secs
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
                report_preparation,
            )
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
                    [
                        segment
                        for segment in transcript_context
                        if isinstance(segment, dict)
                    ],
                    timestamp_offset_secs,
                    end_secs,
                )
        else:
            materialize_remote_source(
                source_url,
                source_path,
                source_duration_secs,
                report_preparation,
                prefer_stream_copy=brief.indexing_mode == "fast",
            )
        result, actual_minutes = run_pipeline(
            source_path,
            analysis_brief,
            settings.model_dir,
            settings.device,
            pipeline_progress(progress),
            settings.disable_heavy_operators,
            True,
            settings.semantic_vision_model,
            timestamp_offset_secs=timestamp_offset_secs,
            source_duration_secs=source_duration_secs or None,
        )
        result["brief"] = brief.model_dump(by_alias=True)
    return {"result": result, "actualSourceMinutes": actual_minutes}


def _is_full_source_range(
    important_ranges: list[tuple[float, float]], source_duration_secs: float
) -> bool:
    """Do not mistake the planner's whole-source range for an inspector clip."""
    return (
        len(important_ranges) == 1
        and important_ranges[0][0] <= 0.1
        and source_duration_secs > 0
        and important_ranges[0][1] >= source_duration_secs - 0.5
    )


def preparation_progress(progress: Any, started_at: float | None = None) -> Any:
    """Expose measured source preparation without consuming the analysis band."""
    started = time.monotonic() if started_at is None else started_at

    def report(percent: int, message: str) -> None:
        bounded = max(0, min(99, int(percent)))
        elapsed = max(0.0, time.monotonic() - started)
        estimated_remaining = (
            max(1, round(elapsed * (100 - bounded) / bounded)) if bounded >= 2 else None
        )
        progress(
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

    return report


def pipeline_progress(progress: Any) -> Any:
    """Maps shared pipeline progress after the source-preparation budget.

    The source copy and index pipeline are sequential on Modal.  Giving both
    their own 0–99 scale made the visible value jump backwards as soon as
    indexing began; this keeps the single public progress contract honest.
    """
    return lambda stage, percent, message, stage_percent=None, details=None: progress(
        stage,
        min(99, 20 + round(max(0, min(100, percent)) * 0.79)),
        message,
        stage_percent,
        details,
    )


def modal_progress_reporter() -> Any:
    """Relay worker stages to the control plane by the current Modal call id."""
    call_id = modal.current_function_call_id()
    if not call_id:
        return lambda *_progress: None
    progress = modal.Dict.from_name(PROGRESS_DICT_NAME, create_if_missing=True)

    last_percent = -1

    def report(
        stage: str,
        percent: int,
        message: str,
        stage_percent: int | None = None,
        details: dict[str, int | float | str] | None = None,
    ) -> None:
        nonlocal last_percent
        last_percent = max(last_percent, min(99, max(0, int(percent))))
        progress[call_id] = {
            "stage": stage,
            "percent": last_percent,
            "message": message,
            **({"stagePercent": stage_percent} if stage_percent is not None else {}),
            **(details or {}),
        }

    return report
