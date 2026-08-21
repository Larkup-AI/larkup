from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

import cv2
import numpy as np


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
        (stream for stream in data.get("streams", []) if stream.get("codec_type") == "video"),
        None,
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


class Operators:
    def __init__(self, model_dir: Path, device: str, disabled: bool = False):
        self.model_dir = model_dir
        self.device = _resolve_device(device)
        self.disabled = disabled
        self._lock = threading.Lock()
        self._whisper: Any = None
        self._ocr: Any = None
        self._detector: Any = None

    def transcribe(
        self, path: Path, language_hint: str | None
    ) -> tuple[list[dict[str, Any]], str | None]:
        if self.disabled:
            return [], None
        with self._lock:
            if self._whisper is None:
                from faster_whisper import WhisperModel

                model_name = os.getenv("LARKUP_VIDEO_WHISPER_MODEL", "small")
                compute_type = "float16" if self.device == "cuda" else "int8"
                self._whisper = WhisperModel(
                    model_name, device=self.device, compute_type=compute_type
                )
            segments, info = self._whisper.transcribe(
                str(path),
                language=language_hint,
                vad_filter=True,
                word_timestamps=True,
                beam_size=5,
            )
            result = [
                {
                    "startMs": round(segment.start * 1_000),
                    "endMs": round(segment.end * 1_000),
                    "text": segment.text.strip(),
                    "words": [
                        {
                            "startMs": round((word.start or segment.start) * 1_000),
                            "endMs": round((word.end or segment.end) * 1_000),
                            "text": word.word.strip(),
                            "confidence": round(float(word.probability), 4),
                        }
                        for word in (segment.words or [])
                    ],
                }
                for segment in segments
                if segment.text.strip()
            ]
        return result, getattr(info, "language", None)

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
        (
            boxes[:, 0] - boxes[:, 2] / 2,
            boxes[:, 1] - boxes[:, 3] / 2,
            boxes[:, 2],
            boxes[:, 3],
        )
    ) / ratio
    indices = cv2.dnn.NMSBoxes(xywh.tolist(), scores.tolist(), confidence, 0.45)
    detections: list[dict[str, Any]] = []
    for index in np.asarray(indices).reshape(-1):
        x, y, w, h = xywh[index]
        class_id = int(class_ids[index])
        detections.append(
            {
                "label": COCO_LABELS[class_id]
                if class_id < len(COCO_LABELS)
                else str(class_id),
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


def _sampling_interval(mode: str) -> float:
    return {"fast": 5.0, "balanced": 2.0, "deep": 0.75}[mode]


def _iter_frames(
    path: Path,
    probe: Probe,
    brief: dict[str, Any],
    progress: ProgressCallback,
) -> Iterator[tuple[int, np.ndarray, int, int]]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError("OpenCV could not decode the uploaded video")
    full = brief["indexingMode"] == "full-coverage"
    interval_frames = (
        1
        if full
        else max(1, round(probe.fps * _sampling_interval(brief["indexingMode"])))
    )
    total_frames = max(1, int(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
    frame_index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index % interval_frames == 0:
                yield round(frame_index / probe.fps * 1_000), frame, frame_index, total_frames
            frame_index += 1
            if frame_index % max(round(probe.fps * 15), 1) == 0:
                percent = 42 + round(min(frame_index / total_frames, 1) * 13)
                progress(
                    "decode",
                    percent,
                    f"Decoded {min(frame_index, total_frames):,}/{total_frames:,} frames",
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
                "confidence": round(
                    track["confidenceTotal"] / max(track["observations"], 1), 4
                ),
            }
            for track in self.tracks.values()
        ]


def run_pipeline(
    path: Path,
    brief: dict[str, Any],
    model_dir: Path,
    device: str,
    progress: ProgressCallback,
    disable_heavy_operators: bool = False,
) -> tuple[dict[str, Any], float]:
    progress("probe", 3, "Reading video metadata")
    probe = probe_video(path)
    operators = Operators(model_dir, device, disable_heavy_operators)

    transcript: list[dict[str, Any]] = []
    detected_language: str | None = None
    if probe.has_audio:
        progress("transcribe", 8, "Transcribing speech with word timestamps")
        transcript, detected_language = operators.transcribe(
            path, None if brief.get("language") == "auto" else brief.get("language")
        )
    progress("decode", 42, "Selecting visual evidence")

    observations: list[dict[str, Any]] = []
    label_counts: Counter[str] = Counter()
    text_occurrences: defaultdict[str, list[int]] = defaultdict(list)
    tracker = AnonymousTracker()
    analyzed_frames = 0
    decoded_frames = max(1, round(probe.duration_seconds * probe.fps))
    last_reported_percent = -1
    for time_ms, frame, frame_index, total_frames in _iter_frames(path, probe, brief, progress):
        analyzed_frames += 1
        decoded_frames = total_frames
        report_percent = 56 + round(frame_index / max(total_frames, 1) * 34)
        if report_percent != last_reported_percent:
            progress(
                "detect",
                report_percent,
                f"Analyzing frame {frame_index + 1:,}/{total_frames:,}",
            )
            last_reported_percent = report_percent
        detections = operators.detect(frame)
        tracker.update(detections, time_ms)
        ocr_lines = operators.read_text(frame)
        for detection in detections:
            label_counts[detection["label"]] += 1
        for line in ocr_lines:
            text_occurrences[line["text"]].append(time_ms)
        if detections or ocr_lines or brief["indexingMode"] == "full-coverage":
            observations.append(
                {"timeMs": time_ms, "objects": detections, "ocr": ocr_lines}
            )

    progress("synthesize", 93, "Building timestamped evidence")
    result = {
        "schemaVersion": 1,
        "durationMs": round(probe.duration_seconds * 1_000),
        "video": {
            "width": probe.width,
            "height": probe.height,
            "fps": round(probe.fps, 3),
        },
        "brief": brief,
        "transcript": transcript,
        "detectedLanguage": detected_language,
        "visualObservations": observations,
        "tracks": tracker.summaries(),
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
            }
            for text, times in sorted(
                text_occurrences.items(), key=lambda item: -len(item[1])
            )
        ],
        "coverage": {
            "requested": brief["indexingMode"],
            "decodedFrames": decoded_frames,
            "analyzedFrames": analyzed_frames,
            "heavyOperatorsDisabled": disable_heavy_operators,
        },
        "answeringGuide": {
            "goal": brief.get("goal"),
            "importantEntities": brief.get("knownEntities", []),
            "questionsToPrepareFor": brief.get("expectedQuestions", []),
            "instruction": "Answer using timestamped evidence first; use general knowledge only when clearly labeled as an inference.",
        },
    }
    return result, probe.duration_seconds / 60
