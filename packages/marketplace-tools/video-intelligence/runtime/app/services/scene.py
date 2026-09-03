from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ClipBounds:
    clip_id: str
    start_secs: float
    end_secs: float


class SceneDetector:
    """Hybrid scene-cut + fixed-window clip planner covering every requested range.

    Scene cuts alone leave a long static shot (a talking-head take or a static
    dashboard) as one giant clip, averaging out any action inside it.
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

    def plan_clips(
        self,
        path: Path,
        ranges: list[tuple[float, float]],
        priority_ranges: list[tuple[float, float]] | None = None,
    ) -> list[ClipBounds]:
        # A bounded live investigation already has a question-selected range.
        # Fixed overlapping windows keep its request count and latency stable;
        # scene cuts are still valuable for unconstrained offline indexing.
        cut_points = self._scene_cut_points(path) if self.detect_scene_cuts else []
        raw: list[ClipBounds] = []
        for range_start, range_end in ranges:
            if range_end <= range_start:
                continue
            priority_boundaries = {
                point
                for priority_start, priority_end in priority_ranges or []
                for point in (priority_start, priority_end)
                if range_start < point < range_end
            }
            boundaries = sorted(
                {range_start, range_end}
                | {cut for cut in cut_points if range_start < cut < range_end}
                | priority_boundaries
            )
            for start, end in zip(boundaries, boundaries[1:]):
                prioritized = any(
                    start < priority_end and end > priority_start
                    for priority_start, priority_end in priority_ranges or []
                )
                raw.extend(
                    self._split_bounded(
                        start,
                        end,
                        max_clip_secs=(
                            max(self.min_clip_secs, self.max_clip_secs / 2)
                            if prioritized
                            else self.max_clip_secs
                        ),
                    )
                )
        target_clips = sum(
            max(1, math.ceil((end - start) / self.max_clip_secs))
            for start, end in ranges
            if end > start
        )
        while len(raw) > target_clips:
            candidates: list[tuple[float, int]] = []
            for index, (left, right) in enumerate(zip(raw, raw[1:])):
                if right.start_secs > left.end_secs + self.overlap_secs + 1e-6:
                    continue
                start, end = left.start_secs, right.end_secs
                prioritized = any(
                    start < priority_end and end > priority_start
                    for priority_start, priority_end in priority_ranges or []
                )
                allowed = (
                    max(self.min_clip_secs, self.max_clip_secs / 2)
                    if prioritized
                    else self.max_clip_secs
                )
                if end - start <= allowed + 1e-6:
                    candidates.append((end - start, index))
            if not candidates:
                break
            _, index = min(candidates)
            left, right = raw[index], raw[index + 1]
            raw[index : index + 2] = [
                ClipBounds("", left.start_secs, right.end_secs)
            ]
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

    def _split_bounded(
        self, start: float, end: float, max_clip_secs: float | None = None
    ) -> list[ClipBounds]:
        window_secs = max_clip_secs or self.max_clip_secs
        duration = end - start
        if duration <= window_secs:
            return [ClipBounds("", start, end)]
        windows: list[ClipBounds] = []
        cursor = start
        while cursor < end:
            window_end = min(end, cursor + window_secs)
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
    return {"fast": 30.0, "balanced": 15.0, "thorough": 8.0}.get(
        indexing_mode, 15.0
    )
