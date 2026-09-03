"""Runs a queued job in a background thread pool and reports progress into
the local SQLite store. This is the local-Docker execution path only --
managed-cloud jobs are dispatched to a GPU provider instead (see
deploy/gpu_providers/), never through this service.
"""

from __future__ import annotations

import logging
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from app.config import Settings
from app.db.store import Store
from app.model_configuration import temporary_model_environment, unchanged_model_environment
from app.services.pipeline import run_pipeline

logger = logging.getLogger(__name__)


PreparationProgress = Callable[[int, str], None]

# Only an incompatible upload needs transcoding before analysis. When it does,
# it takes this much of the bar and the pipeline is compressed into what is
# left; when it does not, the pipeline owns the bar outright rather than
# starting a quarter of the way along it.
PREPARATION_CEILING_PERCENT = 25


def analysis_source(
    path: Path, job_id: str, progress: PreparationProgress | None = None
) -> tuple[Path, Path | None]:
    """Return an OpenCV-compatible source, transcoding AV1 locally when needed.

    OpenCV builds used by the CPU runtime cannot reliably decode browser AV1
    uploads. ffmpeg handles them, so make a temporary H.264 copy only for
    those uploads and leave every other format untouched.
    """
    try:
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("Could not inspect this video's codec locally.") from error
    if probe.stdout.strip().lower() != "av1":
        return path, None

    try:
        duration_probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        duration_secs = max(0.0, float(duration_probe.stdout.strip()))
    except (ValueError, OSError, subprocess.SubprocessError):
        duration_secs = 0.0

    normalized = path.with_name(f"{path.stem}.larkup-{job_id}.h264.mp4")
    if progress:
        progress(1, "Making this video ready for local analysis (0%)")
    try:
        process = subprocess.Popen(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-nostats",
                "-progress",
                "pipe:1",
                "-i",
                str(path),
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                # This is an analysis-only copy. Ultrafast H.264 is far less
                # CPU-intensive than ffmpeg's default preset and remains
                # compatible with OpenCV while avoiding a multi-minute stall.
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "28",
                "-tune",
                "fastdecode",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
                str(normalized),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        last_percent = 0
        if process.stdout:
            for line in process.stdout:
                key, separator, value = line.strip().partition("=")
                if not separator or key not in {"out_time_us", "out_time_ms"}:
                    continue
                try:
                    processed_secs = int(value) / 1_000_000
                except ValueError:
                    continue
                if duration_secs <= 0:
                    continue
                percent = min(99, max(0, round((processed_secs / duration_secs) * 100)))
                if progress and percent > last_percent:
                    last_percent = percent
                    progress(
                        1 + round(percent * (PREPARATION_CEILING_PERCENT - 1) / 100),
                        f"Making this video ready for local analysis ({percent}%)",
                    )
        if process.wait(timeout=60 * 60) != 0:
            error = process.stderr.read() if process.stderr else ""
            raise subprocess.SubprocessError(error.strip() or "ffmpeg failed")
    except (OSError, subprocess.SubprocessError) as error:
        normalized.unlink(missing_ok=True)
        raise RuntimeError(
            "This AV1 video could not be prepared for local analysis. Try exporting it as H.264 MP4."
        ) from error
    if progress:
        progress(PREPARATION_CEILING_PERCENT, "Video is ready for local analysis")
    return normalized, normalized


class JobService:
    def __init__(self, settings: Settings, store: Store):
        self.settings = settings
        self.store = store
        self.executor = ThreadPoolExecutor(max_workers=settings.workers, thread_name_prefix="video-job")

    def submit(self, job_id: str) -> None:
        self.executor.submit(self.run, job_id)

    def run(self, job_id: str, model_configuration: dict[str, object] | None = None) -> None:
        try:
            payload = {"modelConfiguration": model_configuration} if model_configuration else None
            with temporary_model_environment(payload) if payload else unchanged_model_environment():
                self._run(job_id)
        except Exception as error:
            logger.exception("Video indexing job %s failed", job_id)
            self.store.fail_job(job_id, str(error))

    def _run(self, job_id: str) -> None:
        job = self.store.get_job_for_worker(job_id)
        upload = self.store.get_upload(job["principal_id"], job["upload_id"])
        self.store.update_job(job_id, "probe", 1, "Preparing video for local analysis")
        transcoded = False

        def preparation_progress(percent: int, message: str) -> None:
            nonlocal transcoded
            transcoded = True
            self.store.update_job(job_id, "probe", percent, message)

        source_path, temporary_source = analysis_source(
            Path(upload["path"]), job_id, preparation_progress
        )
        try:
            def pipeline_progress(
                stage: str,
                percent: int,
                message: str,
                stage_percent: int,
                details: dict[str, int | float | str],
            ) -> None:
                # The pipeline reports 0-99 over its own work. It owns the
                # whole bar unless transcoding already used the front of
                # it, in which case it is scaled into the remainder.
                bounded = max(0, min(99, percent))
                mapped_percent = (
                    PREPARATION_CEILING_PERCENT
                    + round(bounded * (99 - PREPARATION_CEILING_PERCENT) / 99)
                    if transcoded
                    else bounded
                )
                self.store.update_job(
                    job_id,
                    stage,
                    min(99, mapped_percent),
                    message,
                    stage_percent,
                    details,
                )

            settings = Settings.from_env()
            result, actual_minutes = run_pipeline(
                source_path,
                job["request"]["brief"],
                settings.model_dir,
                settings.device,
                pipeline_progress,
                settings.disable_heavy_operators,
                settings.semantic_vision_enabled,
                settings.semantic_vision_model,
            )
        finally:
            if temporary_source:
                temporary_source.unlink(missing_ok=True)
        result["jobId"] = job_id
        self.store.finish_job(job_id, result, actual_minutes)
        if job["request"]["brief"].get("retainSourceHours", 0) == 0:
            Path(upload["path"]).unlink(missing_ok=True)
