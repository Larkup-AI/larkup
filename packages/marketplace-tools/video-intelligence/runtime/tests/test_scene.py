from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.scene import SceneDetector, semantic_clip_window_secs


class SceneDetectorCoverageTests(unittest.TestCase):
    """PySceneDetect is unavailable in the test environment (and may fail on
    a fixture with no real scene content anyway), so these exercise the
    fixed-window fallback -- the same path a video with zero detectable
    scene cuts takes in production."""

    def setUp(self) -> None:
        self.detector = SceneDetector()

    def test_fast_mode_groups_a_bounded_question_into_fewer_gateway_clips(self) -> None:
        self.assertEqual(semantic_clip_window_secs("fast"), 30.0)
        self.assertEqual(semantic_clip_window_secs("balanced"), 15.0)
        self.assertEqual(semantic_clip_window_secs("deep"), 8.0)

    def test_covers_a_long_range_with_no_gaps(self) -> None:
        # Regression test for the original bug: a whole video used to share a
        # single global cap of ~12 semantic-vision frames total, so most of a
        # long video's timeline never reached the VLM at all. Every second of
        # a requested range must now fall inside some clip.
        with patch.object(SceneDetector, "_scene_cut_points", return_value=[]):
            clips = self.detector.plan_clips(Path("unused.mp4"), [(0.0, 1800.0)])  # 30-minute video
        self.assertGreater(len(clips), 1)
        self.assertEqual(clips[0].start_secs, 0.0)
        self.assertEqual(clips[-1].end_secs, 1800.0)
        for previous, current in zip(clips, clips[1:]):
            self.assertLessEqual(current.start_secs, previous.end_secs)
            self.assertGreaterEqual(current.start_secs, previous.end_secs - self.detector.overlap_secs - 1e-6)

    def test_no_clip_exceeds_the_max_duration(self) -> None:
        with patch.object(SceneDetector, "_scene_cut_points", return_value=[]):
            clips = self.detector.plan_clips(Path("unused.mp4"), [(0.0, 300.0)])
        for clip in clips:
            self.assertLessEqual(clip.end_secs - clip.start_secs, self.detector.max_clip_secs + 1e-6)

    def test_multiple_disjoint_ranges_stay_separate(self) -> None:
        with patch.object(SceneDetector, "_scene_cut_points", return_value=[]):
            clips = self.detector.plan_clips(Path("unused.mp4"), [(0.0, 10.0), (100.0, 110.0)])
        self.assertTrue(any(clip.start_secs < 10.0 for clip in clips))
        self.assertTrue(any(clip.start_secs >= 100.0 for clip in clips))
        self.assertFalse(any(10.0 < clip.start_secs < 100.0 for clip in clips))

    def test_scene_cuts_are_honored_when_available(self) -> None:
        with patch.object(SceneDetector, "_scene_cut_points", return_value=[3.0, 7.5]):
            clips = self.detector.plan_clips(Path("unused.mp4"), [(0.0, 10.0)])
        boundaries = {round(clip.start_secs, 3) for clip in clips} | {
            round(clip.end_secs, 3) for clip in clips
        }
        self.assertIn(3.0, boundaries)
        self.assertIn(7.5, boundaries)

    def test_bounded_live_plan_skips_scene_cut_fanout(self) -> None:
        detector = SceneDetector(max_clip_secs=15.0, detect_scene_cuts=False)
        with patch.object(SceneDetector, "_scene_cut_points", return_value=[2.0, 4.0, 6.0, 8.0]):
            clips = detector.plan_clips(Path("unused.mp4"), [(0.0, 60.0)])
        self.assertEqual([(clip.start_secs, clip.end_secs) for clip in clips], [
            (0.0, 15.0),
            (14.0, 29.0),
            (28.0, 43.0),
            (42.0, 57.0),
            (56.0, 60.0),
        ])

    def test_clip_ids_are_unique_and_ordered(self) -> None:
        with patch.object(SceneDetector, "_scene_cut_points", return_value=[]):
            clips = self.detector.plan_clips(Path("unused.mp4"), [(0.0, 60.0)])
        ids = [clip.clip_id for clip in clips]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids, sorted(ids))


if __name__ == "__main__":
    unittest.main()
