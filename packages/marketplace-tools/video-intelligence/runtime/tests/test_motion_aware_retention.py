from __future__ import annotations

import unittest

import numpy as np

from app.services.motion import MotionSampler
from app.services.pipeline import (
    _select_semantic_clip_ids,
    _evenly_spaced_frames,
    _retain_clip_frame,
    semantic_frames_per_clip,
    semantic_frame_budget,
)
from app.services.brain import PriorityRange
from app.services.scene import ClipBounds


def _solid_frame(value: int, size: int = 16) -> np.ndarray:
    return np.full((size, size, 3), value, dtype=np.uint8)


class MotionAwareRetentionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sampler = MotionSampler()

    def test_high_motion_frame_survives_eviction_over_denser_static_neighbours(self) -> None:
        """Regression: uniform time-spread retention alone would evict an
        interior frame purely for being close to its neighbours, even if it
        captured a sharp visual change (an action/reveal) that its static
        neighbours did not."""
        frames: list[tuple[int, np.ndarray]] = []
        scores: list[float] = []
        previous_gray = None
        limit = 4

        # Two static frames, then a sharp spike very close in time to the
        # second one (small gap -- would be the first evicted by pure
        # temporal-density scoring), then two more static frames further out.
        timeline = [
            (0, _solid_frame(20)),
            (1000, _solid_frame(20)),
            (1050, _solid_frame(220)),  # the spike, densely packed in time
            (3000, _solid_frame(20)),
            (5000, _solid_frame(20)),
        ]
        for time_ms, frame in timeline:
            previous_gray = _retain_clip_frame(
                self.sampler, frames, scores, time_ms, frame, limit, previous_gray
            )

        retained_times = {time_ms for time_ms, _ in frames}
        self.assertEqual(len(frames), limit)
        self.assertIn(1050, retained_times)

    def test_retained_frames_stay_within_the_limit_and_time_ordered(self) -> None:
        frames: list[tuple[int, np.ndarray]] = []
        scores: list[float] = []
        previous_gray = None
        for i in range(20):
            previous_gray = _retain_clip_frame(
                self.sampler, frames, scores, i * 100, _solid_frame(i * 5 % 255), 5, previous_gray
            )
        self.assertEqual(len(frames), 5)
        self.assertEqual(len(scores), 5)
        times = [time_ms for time_ms, _ in frames]
        self.assertEqual(times, sorted(times))
        self.assertEqual(times[0], 0)

    def test_under_the_limit_keeps_every_frame(self) -> None:
        frames: list[tuple[int, np.ndarray]] = []
        scores: list[float] = []
        previous_gray = None
        for i in range(3):
            previous_gray = _retain_clip_frame(
                self.sampler, frames, scores, i * 100, _solid_frame(10), 8, previous_gray
            )
        self.assertEqual(len(frames), 3)

    def test_thorough_verification_retains_dense_chronology(self) -> None:
        self.assertEqual(semantic_frames_per_clip("thorough", True, False), 16)
        self.assertEqual(semantic_frames_per_clip("balanced", True, False), 10)
        self.assertEqual(semantic_frames_per_clip("balanced", False, False), 4)

    def test_bounded_continuous_inspection_honors_agent_frame_budget(self) -> None:
        self.assertEqual(
            semantic_frame_budget({"continuousSequence": True, "maxFrames": 18}, 7),
            18,
        )
        self.assertEqual(semantic_frame_budget({}, 7), 7)
        self.assertEqual(
            semantic_frame_budget({"continuousSequence": True, "maxFrames": 99}, 7),
            24,
        )

    def test_terminal_chronology_is_bounded_and_preserves_both_ends(self) -> None:
        frames = [(index * 1_000, _solid_frame(index)) for index in range(20)]
        selected = _evenly_spaced_frames(frames, 6)
        self.assertEqual(len(selected), 6)
        self.assertEqual(selected[0][0], 0)
        self.assertEqual(selected[-1][0], 19_000)
        self.assertEqual(
            [time_ms for time_ms, _ in selected],
            sorted(time_ms for time_ms, _ in selected),
        )

    def test_agentic_skim_covers_a_long_source_and_prefers_salient_clips(self) -> None:
        clips = [ClipBounds(f"clip_{index}", index * 60, (index + 1) * 60) for index in range(60)]
        scores = {clip.clip_id: [0.1] for clip in clips}
        scores["clip_17"] = [80.0]
        selected = _select_semantic_clip_ids(
            clips,
            scores,
            [{"timeMs": 43 * 60_000, "ocr": [{"text": "visible"}], "objects": []}],
            [{"startMs": 52 * 60_000, "endMs": 53 * 60_000, "text": "dense " * 100}],
            [PriorityRange(10 * 60, 11 * 60, "planner focus")],
            "balanced",
            3_600,
        )

        self.assertEqual(len(selected), 60)
        self.assertIn("clip_10", selected)

    def test_fast_agentic_skim_bounds_model_reads_without_losing_timeline_coverage(self) -> None:
        clips = [ClipBounds(f"clip_{index}", index * 20, (index + 1) * 20) for index in range(180)]
        selected = _select_semantic_clip_ids(
            clips,
            {clip.clip_id: [float(index % 7)] for index, clip in enumerate(clips)},
            [],
            [],
            [],
            "fast",
            3_600,
        )

        self.assertEqual(len(selected), 30)
        selected_indexes = [int(value.split("_")[1]) for value in selected]
        self.assertLess(selected_indexes[0], 6)
        self.assertGreater(selected_indexes[-1], 173)


if __name__ == "__main__":
    unittest.main()
