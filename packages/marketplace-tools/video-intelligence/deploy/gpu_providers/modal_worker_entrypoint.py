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

import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import modal
import requests

from .remote_source import (
    extract_bounded_remote_clip,
    materialize_provider_source,
    rebase_transcript_context,
)

APP_NAME = "larkup-video-intelligence"
FUNCTION_NAME = "process_video_job"
MATERIALIZATION_FUNCTION_NAME = "materialize_remote_video_job"
PROGRESS_DICT_NAME = "larkup-video-intelligence-progress"
GPU_TYPE = "T4"
GPU_MAX_CONTAINERS = 1
MATERIALIZATION_MAX_CONTAINERS = 4
GPU_IDLE_TIMEOUT_SECONDS = 15 * 60
YOLOX_MODEL_URL = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx"

WORKER_IMAGE = (
    modal.Image.from_registry(
        "nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04", add_python="3.12"
    )
    .apt_install(
        "ffmpeg",
        "libgomp1",
        "curl",
        "ca-certificates",
        "fonts-liberation",
        "libasound2",
        "libatk-bridge2.0-0",
        "libgbm1",
        "libgtk-3-0",
        "libnss3",
        "unzip",
        "xz-utils",
        "xvfb",
    )
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
        "curl --fail --location --retry 4 https://nodejs.org/dist/v22.23.0/node-v22.23.0-linux-x64.tar.xz --output /tmp/node.tar.xz",
        "mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /opt/node",
        "curl --fail --location --retry 4 https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.79/linux64/chrome-linux64.zip --output /tmp/chrome.zip",
        "unzip -q /tmp/chrome.zip -d /opt && mv /opt/chrome-linux64 /opt/chrome",
        "rm -f /tmp/node.tar.xz /tmp/chrome.zip",
        "python3 -m pip install --no-cache-dir 'yt-dlp[default]==2026.8.19' 'yt-dlp-getpot-wpc==1.1.2'",
        "mv /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp-python",
    )
    .add_local_file(
        "deploy/gpu_providers/yt-dlp-wrapper.sh",
        remote_path="/usr/local/bin/yt-dlp",
        copy=True,
    )
    .add_local_file(
        "deploy/gpu_providers/chrome-wrapper.sh",
        remote_path="/usr/local/bin/larkup-chrome",
        copy=True,
    )
    .run_commands("chmod 0755 /usr/local/bin/yt-dlp /usr/local/bin/larkup-chrome")
    .add_local_dir("runtime/app", remote_path="/service/app")
)

app = modal.App(APP_NAME)

@app.function(
    image=WORKER_IMAGE,
    secrets=[modal.Secret.from_name("larkup-video-proxy")],
    # A single T4 keeps this batch-oriented workload on a modest GPU class.
    # It scales from zero, so idle GPU time is not billed.
    gpu=GPU_TYPE,
    max_containers=GPU_MAX_CONTAINERS,
    timeout=6 * 60 * 60,
    # Reuse a container briefly for follow-up work, then release the GPU.
    # No min_containers value means the worker scales fully to zero when idle.
    scaledown_window=GPU_IDLE_TIMEOUT_SECONDS,
    env={
        "LARKUP_VIDEO_GATEWAY_CONCURRENCY": "8",
        "LARKUP_VIDEO_GATEWAY_REQUESTS_PER_MINUTE": "24",
        "LARKUP_VIDEO_GATEWAY_BATCH_SIZE": "8",
        "LARKUP_VIDEO_GATEWAY_MAX_IMAGES_PER_REQUEST": "32",
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
    if payload.get("operation") == "materialize":
        return materialize_remote_video(payload, source_url, modal_progress_reporter())
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


@app.function(
    image=WORKER_IMAGE,
    secrets=[modal.Secret.from_name("larkup-video-proxy")],
    # Remote acquisition uses yt-dlp/ffmpeg and object storage, not inference.
    # Keeping it off the single GPU lane removes GPU cold-start and indexing
    # contention while preserving the same canonical downloader and proxy.
    max_containers=MATERIALIZATION_MAX_CONTAINERS,
    timeout=60 * 60,
    scaledown_window=GPU_IDLE_TIMEOUT_SECONDS,
)
def materialize_remote_video_job(payload: dict[str, Any]) -> dict[str, Any]:
    source_url = str(payload.get("sourceUrl") or "")
    if not source_url.startswith("https://"):
        raise ValueError("sourceUrl must be an HTTPS URL")
    if payload.get("operation") != "materialize":
        raise ValueError("materialize_remote_video_job only accepts materialize operations")
    return materialize_remote_video(payload, source_url, modal_progress_reporter())


def materialize_remote_video(
    payload: dict[str, Any], source_url: str, progress: Any
) -> dict[str, Any]:
    upload_url = str(payload.get("materializedSourceUploadUrl") or "")
    if not upload_url.startswith("https://"):
        raise ValueError("materializedSourceUploadUrl must be an HTTPS signed URL")
    upload_headers = {
        str(key): str(value)
        for key, value in (payload.get("materializedSourceUploadHeaders") or {}).items()
    }
    started = time.monotonic()

    def report_preparation(percent: int, message: str) -> None:
        bounded = max(0, min(99, int(percent)))
        progress(
            "prepare",
            min(94, 1 + round(bounded * 0.93)),
            message,
            bounded,
            {
                "elapsedSeconds": round(max(0.0, time.monotonic() - started)),
                "current": bounded,
                "total": 100,
                "unit": "source download",
            },
        )

    with tempfile.TemporaryDirectory(prefix="larkup-modal-materialize-") as temporary:
        source_path = Path(temporary) / "source.mp4"
        extracted_title = materialize_provider_source(
            source_url,
            source_path,
            float(payload.get("sourceDurationSecs") or 0) or None,
            report_preparation,
        )
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(source_path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        duration_secs = max(
            0.001,
            float(json.loads(probe.stdout).get("format", {}).get("duration") or 0),
        )
        size_bytes = source_path.stat().st_size
        progress("prepare", 96, "Transferring the video to secure platform storage", 100, {})
        with source_path.open("rb") as source_file:
            uploaded = requests.put(
                upload_url,
                headers=upload_headers,
                data=source_file,
                timeout=(30, 6 * 60 * 60),
            )
        uploaded.raise_for_status()
        progress("complete", 99, "Remote video materialization completed", 100, {})
        return {
            "result": {
                "fileName": extracted_title
                or str(payload.get("fileName") or "youtube-video.mp4"),
                "mimeType": "video/mp4",
                "sizeBytes": size_bytes,
                "durationSecs": duration_secs,
            },
            "actualSourceMinutes": 0,
        }


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
            materialize_provider_source(
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
