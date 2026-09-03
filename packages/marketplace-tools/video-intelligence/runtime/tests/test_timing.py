from __future__ import annotations

import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from app.services.brain import PriorityRange, fallback_plan
from app.services.pipeline import (
    Probe,
    _iter_frames,
    _recurring_overlay_text,
)
from app.utils.timing import normalized_important_ranges, rebase_result_timestamps, visual_sampling_interval


class TimingUtilsTests(unittest.TestCase):
    def test_merges_and_clamps_important_ranges_before_bounded_decode(self) -> None:
        self.assertEqual(
            normalized_important_ranges(
                {
                    "importantRanges": [
                        {"startSecs": 80, "endSecs": 140},
                        {"startSecs": -3, "endSecs": 10},
                        {"startSecs": 8, "endSecs": 25},
                        {"startSecs": 180, "endSecs": 170},
                        {"startSecs": 190, "endSecs": 260},
                    ]
                },
                200,
            ),
            [(0.0, 25.0), (80.0, 140.0), (190.0, 200.0)],
        )

    def test_rebases_clip_evidence_to_original_video_timestamps(self) -> None:
        result = {
            "transcript": [
                {
                    "startMs": 250,
                    "endMs": 500,
                    "words": [{"startMs": 250, "endMs": 400}],
                }
            ],
            "visualObservations": [{"timeMs": 600}],
            "tracks": [{"startMs": 100, "endMs": 700}],
            "recurringOverlayText": [
                {"firstSeenMs": 700, "lastSeenMs": 800, "timestampsMs": [700, 800]}
            ],
            "semanticObservations": [{"startMs": 0, "endMs": 900}],
            "videoEmbeddings": [{"startMs": 0, "endMs": 900}],
            "entities": [{"timestampsMs": [1000]}],
            "knowledgeSummary": {
                "stateHistory": [{"startMs": 100, "endMs": 200}],
                "keyEvents": [{"startMs": 300, "endMs": 400}],
                "participants": [{"evidence": [{"startMs": 500, "endMs": 600}]}],
                "context": [{"evidence": [{"startMs": 700, "endMs": 800}]}],
            },
        }

        rebase_result_timestamps(result, 120.0)

        self.assertEqual(result["transcript"][0]["startMs"], 120_250)
        self.assertEqual(result["transcript"][0]["words"][0]["endMs"], 120_400)
        self.assertEqual(result["visualObservations"][0]["timeMs"], 120_600)
        self.assertEqual(result["tracks"][0]["endMs"], 120_700)
        self.assertEqual(result["recurringOverlayText"][0]["lastSeenMs"], 120_800)
        self.assertEqual(result["recurringOverlayText"][0]["firstSeenMs"], 120_700)
        self.assertEqual(result["recurringOverlayText"][0]["timestampsMs"], [120_700, 120_800])
        self.assertEqual(result["semanticObservations"][0]["endMs"], 120_900)
        self.assertEqual(result["videoEmbeddings"][0]["endMs"], 120_900)
        self.assertEqual(result["entities"][0]["timestampsMs"], [121_000])
        self.assertEqual(result["knowledgeSummary"]["stateHistory"][0]["startMs"], 120_100)
        self.assertEqual(result["knowledgeSummary"]["keyEvents"][0]["endMs"], 120_400)
        self.assertEqual(
            result["knowledgeSummary"]["participants"][0]["evidence"][0]["startMs"],
            120_500,
        )
        self.assertEqual(
            result["knowledgeSummary"]["context"][0]["evidence"][0]["endMs"],
            120_800,
        )

    def test_long_balanced_indexing_has_a_bounded_visual_sample_count(self) -> None:
        # A 72-minute overview stays fast; the investigation agent can request
        # a denser bounded range later when a question needs it.
        interval = visual_sampling_interval("balanced", 72 * 60)
        self.assertEqual(interval, 6.0)
        self.assertLessEqual((72 * 60) / interval, 720)

    def test_short_thorough_inspection_keeps_its_requested_density(self) -> None:
        self.assertEqual(visual_sampling_interval("thorough", 60), 0.75)

    def test_recurring_overlay_text_needs_repetition_whatever_the_text_is(self) -> None:
        overlays = _recurring_overlay_text(
            {
                "Chapter 3: Results": [10_000, 12_000, 40_000],
                "seen once": [5_000],
                "2-1": [20_000, 22_000],
            },
            {"Chapter 3: Results": 2.7, "seen once": 0.9, "2-1": 1.5},
        )

        # Repetition is the only requirement; the text's shape is never a filter.
        self.assertEqual([item["text"] for item in overlays], ["Chapter 3: Results", "2-1"])
        self.assertEqual(overlays[0]["firstSeenMs"], 10_000)
        self.assertEqual(overlays[0]["lastSeenMs"], 40_000)
        self.assertEqual(overlays[0]["observations"], 3)
        self.assertEqual(overlays[0]["confidence"], 0.9)

    def test_recurring_overlay_text_skips_body_text_that_is_not_an_overlay(self) -> None:
        long_line = "a sentence of body text that is far too long to be a screen overlay label"
        overlays = _recurring_overlay_text(
            {long_line: [1_000, 2_000]}, {long_line: 1.8}
        )

        self.assertEqual(overlays, [])

    def test_agent_plan_seeks_coarse_coverage_and_denser_priority_ranges(self) -> None:
        class Capture:
            def __init__(self) -> None:
                self.position_ms = 0.0
                self.read_count = 0
                self.seek_positions: list[float] = []

            def isOpened(self) -> bool:
                return True

            def set(self, _property: int, value: float) -> None:
                self.position_ms = value
                self.seek_positions.append(value)

            def read(self) -> tuple[bool, object]:
                self.read_count += 1
                return True, object()

            def get(self, property: int) -> float:
                from app.services.pipeline import cv2

                if property == cv2.CAP_PROP_FRAME_COUNT:
                    return 301
                return self.position_ms

            def release(self) -> None:
                return None

        capture = Capture()
        probe = Probe(duration_seconds=10, width=1280, height=720, fps=30, has_audio=True)
        plan = replace(
            fallback_plan("fast", 10, True),
            sample_interval_secs=5,
            priority_sample_interval_secs=1,
            priority_ranges=[PriorityRange(7, 8, "visible change")],
        )
        with patch("app.services.pipeline.cv2.VideoCapture", return_value=capture):
            frames = list(
                _iter_frames(
                    Path("/tmp/video.mp4"),
                    probe,
                    {"indexingMode": "fast"},
                    plan,
                )
            )

        self.assertEqual(len(frames), 5)
        self.assertEqual(capture.read_count, 5)
        self.assertEqual(capture.seek_positions, [0.0, 5_000.0, 7_000.0, 8_000.0, 10_000.0])


if __name__ == "__main__":
    unittest.main()
