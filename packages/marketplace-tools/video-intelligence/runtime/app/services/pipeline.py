"""Orchestrates one video-indexing job: probe -> transcribe -> decode/detect/OCR
-> per-clip semantic captioning -> optional video embeddings -> the evidence
bundle returned to the caller. Everything else in this package (transcription,
vision, embedding, scene, motion) is a service this file calls in sequence;
this is the one place that ties them together.
"""

from __future__ import annotations

import bisect
from concurrent.futures import ThreadPoolExecutor
import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, TypeVar

import cv2
import numpy as np

from app.utils.timing import normalized_important_ranges, rebase_result_timestamps, visual_sampling_interval
from app.services.embedding import VideoClipInput, get_video_embedding_provider
from app.services.motion import MotionSampler
from app.services.scene import ClipBounds, SceneDetector, semantic_clip_window_secs
from app.services.transcription import TranscriptionService
from app.services.vision import SemanticVisionService

ProgressCallback = Callable[[str, int, str], None]

COCO_LABELS = (
    "person bicycle car motorcycle airplane bus train truck boat traffic-light fire-hydrant "
    "stop-sign parking-meter bench bird cat dog horse sheep cow elephant bear zebra giraffe "
    "backpack umbrella handbag tie suitcase frisbee skis snowboard sports-ball kite baseball-bat "
    "baseball-glove skateboard surfboard tennis-racket bottle wine-glass cup fork knife spoon bowl "
    "banana apple sandwich orange broccoli carrot hot-dog pizza donut cake chair couch potted-plant "
    "bed dining-table toilet tv laptop mouse remote keyboard cell-phone microwave oven toaster sink "
    "refrigerator book clock vase scissors teddy-bear hair-drier toothbrush"
).split()
SCORE_PATTERN = re.compile(r"(?<!\d)(\d{1,2})\s*[-:]\s*(\d{1,2})(?!\d)")


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
    raw = _run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)])
    data = json.loads(raw)
    video = next(
        (stream for stream in data.get("streams", []) if stream.get("codec_type") == "video"), None
    )
    if video is None:
        raise ValueError("the uploaded file does not contain a video stream")
    duration = float(video.get("duration") or data.get("format", {}).get("duration") or 0)
    rate = str(video.get("avg_frame_rate") or "0/1").split("/")
    fps = float(rate[0]) / max(float(rate[1]), 1) if len(rate) == 2 else 0
    return Probe(
        duration_seconds=max(duration, 0.001),
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        fps=max(fps, 0.001),
        has_audio=any(stream.get("codec_type") == "audio" for stream in data.get("streams", [])),
    )


