"""Orchestrates one video-indexing job: probe -> transcribe -> decode/detect/OCR
-> per-clip semantic captioning -> optional video embeddings -> the evidence
bundle returned to the caller. Everything else in this package (transcription,
vision, embedding, scene, motion) is a service this file calls in sequence;
this is the one place that ties them together.
"""

from __future__ import annotations

import bisect
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import math
import os
import shutil
import subprocess
import threading
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable, Iterator

import cv2
import numpy as np

from app.utils.timing import normalized_important_ranges, rebase_result_timestamps
from app.services.brain import (
    AgentPlanner,
    ExtractionPlan,
    PriorityRange,
    estimate_plan_runtime,
    fallback_plan,
)
from app.services.embedding import VideoClipInput, get_video_embedding_provider
from app.services.motion import MotionSampler
from app.services.scene import ClipBounds, SceneDetector
from app.services.transcription import TranscriptionService
from app.services.vision import SemanticVisionService

# (stage, overall percent, message, percent within this stage). A host that
# renders one bar per step needs the stage-relative figure; deriving it from
# the overall percent would mean keeping a second copy of PHASES in sync,
# so the pipeline reports both and the host never has to guess.
ProgressDetails = dict[str, int | float | str]
ProgressCallback = Callable[[str, int, str, int, ProgressDetails], None]

COCO_LABELS = (
    "person bicycle car motorcycle airplane bus train truck boat traffic-light fire-hydrant "
    "stop-sign parking-meter bench bird cat dog horse sheep cow elephant bear zebra giraffe "
    "backpack umbrella handbag tie suitcase frisbee skis snowboard sports-ball kite baseball-bat "
    "baseball-glove skateboard surfboard tennis-racket bottle wine-glass cup fork knife spoon bowl "
    "banana apple sandwich orange broccoli carrot hot-dog pizza donut cake chair couch potted-plant "
    "bed dining-table toilet tv laptop mouse remote keyboard cell-phone microwave oven toaster sink "
    "refrigerator book clock vase scissors teddy-bear hair-drier toothbrush"
).split()
# An overlay caption, title, or readout is short. Longer OCR lines are body
# text and stay in the ordinary visible-text index instead.
MAX_OVERLAY_TEXT_LENGTH = 64

# Each phase owns a slice of the bar. The slices are sized by how long the
# phase actually takes, not by how many steps it has, so the bar advances at
# roughly a constant rate: reading frames emits hundreds of milestones but is
# cheap, while captioning clips emits a handful and dominates the wall clock.
PHASES = {
    "plan": (1, 8),
    "scout": (8, 16),
    "transcribe": (16, 24),
    "replan": (24, 30),
    "segment": (30, 34),
    "frames": (34, 58),
    "describe": (58, 94),
    "synthesize": (94, 99),
}

# The phases each reported stage covers, in the order they run. `probe` owns
# three because planning resumes after transcription.
STAGE_PHASES = {
    "probe": ("plan", "scout", "replan"),
    "transcribe": ("transcribe",),
    "decode": ("segment",),
    "detect": ("frames",),
    "ocr": ("frames",),
    "synthesize": ("describe", "synthesize"),
}


def _stage_percent(stage: str, overall_percent: float) -> int:
    """How far through its own stage the job is, for a per-step host bar."""
    phases = STAGE_PHASES.get(stage)
    if not phases:
        return max(0, min(99, round(overall_percent)))
    start = min(PHASES[phase][0] for phase in phases)
    end = max(PHASES[phase][1] for phase in phases)
    return max(0, min(99, round((overall_percent - start) / (end - start) * 100)))


@dataclass(frozen=True)
class Probe:
    duration_seconds: float
    width: int
    height: int
    fps: float
    has_audio: bool


def _run(command: list[str]) -> str:
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    return completed.stdout


def transcription_hints(brief: dict[str, Any]) -> list[str]:
    """Return bounded explicit entity hints for speech recognition."""
    hints: list[str] = []
    for entity in brief.get("knownEntities") or []:
        if isinstance(entity, str) and entity.strip():
            hints.append(entity.strip())
    return list(dict.fromkeys(hints))[:100]


def probe_video(path: Path) -> Probe:
    if shutil.which("ffprobe") is None:
        return _probe_video_with_av(path)
    raw = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ]
    )
    data = json.loads(raw)
    video = next(
        (
            stream
            for stream in data.get("streams", [])
            if stream.get("codec_type") == "video"
        ),
        None,
    )
    if video is None:
        raise ValueError("the uploaded file does not contain a video stream")
    duration = float(
        video.get("duration") or data.get("format", {}).get("duration") or 0
    )
    rate = str(video.get("avg_frame_rate") or "0/1").split("/")
    fps = float(rate[0]) / max(float(rate[1]), 1) if len(rate) == 2 else 0
    return Probe(
        duration_seconds=max(duration, 0.001),
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        fps=max(fps, 0.001),
        has_audio=any(
            stream.get("codec_type") == "audio" for stream in data.get("streams", [])
        ),
    )


def _probe_video_with_av(path: Path) -> Probe:
    import av

    with av.open(str(path)) as container:
        video = next(
            (stream for stream in container.streams if stream.type == "video"), None
        )
        if video is None:
            raise ValueError("the uploaded file does not contain a video stream")
        stream_duration = (
            float(video.duration * video.time_base)
            if video.duration is not None and video.time_base is not None
            else 0
        )
        container_duration = (
            float(container.duration / av.time_base)
            if container.duration is not None
            else 0
        )
        return Probe(
            duration_seconds=max(stream_duration or container_duration, 0.001),
            width=int(video.width or 0),
            height=int(video.height or 0),
            fps=max(float(video.average_rate or 0), 0.001),
            has_audio=any(stream.type == "audio" for stream in container.streams),
        )


class VisualOperators:
    """Per-frame object detection (YOLOX/ONNX) and OCR (PaddleOCR/RapidOCR).

    Both load their model lazily on first use and stay resident for the rest
    of the job; `disabled` short-circuits both to empty results for a fast
    smoke run with no model weights available.
    """

    def __init__(self, model_dir: Path, device: str, disabled: bool = False) -> None:
        import threading

        self.model_dir = model_dir
        self.device = _resolve_device(device)
        self.disabled = disabled
        self._lock = threading.Lock()
        self._ocr: Any = None
        self._detector: Any = None

    def read_text(self, frame: np.ndarray) -> list[dict[str, Any]]:
        if self.disabled:
            return []
        with self._lock:
            if self._ocr is None:
                try:
                    from paddleocr import PaddleOCR

                    self._ocr = (
                        "paddle",
                        PaddleOCR(
                            use_doc_orientation_classify=False,
                            use_doc_unwarping=False,
                            use_textline_orientation=True,
                        ),
                    )
                except Exception:
                    from rapidocr_onnxruntime import RapidOCR

                    self._ocr = ("rapid", RapidOCR())
            engine_name, engine = self._ocr
            if engine_name == "paddle":
                return _normalize_ocr(engine.predict(frame))
            predictions, _ = engine(frame)
            return _normalize_rapid_ocr(predictions)

    def detect(self, frame: np.ndarray) -> list[dict[str, Any]]:
        if self.disabled:
            return []
        with self._lock:
            if self._detector is None:
                model = self.model_dir / "yolox_s.onnx"
                if not model.exists():
                    # OCR and semantic vision are independently useful. A
                    # local lightweight install may deliberately omit the
                    # detector weights, so retain the rest of the pipeline
                    # instead of failing an unrelated verification job.
                    self._detector = False
                    return []
                import onnxruntime as ort

                self._detector = ort.InferenceSession(
                    str(model),
                    providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
                )
            session = self._detector
        if session is False:
            return []
        return _detect_yolox(session, frame)


