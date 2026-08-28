from __future__ import annotations

import unittest

import numpy as np

from app.services.motion import MotionSampler


def _solid_frame(value: int, size: int = 16) -> np.ndarray:
    return np.full((size, size, 3), value, dtype=np.uint8)


class MotionSamplerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sampler = MotionSampler()

    def test_score_sequence_first_frame_is_zero_and_static_frames_score_low(self) -> None:
        frames = [(0, _solid_frame(50)), (100, _solid_frame(50)), (200, _solid_frame(50))]
        scored = self.sampler.score_sequence(frames)
        self.assertEqual(scored[0].motion_score, 0.0)
        self.assertEqual(scored[1].motion_score, 0.0)
        self.assertEqual(scored[2].motion_score, 0.0)

    def test_score_sequence_detects_a_large_visual_change(self) -> None:
        frames = [(0, _solid_frame(10)), (100, _solid_frame(10)), (200, _solid_frame(240))]
        scored = self.sampler.score_sequence(frames)
        self.assertGreater(scored[2].motion_score, scored[1].motion_score)

    def test_select_adaptive_returns_all_frames_when_under_budget(self) -> None:
        frames = [(i * 100, _solid_frame(i)) for i in range(5)]
        selected = self.sampler.select_adaptive(frames, target_count=10)
        self.assertEqual(len(selected), 5)

    def test_select_adaptive_prioritizes_the_high_motion_spike(self) -> None:
        # 20 static frames, then one sharp spike, then more static frames.
        frames = [(i * 100, _solid_frame(20)) for i in range(15)]
        frames.append((1500, _solid_frame(220)))
        frames += [(1600 + i * 100, _solid_frame(20)) for i in range(15)]
        selected = self.sampler.select_adaptive(frames, target_count=8, coverage_floor=0.5)
        selected_times = {time_ms for time_ms, _ in selected}
        self.assertIn(1500, selected_times)
        self.assertLessEqual(len(selected), 8)

    def test_select_adaptive_keeps_temporal_coverage_for_flat_motion(self) -> None:
        frames = [(i * 100, _solid_frame(30)) for i in range(30)]
        selected = self.sampler.select_adaptive(frames, target_count=6, coverage_floor=1.0)
        times = sorted(time_ms for time_ms, _ in selected)
        self.assertEqual(times[0], 0)
        self.assertGreaterEqual(times[-1], 2500)
        self.assertLessEqual(len(selected), 6)


if __name__ == "__main__":
    unittest.main()
