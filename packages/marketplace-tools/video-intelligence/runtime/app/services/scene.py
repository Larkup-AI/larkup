from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ClipBounds:
    clip_id: str
    start_secs: float
    end_secs: float


class SceneDetector:
    """Hybrid scene-cut + fixed-window clip planner covering every requested range.

    Scene cuts alone leave a long static shot (a talking-head take, a static
    scoreboard) as one giant clip, averaging out any action inside it.
    Uniform fixed windows alone ignore real scene boundaries. This takes
    scene cuts where PySceneDetect finds them, then forces a split (with a
    short overlap, so a boundary event is never cut in half) on anything
    longer than `max_clip_secs`. Every second of every requested range ends
    up in exactly one clip, aside from the deliberate overlap seams.
    """

    def __init__(
        self,
        *,
        max_clip_secs: float = 8.0,
        overlap_secs: float = 1.0,
        min_clip_secs: float = 2.0,
        detect_scene_cuts: bool = True,
    ) -> None:
        self.max_clip_secs = max_clip_secs
        self.overlap_secs = overlap_secs
        self.min_clip_secs = min_clip_secs
        self.detect_scene_cuts = detect_scene_cuts

    def plan_clips(self, path: Path, ranges: list[tuple[float, float]]) -> list[ClipBounds]:
        # A bounded live investigation already has a question-selected range.
        # Fixed overlapping windows keep its request count and latency stable;
        # scene cuts are still valuable for unconstrained offline indexing.
        cut_points = self._scene_cut_points(path) if self.detect_scene_cuts else []
        raw: list[ClipBounds] = []
        for range_start, range_end in ranges:
            if range_end <= range_start:
                continue
            boundaries = sorted(
                {range_start, range_end} | {cut for cut in cut_points if range_start < cut < range_end}
            )
            for start, end in zip(boundaries, boundaries[1:]):
                raw.extend(self._split_bounded(start, end))
        merged: list[ClipBounds] = []
        for clip in raw:
            if merged and clip.end_secs - clip.start_secs < self.min_clip_secs:
                previous = merged[-1]
                merged[-1] = ClipBounds(previous.clip_id, previous.start_secs, clip.end_secs)
                continue
            merged.append(clip)
        return [
            ClipBounds(f"clip_{index:05d}", clip.start_secs, clip.end_secs)
            for index, clip in enumerate(merged)
        ]

    def _split_bounded(self, start: float, end: float) -> list[ClipBounds]:
        duration = end - start
        if duration <= self.max_clip_secs:
            return [ClipBounds("", start, end)]
        windows: list[ClipBounds] = []
        cursor = start
        while cursor < end:
            window_end = min(end, cursor + self.max_clip_secs)
            windows.append(ClipBounds("", cursor, window_end))
            if window_end >= end:
                break
            cursor = window_end - self.overlap_secs
        return windows

    def _scene_cut_points(self, path: Path) -> list[float]:
        """Best-effort scene boundaries; an empty list just means pure fixed-window clipping."""
        try:
            from scenedetect import ContentDetector, SceneManager, open_video
        except ImportError:
            return []
        try:
            video = open_video(str(path))
            manager = SceneManager()
            manager.add_detector(ContentDetector())
            # PySceneDetect auto-downscales detection frames by default, so this
            # second pass over the file stays cheap relative to the main decode.
            manager.detect_scenes(video)
            return [scene[0].get_seconds() for scene in manager.get_scene_list()[1:]]
        except Exception:
            return []


def semantic_clip_window_secs(indexing_mode: str) -> float:
    """Keep interactive visual reasoning broad without fanning out requests."""
    return {"fast": 30.0, "balanced": 15.0, "deep": 8.0, "full-coverage": 8.0}.get(
        indexing_mode, 15.0
    )