def _resolve_device(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import onnxruntime as ort

        return (
            "cuda"
            if "CUDAExecutionProvider" in ort.get_available_providers()
            else "cpu"
        )
    except ImportError:
        return "cpu"


def _normalize_ocr(predictions: Any) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for prediction in predictions or []:
        payload = getattr(prediction, "json", prediction)
        if callable(payload):
            payload = payload()
        if isinstance(payload, str):
            payload = json.loads(payload)
        if isinstance(payload, dict) and "res" in payload:
            payload = payload["res"]
        if not isinstance(payload, dict):
            continue
        texts = payload.get("rec_texts") or []
        scores = payload.get("rec_scores") or []
        boxes = payload.get("rec_boxes") or payload.get("dt_polys") or []
        for index, text in enumerate(texts):
            clean = str(text).strip()
            if not clean:
                continue
            box = (
                np.asarray(boxes[index]).reshape(-1, 2)
                if index < len(boxes)
                else np.zeros((0, 2))
            )
            lines.append(
                {
                    "text": clean,
                    "confidence": round(
                        float(scores[index]) if index < len(scores) else 0, 4
                    ),
                    "box": box.astype(float).round(1).tolist(),
                }
            )
    return lines


def _normalize_rapid_ocr(predictions: Any) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for prediction in predictions or []:
        if not isinstance(prediction, (list, tuple)) or len(prediction) < 3:
            continue
        points, text, confidence = prediction[:3]
        if not text:
            continue
        lines.append(
            {
                "text": str(text).strip(),
                "confidence": round(float(confidence), 4),
                "box": [[round(float(x), 2), round(float(y), 2)] for x, y in points],
            }
        )
    return lines


def _detect_yolox(
    session: Any, frame: np.ndarray, confidence: float = 0.3
) -> list[dict[str, Any]]:
    input_size = 640
    height, width = frame.shape[:2]
    ratio = min(input_size / height, input_size / width)
    resized = cv2.resize(frame, (round(width * ratio), round(height * ratio)))
    padded = np.full((input_size, input_size, 3), 114, dtype=np.uint8)
    padded[: resized.shape[0], : resized.shape[1]] = resized
    tensor = padded.transpose(2, 0, 1).astype(np.float32)[None, ...]
    output = np.asarray(
        session.run(None, {session.get_inputs()[0].name: tensor})[0]
    ).squeeze(0)

    grids: list[np.ndarray] = []
    strides: list[np.ndarray] = []
    for stride in (8, 16, 32):
        size = input_size // stride
        grid_x, grid_y = np.meshgrid(np.arange(size), np.arange(size))
        grids.append(np.stack((grid_x, grid_y), axis=2).reshape(-1, 2))
        strides.append(np.full((size * size, 1), stride))
    grid = np.concatenate(grids)
    expanded_stride = np.concatenate(strides)
    output[:, :2] = (output[:, :2] + grid) * expanded_stride
    output[:, 2:4] = np.exp(output[:, 2:4]) * expanded_stride
    class_ids = np.argmax(output[:, 5:], axis=1)
    scores = output[:, 4] * output[np.arange(len(output)), class_ids + 5]
    keep = scores >= confidence
    boxes = output[keep, :4]
    scores = scores[keep]
    class_ids = class_ids[keep]
    if not len(boxes):
        return []
    xywh = (
        np.column_stack(
            (
                boxes[:, 0] - boxes[:, 2] / 2,
                boxes[:, 1] - boxes[:, 3] / 2,
                boxes[:, 2],
                boxes[:, 3],
            )
        )
        / ratio
    )
    indices = cv2.dnn.NMSBoxes(xywh.tolist(), scores.tolist(), confidence, 0.45)
    detections: list[dict[str, Any]] = []
    for index in np.asarray(indices).reshape(-1):
        x, y, w, h = xywh[index]
        class_id = int(class_ids[index])
        detections.append(
            {
                "label": (
                    COCO_LABELS[class_id]
                    if class_id < len(COCO_LABELS)
                    else str(class_id)
                ),
                "classId": class_id,
                "confidence": round(float(scores[index]), 4),
                "box": [
                    round(float(x), 1),
                    round(float(y), 1),
                    round(float(x + w), 1),
                    round(float(y + h), 1),
                ],
            }
        )
    return detections


def _recurring_overlay_text(
    occurrences: dict[str, list[int]],
    confidence_totals: dict[str, float],
    limit: int = 120,
) -> list[dict[str, Any]]:
    """Summarise short on-screen text that persists or recurs over time.

    A title card, slide heading, lower-third name, dashboard readout, caption,
    timer, or any other overlay shares one property regardless of what the
    video is about: the same short string is legible in several frames. Those
    strings are strong navigation anchors -- they say where a display was
    present and when it changed -- so they are recorded with their full
    timestamp trail. They remain observations of *text*, never a claim about
    what the text means; interpreting one is the vision reader's job.
    """
    summaries: list[dict[str, Any]] = []
    for text, times in occurrences.items():
        if len(times) < 2 or len(text) > MAX_OVERLAY_TEXT_LENGTH:
            continue
        ordered = sorted(times)
        summaries.append(
            {
                "text": text,
                "firstSeenMs": ordered[0],
                "lastSeenMs": ordered[-1],
                "observations": len(ordered),
                "timestampsMs": ordered[:60],
                "confidence": round(confidence_totals.get(text, 0.0) / len(ordered), 4),
            }
        )
    # Longer-lived overlays anchor more of the source, so they are the ones
    # worth keeping when the cap is reached.
    summaries.sort(
        key=lambda item: (-int(item["observations"]), int(item["firstSeenMs"]))
    )
    return sorted(summaries[:limit], key=lambda item: int(item["firstSeenMs"]))


def _iter_frames(
    path: Path,
    probe: Probe,
    brief: dict[str, Any],
    plan: ExtractionPlan,
) -> Iterator[tuple[int, np.ndarray, int, int]]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError("OpenCV could not decode the uploaded video")
    important_ranges = normalized_important_ranges(brief, probe.duration_seconds)
    ranges = important_ranges or [(0.0, probe.duration_seconds)]
    priority_ranges = [
        (item.start_secs, item.end_secs) for item in plan.priority_ranges
    ]
    timestamps: set[float] = set()
    for start, end in ranges:
        cursor = start
        while cursor <= end + 0.001:
            timestamps.add(round(cursor, 3))
            cursor += plan.sample_interval_secs
        timestamps.add(round(end, 3))
    for priority_start, priority_end in priority_ranges:
        for range_start, range_end in ranges:
            start, end = max(priority_start, range_start), min(priority_end, range_end)
            cursor = start
            while cursor <= end + 0.001:
                timestamps.add(round(cursor, 3))
                cursor += plan.priority_sample_interval_secs
    requested_timestamps = sorted(timestamps)
    requested_samples = max(1, len(requested_timestamps))
    try:
        for sample_index, timestamp_secs in enumerate(requested_timestamps, start=1):
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp_secs * 1_000)
            ok, frame = capture.read()
            if not ok:
                continue
            actual_timestamp_secs = float(capture.get(cv2.CAP_PROP_POS_MSEC)) / 1_000
            yield (
                round(actual_timestamp_secs * 1_000),
                frame,
                sample_index,
                requested_samples,
            )
    finally:
        capture.release()


