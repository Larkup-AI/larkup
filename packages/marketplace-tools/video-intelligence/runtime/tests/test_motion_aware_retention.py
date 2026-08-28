from __future__ import annotations

import unittest

import numpy as np

from app.services.motion import MotionSampler
from app.services.pipeline import _retain_clip_frame


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


if __name__ == "__main__":
    unittest.main()
