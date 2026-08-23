from __future__ import annotations

import unittest

from app.ranges import normalized_important_ranges
from app.timeline import rebase_result_timestamps


class PipelineRangeTests(unittest.TestCase):
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
            "scoreboardStates": [{"timeMs": 800}],
            "semanticObservations": [{"startMs": 0, "endMs": 900}],
            "entities": [{"timestampsMs": [1000]}],
        }

        rebase_result_timestamps(result, 120.0)

        self.assertEqual(result["transcript"][0]["startMs"], 120_250)
        self.assertEqual(result["transcript"][0]["words"][0]["endMs"], 120_400)
        self.assertEqual(result["visualObservations"][0]["timeMs"], 120_600)
        self.assertEqual(result["tracks"][0]["endMs"], 120_700)
        self.assertEqual(result["scoreboardStates"][0]["timeMs"], 120_800)
        self.assertEqual(result["semanticObservations"][0]["endMs"], 120_900)
        self.assertEqual(result["entities"][0]["timestampsMs"], [121_000])


if __name__ == "__main__":
    unittest.main()