def _intersection_over_union(left: list[float], right: list[float]) -> float:
    x1, y1 = max(left[0], right[0]), max(left[1], right[1])
    x2, y2 = min(left[2], right[2]), min(left[3], right[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    union = left_area + right_area - intersection
    return intersection / union if union else 0.0


class AnonymousTracker:
    def __init__(self) -> None:
        self.next_id = 1
        self.tracks: dict[int, dict[str, Any]] = {}

    def update(self, detections: list[dict[str, Any]], time_ms: int) -> None:
        claimed: set[int] = set()
        for detection in sorted(detections, key=lambda item: -item["confidence"]):
            candidates = [
                (track_id, _intersection_over_union(track["lastBox"], detection["box"]))
                for track_id, track in self.tracks.items()
                if track_id not in claimed
                and track["label"] == detection["label"]
                and time_ms - track["endMs"] <= 6_000
            ]
            track_id, overlap = max(
                candidates, key=lambda item: item[1], default=(0, 0.0)
            )
            if overlap < 0.2:
                track_id = self.next_id
                self.next_id += 1
                self.tracks[track_id] = {
                    "trackId": track_id,
                    "classId": detection["classId"],
                    "label": detection["label"],
                    "startMs": time_ms,
                    "endMs": time_ms,
                    "observations": 0,
                    "confidenceTotal": 0.0,
                    "lastBox": detection["box"],
                }
            track = self.tracks[track_id]
            track["endMs"] = time_ms
            track["observations"] += 1
            track["confidenceTotal"] += detection["confidence"]
            track["lastBox"] = detection["box"]
            detection["trackId"] = track_id
            claimed.add(track_id)

    def summaries(self) -> list[dict[str, Any]]:
        return [
            {
                "trackId": track["trackId"],
                "classId": track["classId"],
                "label": track["label"],
                "startMs": track["startMs"],
                "endMs": track["endMs"],
                "observations": track["observations"],
                "confidence": round(
                    track["confidenceTotal"] / max(track["observations"], 1), 4
                ),
            }
            for track in self.tracks.values()
        ]


def _retain_clip_frame(
    sampler: MotionSampler,
    frames: list[tuple[int, np.ndarray]],
    scores: list[float],
    time_ms: int,
    frame: np.ndarray,
    limit: int,
    previous_gray: np.ndarray | None,
) -> np.ndarray:
    """Keeps a motion-biased, temporally-spread sample within one clip's frame bucket.

    `scores` runs parallel to `frames`, holding each retained frame's motion
    score at the moment it was captured. Eviction protects high-motion
    frames -- a likely action, reveal, or state change -- over pure temporal
    spacing alone, while an interior low-motion frame remains the first to
    go, so coverage still spans the whole clip. Returns this frame's
    grayscale, to thread into the next call's `previous_gray`.
    """
    motion_score, gray = sampler.score_frame(frame, previous_gray)
    if len(frames) < limit:
        frames.append((time_ms, frame.copy()))
        scores.append(motion_score)
        return gray
    times = [item[0] for item in frames] + [time_ms]
    images = [item[1] for item in frames] + [frame.copy()]
    all_scores = scores + [motion_score]
    order = sorted(range(len(times)), key=lambda index: times[index])
    times = [times[index] for index in order]
    images = [images[index] for index in order]
    all_scores = [all_scores[index] for index in order]
    gaps = [times[index + 1] - times[index] for index in range(len(times) - 1)]
    if not gaps:
        return gray

    def removability(index: int) -> float:
        # min() below evicts the smallest score, so a larger motion weight
        # here must make a frame LESS likely to be picked -- i.e. protected.
        gap_score = gaps[index - 1] + gaps[index]
        motion_weight = 1.0 + all_scores[index]
        return gap_score * motion_weight

    remove_index = min(range(1, len(times) - 1), key=removability)
    del times[remove_index]
    del images[remove_index]
    del all_scores[remove_index]
    frames[:] = list(zip(times, images))
    scores[:] = all_scores
    return gray


class SmoothProgress:
    """Reports measured milestones and separate liveness heartbeats.

    Percent only changes when work completes. While a provider request is in
    flight, a heartbeat refreshes the same measured state so the host can
    distinguish a healthy long request from a dead worker without inventing
    progress that later parks at a phase ceiling.
    """

    def __init__(self, emit: ProgressCallback, tick_seconds: float = 1.0) -> None:
        self._emit = emit
        self._tick_seconds = tick_seconds
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._stage = "probe"
        self._message = "Preparing"
        self._percent = 0.0
        self._reported: tuple[int, int] | None = None
        self._anchor_percent = 0.0
        self._anchor_at = time.monotonic()
        self._ceiling = 99.0
        # How long a phase is expected to take. The curve is scaled to it so a
        # slow phase drifts slowly and a quick one settles near its ceiling.
        self._span_seconds = 60.0
        self._started_at = time.monotonic()
        self._estimated_total_seconds: float | None = None
        self._eta_override_seconds: float | None = None
        self._eta_override_at = self._started_at
        self._current: int | None = None
        self._total: int | None = None
        self._unit: str | None = None
        self._sequence = 0

    def configure_eta(self, estimated_total_seconds: float) -> None:
        """Set the current whole-pipeline estimate without resetting elapsed time."""
        with self._lock:
            self._estimated_total_seconds = max(1.0, estimated_total_seconds)
            self._eta_override_seconds = None
            self._reported = None
            self._flush()

    def milestone(
        self,
        stage: str,
        percent: float,
        message: str,
        ceiling: float | None = None,
        estimated_remaining_seconds: float | None = None,
    ) -> None:
        """Record real progress: a step that actually completed."""
        with self._lock:
            self._stage = stage
            self._message = message
            self._percent = max(self._percent, min(99.0, percent))
            self._anchor_percent = self._percent
            self._anchor_at = time.monotonic()
            self._ceiling = max(
                self._percent, min(99.0, ceiling if ceiling is not None else 99.0)
            )
            self._current = None
            self._total = None
            self._unit = None
            self._eta_override_seconds = (
                max(0.0, estimated_remaining_seconds)
                if estimated_remaining_seconds is not None
                else None
            )
            self._eta_override_at = self._anchor_at
            self._flush()

    def phase(
        self,
        stage: str,
        percent: float,
        message: str,
        ceiling: float,
        span_seconds: float,
        estimated_remaining_seconds: float | None = None,
    ) -> None:
        """Enter a phase that will drift from `percent` toward `ceiling`."""
        with self._lock:
            self._span_seconds = max(5.0, span_seconds)
        self.milestone(
            stage,
            percent,
            message,
            ceiling,
            estimated_remaining_seconds,
        )

    def step(
        self,
        stage: str,
        completed: int,
        total: int,
        message: str,
        band: tuple[int, int],
        span_seconds: float | None = None,
        estimated_remaining_seconds: float | None = None,
        unit: str = "units",
    ) -> None:
        """Report progress through a phase of `total` countable units.

        The bar sits where the finished units put it, and may drift only as
        far as the *next* unit would reach. So a phase whose units run slower
        than predicted creeps and waits, rather than sailing up to the end of
        its band and then sitting there while most of the work is still
        outstanding.
        """
        start, end = band
        total = max(1, total)
        completed = max(0, min(total, completed))
        width = end - start
        if span_seconds is not None:
            with self._lock:
                self._span_seconds = max(5.0, span_seconds)
        with self._lock:
            self._stage = stage
            self._message = message
            self._percent = max(
                self._percent, min(99.0, start + width * completed / total)
            )
            self._anchor_percent = self._percent
            self._anchor_at = time.monotonic()
            self._ceiling = max(
                self._percent,
                min(99.0, start + width * min(total, completed + 1) / total),
            )
            self._current = completed
            self._total = total
            self._unit = unit
            if estimated_remaining_seconds is not None:
                self._eta_override_seconds = max(0.0, estimated_remaining_seconds)
                self._eta_override_at = self._anchor_at
            self._flush()

    def message(self, message: str) -> None:
        """Change the status text without claiming any additional progress."""
        with self._lock:
            self._message = message
            self._reported = None
            self._flush()

    def _flush(self, force: bool = False) -> None:
        percent = round(self._percent)
        stage_percent = _stage_percent(self._stage, self._percent)
        report_key = (percent, stage_percent)
        if report_key == self._reported and not force:
            return
        self._reported = report_key
        self._sequence += 1
        elapsed_seconds = max(0.0, time.monotonic() - self._started_at)
        remaining_candidates: list[float] = []
        if self._estimated_total_seconds is not None:
            remaining_candidates.append(
                max(0.0, self._estimated_total_seconds - elapsed_seconds)
            )
            # Do not infer wall time from overall percent velocity: phase
            # bands express workflow weight, not equal seconds. That shortcut
            # turned a nearly-finished short clip into a three-minute ETA.
            # Countable phases install a measured override below.
        if self._eta_override_seconds is not None:
            # A countable phase has measured throughput. Once that exists it
            # is more trustworthy than the conservative whole-job budget;
            # keeping the older estimate in a max() made the UI say ten
            # minutes while the clip counter correctly said under a minute.
            remaining_candidates = [
                max(
                    0.0,
                    self._eta_override_seconds
                    - (time.monotonic() - self._eta_override_at),
                )
            ]
        details: ProgressDetails = {
            "sequence": self._sequence,
            "elapsedSeconds": round(elapsed_seconds),
        }
        if remaining_candidates:
            # Zero explicitly clears an expired estimate in hosts that merge
            # progress patches. Keeping a one-second floor made the UI promise
            # "1 second left" indefinitely during an over-budget model call.
            details["estimatedRemainingSeconds"] = max(
                0, round(max(remaining_candidates))
            )
        if self._current is not None and self._total is not None:
            details.update(
                {
                    "current": self._current,
                    "total": self._total,
                    "unit": self._unit or "units",
                }
            )
        self._emit(self._stage, percent, self._message, stage_percent, details)

    def _heartbeat(self) -> None:
        while not self._stop.wait(self._tick_seconds):
            with self._lock:
                self._flush(force=True)

    def __enter__(self) -> SmoothProgress:
        self._thread = threading.Thread(target=self._heartbeat, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_exception: object) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=self._tick_seconds * 2)


def semantic_frames_per_clip(
    indexing_mode: str, targeted_verification: bool, dense_content: bool
) -> int:
    """Choose a bounded visual sample budget for one semantic clip."""
    if indexing_mode == "thorough" and targeted_verification:
        return 16
    if targeted_verification:
        return 10
    return 8 if dense_content else 4


def semantic_frame_budget(brief: dict[str, Any], planned_frames: int) -> int:
    """Honor an agent's bounded close-read budget without changing full indexing."""
    if not brief.get("continuousSequence"):
        return planned_frames
    try:
        requested = int(brief.get("maxFrames") or planned_frames)
    except (TypeError, ValueError):
        requested = planned_frames
    return max(planned_frames, min(24, max(1, requested)))


def _semantic_clip_budget(mode: str, duration_seconds: float, available: int) -> int:
    """Bound model-read clips while scaling predictably with source length.

    A full index is a navigation skim, not the final close-read. The later chat
    phase can re-open a bounded source range when a question needs more detail.
    These rates keep chronological coverage while preventing a long source from
    turning into hundreds of nearly-identical model calls.
    """
    clips_per_hour = {"fast": 30, "balanced": 60, "thorough": 180}.get(mode, 60)
    minimum = {"fast": 12, "balanced": 24, "thorough": 48}.get(mode, 24)
    return min(
        available, max(minimum, math.ceil(duration_seconds / 3_600 * clips_per_hour))
    )


def _select_semantic_clip_ids(
    clip_plan: list[ClipBounds],
    clip_frame_scores: dict[str, list[float]],
    observations: list[dict[str, Any]],
    transcript: list[dict[str, Any]],
    priority_ranges: list[PriorityRange],
    mode: str,
    duration_seconds: float,
) -> list[str]:
    """Choose a generic coverage-and-salience skim without content-type rules."""
    if not clip_plan:
        return []
    budget = _semantic_clip_budget(mode, duration_seconds, len(clip_plan))
    if budget >= len(clip_plan):
        return [clip.clip_id for clip in clip_plan]

    evidence_times = [
        float(item.get("timeMs") or 0) / 1_000
        for item in observations
        if (item.get("objects") or item.get("ocr"))
    ]
    scored: list[tuple[float, int, ClipBounds]] = []
    priority_ids: set[str] = set()
    for index, clip in enumerate(clip_plan):
        motion = clip_frame_scores.get(clip.clip_id) or []
        motion_score = (max(motion, default=0.0) * 1.5) + (
            sum(motion) / max(1, len(motion))
        )
        local_evidence = sum(
            clip.start_secs <= time <= clip.end_secs for time in evidence_times
        )
        speech_chars = sum(
            len(str(segment.get("text") or ""))
            for segment in transcript
            if float(segment.get("endMs") or 0) / 1_000 >= clip.start_secs
            and float(segment.get("startMs") or 0) / 1_000 <= clip.end_secs
        )
        prioritized = any(
            clip.start_secs < item.end_secs and clip.end_secs > item.start_secs
            for item in priority_ranges
        )
        if prioritized:
            priority_ids.add(clip.clip_id)
        # Motion, visible evidence, and local speech density are all generic
        # signals. A tiny chronological tie-break keeps selection deterministic.
        score = (
            motion_score
            + local_evidence * 8
            + min(12.0, speech_chars / 80)
            + (100 if prioritized else 0)
        )
        scored.append((score, index, clip))

    selected: set[str] = set(priority_ids)
    # Divide the source into equal chronological buckets and keep the most
    # informative clip in each. This guarantees whole-video coverage while
    # behaving like a person who skims and pauses on change-rich moments.
    for bucket in range(budget):
        start = math.floor(bucket * len(scored) / budget)
        end = max(start + 1, math.floor((bucket + 1) * len(scored) / budget))
        candidates = scored[start:end]
        if candidates:
            selected.add(
                max(candidates, key=lambda item: (item[0], -item[1]))[2].clip_id
            )
    return [clip.clip_id for clip in clip_plan if clip.clip_id in selected]


def _evenly_spaced_frames(
    frames: list[tuple[int, np.ndarray]],
    limit: int,
) -> list[tuple[int, np.ndarray]]:
    """Select a deterministic bounded chronology while preserving both ends."""
    ordered = sorted({time_ms: frame for time_ms, frame in frames}.items())
    if len(ordered) <= limit:
        return ordered
    return [
        ordered[round(index * (len(ordered) - 1) / max(1, limit - 1))]
        for index in range(limit)
    ]


def _scout_video(
    path: Path,
    probe: Probe,
    operators: VisualOperators,
    plan: ExtractionPlan,
    smooth: SmoothProgress,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    """Collects a bounded, reusable source reconnaissance for plan refinement.

    This is intentionally local and model-free. The first agent decision says
    whether OCR is worth loading; the scout then returns chronological visual
    change and optional text signals to the refinement call. Frames inspected
    here become ordinary timestamped observations, avoiding discarded work.
    """
    scout_start, scout_end = PHASES["scout"]
    scout_middle = scout_start + (scout_end - scout_start) / 2
    budget = {"fast": 8, "balanced": 14, "thorough": 24}[plan.mode]
    budget = min(budget, max(2, round(probe.duration_seconds) + 1))
    timestamps = (
        [0.0]
        if budget <= 1
        else [probe.duration_seconds * index / (budget - 1) for index in range(budget)]
    )
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        return {"frames": [], "visualChangePeaks": [], "ocr": []}, [], []
    frames: list[tuple[int, np.ndarray, float, float]] = []
    previous_gray: np.ndarray | None = None
    try:
        for index, timestamp_secs in enumerate(timestamps):
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp_secs * 1_000)
            ok, frame = capture.read()
            if not ok:
                continue
            actual_ms = round(float(capture.get(cv2.CAP_PROP_POS_MSEC)))
            thumbnail = cv2.resize(frame, (96, 54), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(thumbnail, cv2.COLOR_BGR2GRAY)
            change = (
                0.0
                if previous_gray is None
                else float(np.mean(cv2.absdiff(gray, previous_gray)))
            )
            brightness = float(np.mean(gray))
            frames.append((actual_ms, frame, change, brightness))
            previous_gray = gray
            # The scout owns the first half of its slice; reading text owns
            # the second, so both parts of the phase visibly advance.
            scanned = (index + 1) / max(len(timestamps), 1)
            smooth.milestone(
                "probe",
                scout_start + scanned * (scout_middle - scout_start),
                f"Reading video signals ({index + 1}/{len(timestamps)})",
            )
    finally:
        capture.release()

    ocr_budget = (
        {"fast": 3, "balanced": 6, "thorough": 10}[plan.mode] if plan.use_ocr else 0
    )
    selected_for_ocr = sorted(
        range(len(frames)), key=lambda index: frames[index][2], reverse=True
    )[:ocr_budget]
    if frames and ocr_budget:
        selected_for_ocr = list(dict.fromkeys([0, len(frames) - 1, *selected_for_ocr]))[
            :ocr_budget
        ]
    observations: list[dict[str, Any]] = []
    ocr_signals: list[dict[str, Any]] = []
    for ocr_index, frame_index in enumerate(selected_for_ocr):
        time_ms, frame, _, _ = frames[frame_index]
        # Loading the text reader takes a while on its first frame, so this
        # part of the phase gets its own drift rather than sitting still.
        read = (ocr_index + 1) / max(len(selected_for_ocr), 1)
        smooth.phase(
            "probe",
            scout_middle
            + (read - 1 / max(len(selected_for_ocr), 1)) * (scout_end - scout_middle),
            "Reading visible text signals",
            scout_middle + read * (scout_end - scout_middle),
            30,
        )
        lines = operators.read_text(frame)
        if lines:
            observations.append({"timeMs": time_ms, "objects": [], "ocr": lines})
            ocr_signals.extend(
                {
                    "timeMs": time_ms,
                    "text": str(line.get("text") or "")[:160],
                    "confidence": round(float(line.get("confidence") or 0), 3),
                }
                for line in lines[:20]
            )
    ranked_changes = sorted(frames, key=lambda item: item[2], reverse=True)[:12]
    visual_indices = sorted(
        set(
            [0, max(0, len(frames) - 1)]
            + sorted(
                range(len(frames)), key=lambda index: frames[index][2], reverse=True
            )[:2]
        )
    )[:4]
    visual_samples: list[dict[str, Any]] = []
    for index in visual_indices:
        time_ms, frame, _, _ = frames[index]
        height, width = frame.shape[:2]
        if width > 480:
            frame = cv2.resize(
                frame,
                (480, max(1, round(height * 480 / width))),
                interpolation=cv2.INTER_AREA,
            )
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 65])
        if ok:
            visual_samples.append(
                {
                    "timeMs": time_ms,
                    "dataUrl": "data:image/jpeg;base64,"
                    + base64.b64encode(encoded.tobytes()).decode("ascii"),
                }
            )
    signals = {
        "frames": [
            {
                "timeMs": item[0],
                "change": round(item[2], 2),
                "brightness": round(item[3], 2),
            }
            for item in frames
        ],
        "visualChangePeaks": [
            {"timeMs": item[0], "change": round(item[2], 2)}
            for item in ranked_changes
            if item[2] > 0
        ],
        "ocr": ocr_signals[:80],
        "visualSamples": [{"timeMs": item["timeMs"]} for item in visual_samples],
    }
    return signals, observations, visual_samples