def _probe_video_with_av(path: Path) -> Probe:
    import av

    with av.open(str(path)) as container:
        video = next((stream for stream in container.streams if stream.type == "video"), None)
        if video is None:
            raise ValueError("the uploaded file does not contain a video stream")
        stream_duration = (
            float(video.duration * video.time_base)
            if video.duration is not None and video.time_base is not None
            else 0
        )
        container_duration = (
            float(container.duration / av.time_base) if container.duration is not None else 0
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
                    raise FileNotFoundError(f"missing object detector: {model}")
                import onnxruntime as ort

                self._detector = ort.InferenceSession(
                    str(model), providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
                )
            session = self._detector
        return _detect_yolox(session, frame)


def _resolve_device(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import onnxruntime as ort

        return "cuda" if "CUDAExecutionProvider" in ort.get_available_providers() else "cpu"
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
            box = np.asarray(boxes[index]).reshape(-1, 2) if index < len(boxes) else np.zeros((0, 2))
            lines.append(
                {
                    "text": clean,
                    "confidence": round(float(scores[index]) if index < len(scores) else 0, 4),
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


def _detect_yolox(session: Any, frame: np.ndarray, confidence: float = 0.3) -> list[dict[str, Any]]:
    input_size = 640
    height, width = frame.shape[:2]
    ratio = min(input_size / height, input_size / width)
    resized = cv2.resize(frame, (round(width * ratio), round(height * ratio)))
    padded = np.full((input_size, input_size, 3), 114, dtype=np.uint8)
    padded[: resized.shape[0], : resized.shape[1]] = resized
    tensor = padded.transpose(2, 0, 1).astype(np.float32)[None, ...]
    output = np.asarray(session.run(None, {session.get_inputs()[0].name: tensor})[0]).squeeze(0)

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
    xywh = np.column_stack(
        (boxes[:, 0] - boxes[:, 2] / 2, boxes[:, 1] - boxes[:, 3] / 2, boxes[:, 2], boxes[:, 3])
    ) / ratio
    indices = cv2.dnn.NMSBoxes(xywh.tolist(), scores.tolist(), confidence, 0.45)
    detections: list[dict[str, Any]] = []
    for index in np.asarray(indices).reshape(-1):
        x, y, w, h = xywh[index]
        class_id = int(class_ids[index])
        detections.append(
            {
                "label": COCO_LABELS[class_id] if class_id < len(COCO_LABELS) else str(class_id),
                "classId": class_id,
                "confidence": round(float(scores[index]), 4),
                "box": [round(float(x), 1), round(float(y), 1), round(float(x + w), 1), round(float(y + h), 1)],
            }
        )
    return detections


def _score_candidates(ocr_lines: list[dict[str, Any]], time_ms: int) -> list[dict[str, Any]]:
    """OCR-backed score readings; callers must still treat them as evidence to verify."""
    candidates: list[dict[str, Any]] = []
    for line in ocr_lines:
        for match in SCORE_PATTERN.finditer(str(line.get("text") or "")):
            candidates.append(
                {
                    "timeMs": time_ms,
                    "score": f"{match.group(1)}-{match.group(2)}",
                    "confidence": round(float(line.get("confidence") or 0), 4),
                }
            )
    return candidates


def _iter_frames(
    path: Path, probe: Probe, brief: dict[str, Any], progress: ProgressCallback
) -> Iterator[tuple[int, np.ndarray, int, int]]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError("OpenCV could not decode the uploaded video")
    full = brief["indexingMode"] == "full-coverage"
    interval_frames = (
        1
        if full
        else max(1, round(probe.fps * visual_sampling_interval(brief["indexingMode"], probe.duration_seconds)))
    )
    total_frames = max(1, int(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
    important_ranges = normalized_important_ranges(brief, probe.duration_seconds)
    ranges = important_ranges or [(0.0, probe.duration_seconds)]
    requested_frames = max(1, sum(max(0, round((end - start) * probe.fps)) for start, end in ranges))
    processed_frames = 0
    try:
        for start_secs, end_secs in ranges:
            capture.set(cv2.CAP_PROP_POS_MSEC, start_secs * 1_000)
            range_frame = 0
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                timestamp_secs = float(capture.get(cv2.CAP_PROP_POS_MSEC)) / 1_000
                if timestamp_secs > end_secs + (1 / max(probe.fps, 1)):
                    break
                if range_frame % interval_frames == 0:
                    frame_index = max(0, round(timestamp_secs * probe.fps))
                    yield round(timestamp_secs * 1_000), frame, frame_index, total_frames
                range_frame += 1
                processed_frames += 1
                if processed_frames % max(round(probe.fps * 15), 1) == 0:
                    percent = 42 + round(min(processed_frames / requested_frames, 1) * 13)
                    progress(
                        "decode",
                        percent,
                        f"Decoded {min(processed_frames, requested_frames):,}/{requested_frames:,} requested frames",
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
            track_id, overlap = max(candidates, key=lambda item: item[1], default=(0, 0.0))
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
                "confidence": round(track["confidenceTotal"] / max(track["observations"], 1), 4),
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


_T = TypeVar("_T")


def _run_with_progress(
    call: Callable[[], _T],
    progress: ProgressCallback,
    stage: str,
    start_percent: int,
    message: str,
    ceiling_percent: int = 99,
    ramp_seconds: float = 45.0,
    slow_after_seconds: float = 8.0,
    slow_message: str | None = None,
) -> _T:
    """Runs a slow blocking call on a worker thread while nudging `progress`
    forward on a decaying curve, so a stage doesn't look stalled for however
    long that call takes (e.g. an external embedding worker that's still
    starting up). Real completion always wins: this only ever reports an
    estimate below `ceiling_percent` while `call` is still running.

    A warm call to a well-provisioned worker normally finishes in well under
    `slow_after_seconds`; a run that's still going past it is very likely a
    cold-starting worker rather than ordinary latency, so `slow_message`
    (when given) swaps in a longer-wait-appropriate message instead of
    silently repeating `message`, without ever naming "cold start" to the
    end user.
    """
    outcome: list[_T] = []
    failure: list[BaseException] = []

    def _target() -> None:
        try:
            outcome.append(call())
        except BaseException as error:  # re-raised on the caller's thread below
            failure.append(error)

    thread = threading.Thread(target=_target, daemon=True)
    started = time.monotonic()
    thread.start()
    while thread.is_alive():
        elapsed = time.monotonic() - started
        fraction = 1 - math.exp(-elapsed / (ramp_seconds / 3))
        percent = min(ceiling_percent, start_percent + round(fraction * (ceiling_percent - start_percent)))
        current_message = slow_message if (slow_message and elapsed >= slow_after_seconds) else message
        progress(stage, percent, current_message)
        thread.join(timeout=1.0)
    if failure:
        raise failure[0]
    return outcome[0]


def _compute_video_embeddings(
    clip_plan: list[ClipBounds],
    clip_frames: dict[str, list[tuple[int, np.ndarray]]],
    progress: ProgressCallback,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Runs the configured video-embedding provider over the same per-clip frame
    buckets semantic vision already collected, so there is no extra decode
    pass. Disabled by default; a provider failure degrades to
    caption/OCR/transcript-only retrieval rather than failing the job.
    """
    provider_name = os.getenv("LARKUP_VIDEO_EMBEDDING_PROVIDER", "disabled")
    diagnostics: dict[str, Any] = {"attempted": False, "provider": provider_name, "error": None}
    if provider_name == "disabled" or not any(clip_frames.values()):
        return [], diagnostics
    diagnostics["attempted"] = True
    try:
        provider = get_video_embedding_provider(provider_name)
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
        embeddings = _run_with_progress(
            lambda: provider.embed_clips(clip_inputs),
            progress,
            "synthesize",
            88,
            "Generating clip embeddings",
            slow_message="Preparing the visual search model for this video — this can take a little longer the first time",
        )
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
        diagnostics["error"] = f"{type(error).__name__}: {error}"[:500]
        return [], diagnostics


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
    progress("probe", 3, "Reading video metadata")
    probe = probe_video(path)
    important_ranges = normalized_important_ranges(brief, probe.duration_seconds)
    skip_heavy_operators = disable_heavy_operators or bool(brief.get("skipHeavyOperators"))
    operators = VisualOperators(model_dir, device, skip_heavy_operators)
    transcription = TranscriptionService(operators.device)
    semantic_vision = SemanticVisionService(semantic_vision_enabled, disable_heavy_operators)
    motion_sampler = MotionSampler()
    # Fast chat turns retain the same spread of sampled frames but group them
    # into fewer semantic requests. Dense deep verification keeps short clips
    # for timestamp precision.
    scene_detector = SceneDetector(
        max_clip_secs=semantic_clip_window_secs(brief["indexingMode"]),
        # Live question answering has already narrowed the source to a
        # relevant range. Avoid turning harmless camera cuts into a fan-out
        # of vision-gateway requests; overlapping fixed windows retain full
        # temporal coverage while the independent batches run in parallel.
        detect_scene_cuts=not bool(brief.get("skipVideoEmbeddings")),
    )

    transcript: list[dict[str, Any]] = []
    detected_language: str | None = None
    if probe.has_audio and not brief.get("skipTranscription"):
        progress("transcribe", 8, "Transcribing speech with word timestamps")
        transcript, detected_language = transcription.transcribe(
            path,
            None if brief.get("language") == "auto" else brief.get("language"),
            transcription_hints(brief),
        )
        if important_ranges:
            transcript = [
                segment
                for segment in transcript
                if segment["endMs"] / 1_000 >= important_ranges[0][0]
                and segment["startMs"] / 1_000 <= important_ranges[-1][1]
            ]
    elif probe.has_audio:
        progress("transcribe", 8, "Using the selected external transcription provider")
    progress("decode", 42, "Selecting visual evidence")

    observations: list[dict[str, Any]] = []
    label_counts: Counter[str] = Counter()
    text_occurrences: defaultdict[str, list[int]] = defaultdict(list)
    scoreboard_states: list[dict[str, Any]] = []
    previous_score: str | None = None
    tracker = AnonymousTracker()
    clip_plan = scene_detector.plan_clips(path, important_ranges or [(0.0, probe.duration_seconds)])
    clip_starts_ms = [round(clip.start_secs * 1_000) for clip in clip_plan]
    clip_frames: dict[str, list[tuple[int, np.ndarray]]] = {clip.clip_id: [] for clip in clip_plan}
    clip_frame_scores: dict[str, list[float]] = {clip.clip_id: [] for clip in clip_plan}
    clip_previous_gray: dict[str, np.ndarray] = {}
    # Dense, motion-heavy content needs more frames per clip to catch a
    # reveal/outcome; static content types stay cheap. This scales with the
    # already-decoded stream (no extra decode cost), not a separate pass.
    dense_content = brief.get("contentType") in {"sports", "surveillance"}
    # The live semantic path deliberately skips the slower local OCR/object
    # operators. Spend that saved budget on denser visual coverage instead:
    # a brief scorecard, reveal, or clothing/detail change can occupy only a
    # couple of seconds inside an otherwise static scene.
    frames_per_clip = 8 if dense_content or bool(brief.get("skipHeavyOperators")) else 4
    analyzed_frames = 0
    decoded_frames = max(1, round(probe.duration_seconds * probe.fps))
    last_reported_percent = -1
    for time_ms, frame, frame_index, total_frames in _iter_frames(path, probe, brief, progress):
        analyzed_frames += 1
        decoded_frames = total_frames
        report_percent = 56 + round(frame_index / max(total_frames, 1) * 34)
        if report_percent != last_reported_percent:
            progress("detect", report_percent, f"Analyzing frame {frame_index + 1:,}/{total_frames:,}")
            last_reported_percent = report_percent
        detections = operators.detect(frame)
        tracker.update(detections, time_ms)
        ocr_lines = operators.read_text(frame)
        if semantic_vision_enabled and clip_starts_ms:
            clip_index = min(max(bisect.bisect_right(clip_starts_ms, time_ms) - 1, 0), len(clip_plan) - 1)
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
            text_occurrences[line["text"]].append(time_ms)
        if brief.get("contentType") == "sports":
            for candidate in _score_candidates(ocr_lines, time_ms):
                if candidate["score"] != previous_score:
                    scoreboard_states.append(candidate)
                    previous_score = candidate["score"]
        if detections or ocr_lines or brief["indexingMode"] == "full-coverage":
            observations.append({"timeMs": time_ms, "objects": detections, "ocr": ocr_lines})

    progress("synthesize", 88, "Interpreting clips through the vision gateway")
    clips_for_description = {
        clip.clip_id: (round(clip.start_secs * 1_000), round(clip.end_secs * 1_000), clip_frames[clip.clip_id])
        for clip in clip_plan
    }
    # Both branches use the already-selected frames and make independent
    # remote calls. Start them together for offline indexing; a live bounded
    # inspection explicitly skips embeddings because it cannot use vectors
    # before returning its answer evidence.
    with ThreadPoolExecutor(max_workers=2) as pool:
        semantic_future = pool.submit(
            semantic_vision.describe_clips,
            clips_for_description,
            brief,
            transcript or list(brief.get("transcriptContext") or []),
        )
        embedding_future = (
            None
            if brief.get("skipVideoEmbeddings")
            else pool.submit(_compute_video_embeddings, clip_plan, clip_frames, progress)
        )
        semantic_observations = semantic_future.result()
        if embedding_future is None:
            video_embeddings = []
            video_embedding_diagnostics = {
                "attempted": False,
                "provider": os.getenv("LARKUP_VIDEO_EMBEDDING_PROVIDER", "disabled"),
                "error": None,
                "skipped": "interactive-inspection",
            }
        else:
            video_embeddings, video_embedding_diagnostics = embedding_future.result()
    result = {
        "schemaVersion": 1,
        "durationMs": round((source_duration_secs or probe.duration_seconds) * 1_000),
        "video": {"width": probe.width, "height": probe.height, "fps": round(probe.fps, 3)},
        "brief": brief,
        "transcript": transcript,
        "detectedLanguage": detected_language,
        "visualObservations": observations,
        "tracks": tracker.summaries(),
        "scoreboardStates": scoreboard_states,
        "semanticObservations": [
            {
                "startMs": observation.start_ms,
                "endMs": observation.end_ms,
                "text": observation.text,
                "confidence": observation.confidence,
            }
            for observation in semantic_observations
        ],
        "semanticDiagnostics": {
            "attempted": bool(semantic_vision_enabled and any(clip_frames.values())),
            "error": semantic_vision.last_error,
        },
        "videoEmbeddings": video_embeddings,
        "videoEmbeddingDiagnostics": video_embedding_diagnostics,
        "entities": [{"name": label, "kind": "object", "mentions": count} for label, count in label_counts.most_common()]
        + [
            {"name": text, "kind": "visible-text", "mentions": len(times), "timestampsMs": times}
            for text, times in sorted(text_occurrences.items(), key=lambda item: -len(item[1]))
        ],
        "coverage": {
            "requested": brief["indexingMode"],
            "decodedFrames": decoded_frames,
            "analyzedFrames": analyzed_frames,
            "heavyOperatorsDisabled": skip_heavy_operators,
        },
        "answeringGuide": {
            "goal": brief.get("goal"),
            "importantEntities": brief.get("knownEntities", []),
            "questionsToPrepareFor": brief.get("expectedQuestions", []),
            "instruction": "Answer using timestamped evidence first; use general knowledge only when clearly labeled as an inference.",
        },
    }
    if timestamp_offset_secs:
        rebase_result_timestamps(result, timestamp_offset_secs)
    inspected_ranges = normalized_important_ranges(brief, probe.duration_seconds)
    processed_seconds = (
        sum(end - start for start, end in inspected_ranges) if inspected_ranges else probe.duration_seconds
    )
    return result, processed_seconds / 60
