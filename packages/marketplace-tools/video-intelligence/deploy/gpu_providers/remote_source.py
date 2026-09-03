from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Callable


PreparationProgress = Callable[[int, str], None]


def rebase_transcript_context(
    segments: list[dict[str, object]], start_secs: float, end_secs: float
) -> list[dict[str, object]]:
    """Align source-timeline speech with a temporary bounded clip."""
    rebased: list[dict[str, object]] = []
    for segment in segments:
        start_ms = float(segment.get("startMs") or 0)
        end_ms = float(segment.get("endMs") or 0)
        if end_ms < start_secs * 1_000 or start_ms > end_secs * 1_000:
            continue
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        rebased.append(
            {
                "startMs": round(max(0, start_ms - start_secs * 1_000)),
                "endMs": round(max(0, end_ms - start_secs * 1_000)),
                "text": text,
            }
        )
    return rebased


def extract_bounded_remote_clip(
    source_url: str,
    destination: Path,
    start_secs: float,
    end_secs: float,
    progress: PreparationProgress | None = None,
) -> None:
    """Seek the signed source remotely and retain only an exact analysis clip.

    S3 supports HTTP byte ranges, which FFmpeg uses while seeking. Re-encoding
    makes the clip start at the requested timestamp instead of the preceding
    keyframe, so evidence can safely be rebased onto the original timeline.
    """
    duration_secs = end_secs - start_secs
    if duration_secs <= 0:
        raise ValueError("bounded source inspection requires a non-empty range")
    base = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{start_secs:.3f}",
        "-i",
        source_url,
        "-t",
        f"{duration_secs:.3f}",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-movflags",
        "+faststart",
        "-y",
    ]
    # Both RunPod's and Modal's NVIDIA images expose NVENC. Keep a CPU
    # fallback so a temporary GPU codec issue cannot silently turn a bounded
    # query into a full download.
    commands = [
        (
            base
            + ["-c:v", "h264_nvenc", "-preset", "p4", "-c:a", "aac", str(destination)],
            0,
            70,
        ),
        (
            base
            + [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-c:a",
                "aac",
                str(destination),
            ],
            70,
            99,
        ),
    ]
    errors: list[str] = []
    for command, start_percent, end_percent in commands:
        succeeded, diagnostic = _run_ffmpeg_with_progress(
            command,
            duration_secs,
            _scaled_preparation_progress(progress, start_percent, end_percent),
        )
        if succeeded and destination.exists() and destination.stat().st_size:
            if progress:
                progress(99, "Cloud video is ready for visual analysis")
            return
        destination.unlink(missing_ok=True)
        errors.append(diagnostic[-800:])
    raise RuntimeError("could not create bounded remote clip: " + " | ".join(errors))


def materialize_remote_source(
    source_url: str,
    destination: Path,
    source_duration_secs: float | None = None,
    progress: PreparationProgress | None = None,
    prefer_stream_copy: bool = False,
) -> None:
    """Materialize an OpenCV-decodable full source for unbounded indexing.

    Copying the original codec lets audio transcription succeed while OpenCV
    silently yields zero frames for some browser-produced HEVC/AV1 sources.
    Normalize the visual stream exactly as bounded inspection does so OCR,
    tracking, and semantic VLM evidence cannot disappear from a full index.
    """
    base = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        source_url,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-movflags",
        "+faststart",
        "-y",
    ]
    # Fast coverage avoids a needless full-video re-encode when the uploaded
    # source is already OpenCV-friendly. Verify the copied codec before
    # accepting it; unfamiliar browser codecs take the normalized fallback.
    if prefer_stream_copy:
        copied = base + ["-c", "copy", str(destination)]
        succeeded, _ = _run_ffmpeg_with_progress(
            copied,
            source_duration_secs,
            _scaled_preparation_progress(progress, 0, 20),
        )
        if (
            succeeded
            and destination.exists()
            and destination.stat().st_size
            and _opencv_friendly_video(destination)
        ):
            if progress:
                progress(99, "Cloud video is ready for visual analysis")
            return
        destination.unlink(missing_ok=True)
    commands = [
        (
            base
            + ["-c:v", "h264_nvenc", "-preset", "p4", "-c:a", "aac", str(destination)],
            20,
            75,
        ),
        (
            base
            + [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-c:a",
                "aac",
                str(destination),
            ],
            75,
            99,
        ),
    ]
    errors: list[str] = []
    for command, start_percent, end_percent in commands:
        succeeded, diagnostic = _run_ffmpeg_with_progress(
            command,
            source_duration_secs,
            _scaled_preparation_progress(progress, start_percent, end_percent),
        )
        if succeeded and destination.exists() and destination.stat().st_size:
            if progress:
                progress(99, "Cloud video is ready for visual analysis")
            return
        destination.unlink(missing_ok=True)
        errors.append(diagnostic[-800:])
    raise RuntimeError("could not materialize remote source: " + " | ".join(errors))


def _run_ffmpeg_with_progress(
    command: list[str],
    duration_secs: float | None,
    progress: PreparationProgress | None,
) -> tuple[bool, str]:
    """Run FFmpeg while relaying its measured media timestamp, not a timer."""
    tracked_command = [*command[:-1], "-progress", "pipe:1", "-nostats", command[-1]]
    if progress:
        progress(0, "Preparing a Cloud-ready video copy")
    process = subprocess.Popen(
        tracked_command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    diagnostics: list[str] = []
    last_percent = -1
    assert process.stdout is not None
    for raw_line in process.stdout:
        line = raw_line.strip()
        if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
            try:
                value = float(line.split("=", 1)[1])
                # Both keys are microseconds in the FFmpeg progress protocol.
                elapsed_secs = value / 1_000_000
                percent = min(
                    99, max(0, round((elapsed_secs / (duration_secs or 0)) * 100))
                )
            except (TypeError, ValueError, ZeroDivisionError):
                continue
            if progress and percent > last_percent:
                progress(percent, f"Preparing Cloud video ({percent}%)")
                last_percent = percent
        elif line:
            diagnostics.append(line)
    process.stdout.close()
    return_code = process.wait()
    return return_code == 0, "\n".join(diagnostics) or "ffmpeg returned no diagnostic"


def _scaled_preparation_progress(
    progress: PreparationProgress | None, start_percent: int, end_percent: int
) -> PreparationProgress | None:
    """Reserve a monotonic progress slice for a codec attempt."""
    if progress is None:
        return None

    def report(percent: int, message: str) -> None:
        bounded = max(0, min(99, percent))
        scaled = start_percent + round((end_percent - start_percent) * bounded / 99)
        visible_message = (
            f"Preparing Cloud video ({scaled}%)"
            if message.startswith("Preparing Cloud video (")
            else message
        )
        progress(scaled, visible_message)

    return report


def _opencv_friendly_video(path: Path) -> bool:
    """Accept the cheap Fast path only for codecs OpenCV reliably opens."""
    completed = subprocess.run(
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
        capture_output=True,
        text=True,
    )
    return completed.returncode == 0 and completed.stdout.strip().lower() in {
        "h264",
        "mpeg4",
    }