def _planner_transcript_signal(
    transcript: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Bound long transcripts while preserving chronological coverage."""
    if not transcript:
        return []
    step = max(1, math.ceil(len(transcript) / 120))
    return [
        {
            "startMs": round(float(segment.get("startMs") or 0)),
            "endMs": round(float(segment.get("endMs") or 0)),
            "text": str(segment.get("text") or "").strip()[:240],
        }
        for segment in transcript[::step]
        if str(segment.get("text") or "").strip()
    ][:120]


def _compute_video_embeddings(
    clip_plan: list[ClipBounds],
    clip_frames: dict[str, list[tuple[int, np.ndarray]]],
    progress: Callable[[str, int, str], None],
    on_clip_progress: Callable[[int, int], None] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Runs the configured video-embedding provider over the same per-clip frame
    buckets semantic vision already collected, so there is no extra decode
    pass. Disabled by default; a provider failure degrades to
    caption/OCR/transcript-only retrieval rather than failing the job.
    """
    provider_name = (
        os.getenv("LARKUP_VIDEO_EMBEDDING_PROVIDER", "disabled").strip().lower()
    )
    fallback_provider_name = (
        os.getenv(
            "LARKUP_VIDEO_EMBEDDING_FALLBACK_PROVIDER",
            "gateway-gemini-embedding-2",
        )
        .strip()
        .lower()
    )
    diagnostics: dict[str, Any] = {
        "attempted": False,
        "requestedProvider": provider_name,
        "provider": provider_name,
        "fallbackProvider": None,
        "fallbackUsed": False,
        "primaryError": None,
        "error": None,
    }
    if provider_name == "disabled" or not any(clip_frames.values()):
        return [], diagnostics
    diagnostics["attempted"] = True
    clip_inputs = [
        VideoClipInput(
            clip_id=clip.clip_id,
            start_ms=round(clip.start_secs * 1_000),
            end_ms=round(clip.end_secs * 1_000),
            frames=clip_frames[clip.clip_id],
        )
        for clip in clip_plan
        if clip_frames[clip.clip_id]
    ]
    total_clips = len(clip_inputs)
    describe_start, describe_end = PHASES["describe"]
    progress(
        "synthesize",
        describe_start,
        f"Creating the visual search index (0/{total_clips} clips)",
    )

    def report_embedding_progress(completed: int, total: int) -> None:
        if total <= 0:
            return
        if on_clip_progress:
            on_clip_progress(completed, total)
            return
        percent = describe_start + (completed / total) * (describe_end - describe_start)
        progress(
            "synthesize",
            round(percent),
            f"Creating the visual search index ({completed}/{total} clips)",
        )

    provider_attempts = [provider_name]
    if fallback_provider_name not in {"", "disabled", provider_name}:
        provider_attempts.append(fallback_provider_name)

    errors: list[str] = []
    for attempt, candidate_name in enumerate(provider_attempts):
        try:
            if attempt:
                progress(
                    "synthesize",
                    describe_start,
                    "Primary visual search index unavailable; switching provider",
                )
            provider = get_video_embedding_provider(candidate_name)
            embeddings = provider.embed_clips(clip_inputs, report_embedding_progress)
            diagnostics["provider"] = provider.name
            if attempt:
                diagnostics["fallbackProvider"] = provider.name
                diagnostics["fallbackUsed"] = True
                diagnostics["primaryError"] = errors[0]
            return (
                [
                    {
                        "clipId": embedding.clip_id,
                        "startMs": embedding.start_ms,
                        "endMs": embedding.end_ms,
                        "vector": embedding.vector,
                        "dimensions": len(embedding.vector),
                        "provider": provider.name,
                    }
                    for embedding in embeddings
                ],
                diagnostics,
            )
        except Exception as error:
            errors.append(f"{type(error).__name__}: {error}"[:500])

    diagnostics["primaryError"] = errors[0] if errors else None
    diagnostics["error"] = "; fallback: ".join(errors)[:500] if errors else None
    return [], diagnostics


def _require_semantic_coverage(
    *,
    expected: int,
    actual: int,
    provider_error: str | None,
    minimum_ratio: float = 0.8,
) -> None:
    """Reject a misleading success when most planned visual evidence is absent."""
    if expected <= 0:
        return
    required = max(1, math.ceil(expected * minimum_ratio))
    if actual >= required:
        return
    detail = (
        provider_error or "the configured vision provider returned no usable evidence"
    )
    raise RuntimeError(
        f"semantic vision coverage {actual}/{expected} is below the required {required}/{expected}: "
        f"{detail[:500]}"
    )


def _link_chronological_notes(
    observations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Order clip evidence before synthesis builds genuine cross-scene continuity.

    Repeating the previous independently generated caption only looked linked,
    often duplicated mistakes, and could inject English into another language.
    The synthesis sees the whole ordered source and resolves the actual story.
    """
    return sorted(
        observations,
        key=lambda item: (float(item.get("startMs") or 0), float(item.get("endMs") or 0)),
    )


def _apply_video_embedding_policy(
    plan: ExtractionPlan,
    brief: dict[str, Any],
    provider_name: str | None = None,
) -> ExtractionPlan:
    """Build cross-modal retrieval vectors for every offline index.

    The planner decides how to read a source, but it must not accidentally
    omit the retrieval index the answering agent depends on later. Bounded
    live inspections opt out explicitly because their evidence is returned
    directly and cannot benefit from vectors created in the same request.
    """
    selected_provider = (
        (provider_name or os.getenv("LARKUP_VIDEO_EMBEDDING_PROVIDER", "disabled"))
        .strip()
        .lower()
    )
    enabled = not brief.get("skipVideoEmbeddings") and selected_provider != "disabled"
    return replace(plan, use_video_embeddings=enabled)


def run_pipeline(
    path: Path,
    brief: dict[str, Any],
    model_dir: Path,
    device: str,
    progress: ProgressCallback,
    disable_heavy_operators: bool = False,
    semantic_vision_enabled: bool = True,
    semantic_vision_model: str = "",
    timestamp_offset_secs: float = 0.0,
    source_duration_secs: float | None = None,
) -> tuple[dict[str, Any], float]:
    pipeline_started = time.monotonic()
    with SmoothProgress(progress) as smooth:
        return _run_pipeline(
            path,
            brief,
            model_dir,
            device,
            smooth,
            pipeline_started,
            disable_heavy_operators,
            semantic_vision_enabled,
            timestamp_offset_secs,
            source_duration_secs,
        )


def _run_pipeline(
    path: Path,
    brief: dict[str, Any],
    model_dir: Path,
    device: str,
    smooth: SmoothProgress,
    pipeline_started: float,
    disable_heavy_operators: bool,
    semantic_vision_enabled: bool,
    timestamp_offset_secs: float,
    source_duration_secs: float | None,
) -> tuple[dict[str, Any], float]:
    smooth.phase(
        "probe", PHASES["plan"][0], "Reading video metadata", PHASES["plan"][1], 20
    )
    probe = probe_video(path)
    important_ranges = normalized_important_ranges(brief, probe.duration_seconds)
    interactive = brief.get("interactive") is True
    skip_heavy_operators = disable_heavy_operators or bool(
        brief.get("skipHeavyOperators")
    )
    operators = VisualOperators(model_dir, device, skip_heavy_operators)
    transcription = TranscriptionService(operators.device)
    planner = AgentPlanner()
    smooth.message(
        "Preparing the bounded visual read"
        if interactive
        else "Choosing the first-pass evidence tools"
    )
    # A chat refinement has already bounded the source and supplied a focused
    # question. General planning plus final timeline synthesis add two remote
    # model turns without changing the one visual answer it needs, so its fast
    # lane uses the deterministic, validated fast policy instead.
    plan = (
        fallback_plan(str(brief.get("indexingMode")), probe.duration_seconds, probe.has_audio)
        if interactive
        else planner.plan(
            brief=brief,
            duration_secs=probe.duration_seconds,
            width=probe.width,
            height=probe.height,
            fps=probe.fps,
            has_audio=probe.has_audio,
        )
    )

    transcript: list[dict[str, Any]] = [
        dict(segment)
        for segment in (brief.get("transcriptContext") or [])
        if isinstance(segment, dict)
    ]
    detected_language: str | None = None
    transcription_error: BaseException | None = None
    transcription_units = {"completed": 0, "total": 1}
    transcription_units_lock = threading.Lock()

    def _transcription_progress(completed: int, total: int) -> None:
        with transcription_units_lock:
            transcription_units["completed"] = max(0, min(total, completed))
            transcription_units["total"] = max(1, total)

    def _run_transcription() -> None:
        nonlocal transcript, detected_language, transcription_error
        try:
            raw_transcript, language = transcription.transcribe(
                path,
                None if brief.get("language") == "auto" else brief.get("language"),
                transcription_hints(brief),
                probe.duration_seconds,
                _transcription_progress,
            )
            if important_ranges:
                raw_transcript = [
                    segment
                    for segment in raw_transcript
                    if segment["endMs"] / 1_000 >= important_ranges[0][0]
                    and segment["startMs"] / 1_000 <= important_ranges[-1][1]
                ]
            transcript, detected_language = raw_transcript, language
        except (
            BaseException
        ) as error:  # re-raised on the main thread after the frame loop
            transcription_error = error

    transcription_thread: threading.Thread | None = None
    if probe.has_audio and plan.use_transcript and not brief.get("skipTranscription"):
        transcription_thread = threading.Thread(target=_run_transcription, daemon=True)
        transcription_thread.start()

    smooth.phase(
        "probe", PHASES["scout"][0], "Reading video signals", PHASES["scout"][1], 25
    )
    scout_signals, scout_observations, visual_samples = _scout_video(
        path, probe, operators, plan, smooth
    )
    if transcription_thread is not None:
        while transcription_thread.is_alive():
            with transcription_units_lock:
                completed = transcription_units["completed"]
                total = transcription_units["total"]
            smooth.step(
                "transcribe",
                completed,
                total,
                f"Reading timestamped speech ({completed}/{total} audio chunks)",
                PHASES["transcribe"],
                unit="audio chunks",
            )
            transcription_thread.join(timeout=1)
        with transcription_units_lock:
            completed = transcription_units["completed"]
            total = transcription_units["total"]
        smooth.step(
            "transcribe",
            completed,
            total,
            f"Timestamped speech ready ({completed}/{total} audio chunks)",
            PHASES["transcribe"],
            unit="audio chunks",
        )
    # Transcription is one evidence source, not a single point of failure for
    # a video index. Preserve the diagnostic and continue with visual evidence.
    if detected_language:
        # Downstream visual notes and the final synthesis can now use the
        # language actually heard in the source instead of guessing from its
        # title. Keep the configured language too for audit/debugging.
        brief = {**brief, "detectedLanguage": detected_language}
    signals = {
        **scout_signals,
        "transcript": _planner_transcript_signal(transcript),
        **(
            {
                "transcriptionError": f"{type(transcription_error).__name__}: {transcription_error}"[
                    :300
                ]
            }
            if transcription_error
            else {}
        ),
    }
    smooth.phase(
        "probe",
        PHASES["replan"][0],
        "Refining the extraction plan from source evidence",
        PHASES["replan"][1],
        20,
    )
    if not interactive:
        plan = planner.plan(
            brief=brief,
            duration_secs=probe.duration_seconds,
            width=probe.width,
            height=probe.height,
            fps=probe.fps,
            has_audio=probe.has_audio,
            signals=signals,
            previous=plan,
            visual_samples=visual_samples,
        )
    # Explicit host overrides remain authoritative even when a model suggests
    # an unavailable or intentionally disabled service.
    if brief.get("skipTranscription") and not transcript:
        plan = replace(plan, use_transcript=False)
    plan = _apply_video_embedding_policy(plan, brief)
    if skip_heavy_operators:
        plan = replace(plan, use_ocr=False, use_object_detection=False)
    vision_key = os.getenv("LARKUP_VIDEO_VISION_API_KEY") or os.getenv(
        "AI_GATEWAY_API_KEY"
    )
    if not semantic_vision_enabled or not vision_key:
        plan = replace(plan, use_semantic_vision=False)
    elif brief.get("requireSemanticVision"):
        plan = replace(plan, use_semantic_vision=True)
    plan = replace(
        plan,
        estimated_seconds=estimate_plan_runtime(plan, probe.duration_seconds),
    )
    smooth.configure_eta(plan.estimated_seconds)

    def with_eta(message: str) -> str:
        if " left" in message:
            return message
        remaining = max(
            0, round(plan.estimated_seconds - (time.monotonic() - pipeline_started))
        )
        eta = (
            f"~{max(1, round(remaining / 60))} min left"
            if remaining >= 60
            else f"~{remaining} sec left"
        )
        return f"{message} · {eta}"

    def progress(stage: str, percent: float, message: str) -> None:
        smooth.milestone(stage, percent, with_eta(message))

    smooth.milestone("probe", PHASES["replan"][1], with_eta("Agent plan ready"))

    # Cloud indexing can skip local OCR/detection while retaining semantic
    # source reading. The planner may also disable semantic calls for a truly
    # audio-only goal, avoiding empty or unnecessary model requests.
    semantic_vision = SemanticVisionService(
        semantic_vision_enabled and plan.use_semantic_vision,
        False,
    )
    motion_sampler = MotionSampler()
    scene_detector = SceneDetector(
        max_clip_secs=plan.clip_window_secs,
        detect_scene_cuts=plan.use_scene_cuts,
    )
    smooth.phase(
        "decode",
        PHASES["segment"][0],
        with_eta("Planning content-aware video segments"),
        PHASES["segment"][1],
        30,
    )

    observations: list[dict[str, Any]] = list(scout_observations)
    label_counts: Counter[str] = Counter()
    text_occurrences: defaultdict[str, list[int]] = defaultdict(list)
    text_confidence_totals: Counter[str] = Counter()
    for observation in scout_observations:
        for line in observation.get("ocr") or []:
            text = str(line.get("text") or "").strip()
            confidence = float(line.get("confidence") or 0)
            if len(text) >= 2 and confidence >= 0.5:
                text_occurrences[text].append(int(observation["timeMs"]))
                text_confidence_totals[text] += confidence
    tracker = AnonymousTracker()
    clip_plan = scene_detector.plan_clips(
        path,
        important_ranges or [(0.0, probe.duration_seconds)],
        [(item.start_secs, item.end_secs) for item in plan.priority_ranges],
    )
    plan = replace(
        plan,
        estimated_seconds=estimate_plan_runtime(
            plan,
            probe.duration_seconds,
            actual_clip_count=len(clip_plan),
        ),
    )
    smooth.configure_eta(plan.estimated_seconds)
    clip_starts_ms = [round(clip.start_secs * 1_000) for clip in clip_plan]
    clip_frames: dict[str, list[tuple[int, np.ndarray]]] = {
        clip.clip_id: [] for clip in clip_plan
    }
    clip_frame_scores: dict[str, list[float]] = {clip.clip_id: [] for clip in clip_plan}
    clip_previous_gray: dict[str, np.ndarray] = {}
    # The mode and bounded question decide the remote-frame budget. Motion
    # retention below then makes that budget content-aware without assuming a
    # genre from user-supplied descriptive metadata.
    frames_per_clip = semantic_frame_budget(brief, plan.frames_per_clip)
    analyzed_frames = len(scout_signals.get("frames") or [])
    source_frames = max(1, round(probe.duration_seconds * probe.fps))
    decoded_frames = analyzed_frames
    frames_start, frames_end = PHASES["frames"]
    smooth.phase(
        "detect", frames_start, with_eta("Reading video frames"), frames_end, 30
    )
    for time_ms, frame, sample_index, sample_total in _iter_frames(
        path, probe, brief, plan
    ):
        analyzed_frames += 1
        decoded_frames += 1
        smooth.step(
            "detect",
            sample_index,
            sample_total,
            with_eta(f"Reading video frames ({sample_index:,}/{sample_total:,})"),
            (frames_start, frames_end),
            unit="frames",
        )
        detections = operators.detect(frame) if plan.use_object_detection else []
        tracker.update(detections, time_ms)
        ocr_lines = operators.read_text(frame) if plan.use_ocr else []
        if plan.use_semantic_vision and clip_starts_ms:
            clip_index = min(
                max(bisect.bisect_right(clip_starts_ms, time_ms) - 1, 0),
                len(clip_plan) - 1,
            )
            clip_id = clip_plan[clip_index].clip_id
            clip_previous_gray[clip_id] = _retain_clip_frame(
                motion_sampler,
                clip_frames[clip_id],
                clip_frame_scores[clip_id],
                time_ms,
                frame,
                frames_per_clip,
                clip_previous_gray.get(clip_id),
            )
        for detection in detections:
            label_counts[detection["label"]] += 1
        for line in ocr_lines:
            text = str(line.get("text") or "").strip()
            confidence = float(line.get("confidence") or 0)
            if len(text) >= 2 and confidence >= 0.5:
                text_occurrences[text].append(time_ms)
                text_confidence_totals[text] += confidence
        if detections or ocr_lines:
            observations.append(
                {"timeMs": time_ms, "objects": detections, "ocr": ocr_lines}
            )

    clips_for_description = {
        clip.clip_id: (
            round(clip.start_secs * 1_000),
            round(clip.end_secs * 1_000),
            clip_frames[clip.clip_id],
        )
        for clip in clip_plan
    }
    selected_clip_ids = set(clips_for_description)
    if not brief.get("continuousSequence") and plan.use_semantic_vision:
        selected_clip_ids = set(
            _select_semantic_clip_ids(
                clip_plan,
                clip_frame_scores,
                observations,
                transcript,
                plan.priority_ranges,
                plan.mode,
                probe.duration_seconds,
            )
        )
        clips_for_description = {
            clip_id: value
            for clip_id, value in clips_for_description.items()
            if clip_id in selected_clip_ids
        }
    if brief.get("continuousSequence") and clip_plan:
        sequence_frame_budget = semantic_frame_budget(brief, frames_per_clip)
        chronology_frames = _evenly_spaced_frames(
            [frame for clip in clip_plan for frame in clip_frames[clip.clip_id]],
            sequence_frame_budget,
        )
        if chronology_frames:
            # The caller asked for this range to be read as one continuous
            # sequence rather than as independent clips. Split clips would let
            # the reader interpret each fragment on its own, losing the
            # before/after relationship the caller needs, and would spend
            # several provider requests on the same short span.
            clips_for_description = {
                "clip_continuous_sequence": (
                    (
                        round(min(start for start, _ in important_ranges) * 1_000)
                        if important_ranges
                        else chronology_frames[0][0]
                    ),
                    (
                        round(max(end for _, end in important_ranges) * 1_000)
                        if important_ranges
                        else chronology_frames[-1][0]
                    ),
                    chronology_frames,
                )
            }
    # Both branches use the already-selected frames and make independent
    # remote calls. Start them together for offline indexing; a live bounded
    # inspection explicitly skips embeddings because it cannot use vectors
    # before returning its answer evidence.
    caption_total = (
        sum(1 for _, _, frames in clips_for_description.values() if frames)
        if plan.use_semantic_vision
        else 0
    )
    embedding_clip_plan = [
        clip for clip in clip_plan if clip.clip_id in selected_clip_ids
    ]
    embedding_total = len(embedding_clip_plan) if plan.use_video_embeddings else 0
    remote_total = max(1, caption_total + embedding_total)
    remote_progress = {"captions": 0, "embeddings": 0}
    remote_progress_lock = threading.Lock()
    remote_budget_seconds = max(
        15.0,
        plan.estimated_seconds - (time.monotonic() - pipeline_started),
    )

    describe_start, describe_end = PHASES["describe"]
    describe_started = time.monotonic()

    def report_remote_progress(kind: str, completed: int, total: int) -> None:
        if total <= 0:
            return
        with remote_progress_lock:
            remote_progress[kind] = min(total, completed)
            completed_work = remote_progress["captions"] + remote_progress["embeddings"]
            elapsed = time.monotonic() - describe_started
            # Once a clip or two has landed, their real pace is a better
            # forecast for the rest than any up-front estimate.
            remaining_seconds = (
                round(elapsed * (remote_total - completed_work) / completed_work)
                if completed_work > 0
                else round(remote_budget_seconds)
            )
            eta = (
                f"~{max(1, round(remaining_seconds / 60))} min left"
                if remaining_seconds >= 60
                else f"~{remaining_seconds} sec left"
            )
            smooth.step(
                "synthesize",
                completed_work,
                remote_total,
                "Watching video segments "
                f"({remote_progress['captions']}/{caption_total} described · "
                f"{remote_progress['embeddings']}/{embedding_total} indexed) · {eta}",
                (describe_start, describe_end),
                span_seconds=max(15.0, elapsed / max(1, completed_work)),
                estimated_remaining_seconds=remaining_seconds + 30,
                unit="clips",
            )

    # This phase makes the remote calls, so it usually dominates the wall
    # clock and owns the widest slice of the bar. Each finished clip is a real
    # milestone; between them the drift keeps the bar alive without ever
    # running past what the next clip would be worth.
    smooth.step(
        "synthesize",
        0,
        remote_total,
        f"Watching video segments (0/{caption_total} described)",
        (describe_start, describe_end),
        span_seconds=remote_budget_seconds / max(1, remote_total),
        estimated_remaining_seconds=remote_budget_seconds + 30,
        unit="clips",
    )
    vision_brief = {
        **brief,
        "indexingMode": plan.mode,
        "agentExtractionFocus": plan.extraction_focus,
    }
    with ThreadPoolExecutor(max_workers=2) as pool:
        semantic_future = pool.submit(
            semantic_vision.describe_clips,
            clips_for_description,
            vision_brief,
            transcript or list(brief.get("transcriptContext") or []),
            lambda completed, total: report_remote_progress(
                "captions", completed, total
            ),
            observations,
        )
        embedding_future = (
            None
            if not plan.use_video_embeddings
            else pool.submit(
                _compute_video_embeddings,
                embedding_clip_plan,
                clip_frames,
                lambda *_progress: None,
                lambda completed, total: report_remote_progress(
                    "embeddings", completed, total
                ),
            )
        )
        semantic_observations = semantic_future.result()
        if embedding_future is None:
            video_embeddings = []
            video_embedding_diagnostics = {
                "attempted": False,
                "provider": os.getenv("LARKUP_VIDEO_EMBEDDING_PROVIDER", "disabled"),
                "error": None,
                "skipped": (
                    "interactive-inspection"
                    if brief.get("skipVideoEmbeddings")
                    else "provider-disabled"
                ),
            }
        else:
            video_embeddings, video_embedding_diagnostics = embedding_future.result()
    _require_semantic_coverage(
        expected=caption_total if plan.use_semantic_vision else 0,
        actual=len(semantic_observations),
        provider_error=semantic_vision.last_error,
    )
    semantic_evidence = _link_chronological_notes(
        [
            {
                "startMs": observation.start_ms,
                "endMs": observation.end_ms,
                "text": observation.text,
                "confidence": observation.confidence,
            }
            for observation in semantic_observations
        ]
    )
    recurring_overlay_text = _recurring_overlay_text(
        text_occurrences, text_confidence_totals
    )
    smooth.phase(
        "synthesize",
        PHASES["synthesize"][0],
        "Putting the timeline together",
        PHASES["synthesize"][1],
        30,
        estimated_remaining_seconds=30,
    )
    if interactive:
        knowledge_summary = {
            "overview": "Bounded interactive inspection completed from timestamped visual observations.",
            "participants": [],
            "stateHistory": [],
            "keyEvents": [],
            "narrative": [],
            "context": [],
            "sourceItems": [],
            "uncertainties": [],
        }
    else:
        knowledge_summary = planner.synthesize_knowledge(
            brief=brief,
            duration_secs=probe.duration_seconds,
            plan=plan,
            semantic_observations=semantic_evidence,
            transcript=transcript,
            overlay_text=recurring_overlay_text,
        )
        smooth.phase(
            "synthesize",
            PHASES["synthesize"][0],
            "Cataloging questions and written items",
            PHASES["synthesize"][1],
            12,
            estimated_remaining_seconds=12,
        )
        knowledge_summary["sourceItems"] = planner.extract_source_inventory(
            duration_secs=probe.duration_seconds,
            transcript=transcript,
            semantic_observations=semantic_evidence,
            overlay_text=recurring_overlay_text,
        )
    elapsed_seconds = round(time.monotonic() - pipeline_started, 3)
    result = {
        "schemaVersion": 1,
        "durationMs": round((source_duration_secs or probe.duration_seconds) * 1_000),
        "video": {
            "width": probe.width,
            "height": probe.height,
            "fps": round(probe.fps, 3),
        },
        "brief": brief,
        "transcript": transcript,
        "detectedLanguage": detected_language,
        "visualObservations": observations,
        "tracks": [
            track
            for track in tracker.summaries()
            if int(track.get("observations") or 0) >= 2
        ],
        "recurringOverlayText": recurring_overlay_text,
        # Gateway batches complete out of order. Persisting arrival order
        # makes chronological retrieval and timeline answers unnecessarily
        # brittle even though every observation already has precise bounds.
        "semanticObservations": semantic_evidence,
        "semanticDiagnostics": {
            "attempted": bool(plan.use_semantic_vision and any(clip_frames.values())),
            "error": semantic_vision.last_error,
        },
        "agentPlan": plan.to_dict(),
        "agentDiagnostics": planner.diagnostics().to_dict(),
        "knowledgeSummary": knowledge_summary,
        "processingDiagnostics": {
            "estimatedTotalSeconds": plan.estimated_seconds,
            "elapsedSeconds": elapsed_seconds,
            "estimateErrorSeconds": round(elapsed_seconds - plan.estimated_seconds, 3),
        },
        "transcriptionDiagnostics": {
            "requested": plan.use_transcript,
            **transcription.last_diagnostics,
            "error": (
                f"{type(transcription_error).__name__}: {transcription_error}"[:500]
                if transcription_error
                else None
            ),
        },
        "videoEmbeddings": video_embeddings,
        "videoEmbeddingDiagnostics": video_embedding_diagnostics,
        "entities": [
            {"name": label, "kind": "object", "mentions": count}
            for label, count in label_counts.most_common()
        ]
        + [
            {
                "name": text,
                "kind": "visible-text",
                "mentions": len(times),
                "timestampsMs": times,
                "confidence": round(
                    text_confidence_totals[text] / max(1, len(times)), 4
                ),
            }
            for text, times in sorted(
                text_occurrences.items(), key=lambda item: -len(item[1])
            )
            if len(times) >= 2
            or text_confidence_totals[text] / max(1, len(times)) >= 0.9
        ][:200],
        "coverage": {
            "requested": plan.mode,
            "sourceFrames": source_frames,
            "decodedFrames": decoded_frames,
            "analyzedFrames": analyzed_frames,
            "heavyOperatorsDisabled": skip_heavy_operators,
            "priorityRanges": [
                {
                    "startSecs": item.start_secs,
                    "endSecs": item.end_secs,
                    "reason": item.reason,
                }
                for item in plan.priority_ranges
            ],
            "semanticClips": len(clip_plan),
        },
        "answeringGuide": {
            "goal": brief.get("goal"),
            "importantEntities": brief.get("knownEntities", []),
            "questionsToPrepareFor": brief.get("expectedQuestions", []),
            "extractionFocus": plan.extraction_focus,
            "instruction": "Answer using timestamped evidence first; use general knowledge only when clearly labeled as an inference.",
        },
    }
    if timestamp_offset_secs:
        rebase_result_timestamps(result, timestamp_offset_secs)
    inspected_ranges = normalized_important_ranges(brief, probe.duration_seconds)
    processed_seconds = (
        sum(end - start for start, end in inspected_ranges)
        if inspected_ranges
        else probe.duration_seconds
    )
    return result, processed_seconds / 60
