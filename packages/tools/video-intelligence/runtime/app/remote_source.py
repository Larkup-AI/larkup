from __future__ import annotations

import subprocess
from pathlib import Path


def extract_bounded_remote_clip(
    source_url: str, destination: Path, start_secs: float, end_secs: float
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
    # RunPod's NVIDIA images expose NVENC. Keep a CPU fallback so a temporary
    # GPU codec issue cannot silently turn a bounded query into a full download.
    commands = [
        base + ["-c:v", "h264_nvenc", "-preset", "p4", "-c:a", "aac", str(destination)],
        base + ["-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", str(destination)],
    ]
    errors: list[str] = []
    for command in commands:
        completed = subprocess.run(command, capture_output=True, text=True)
        if completed.returncode == 0 and destination.exists() and destination.stat().st_size:
            return
        destination.unlink(missing_ok=True)
        errors.append((completed.stderr or "ffmpeg returned no diagnostic")[-800:])
    raise RuntimeError("could not create bounded remote clip: " + " | ".join(errors))


def materialize_remote_source(source_url: str, destination: Path) -> None:
    """Materialize a full source only for an unbounded indexing job."""
    completed = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            source_url,
            "-map",
            "0",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            "-y",
            str(destination),
        ],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0 or not destination.exists() or not destination.stat().st_size:
        destination.unlink(missing_ok=True)
        raise RuntimeError(
            "could not materialize remote source: "
            + (completed.stderr or "ffmpeg returned no diagnostic")[-800:]
        )
