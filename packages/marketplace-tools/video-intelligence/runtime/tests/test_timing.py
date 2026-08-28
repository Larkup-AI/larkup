from __future__ import annotations

import unittest

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
            "scoreboardStates": [{"timeMs": 800}],
            "semanticObservations": [{"startMs": 0, "endMs": 900}],
            "videoEmbeddings": [{"startMs": 0, "endMs": 900}],
            "entities": [{"timestampsMs": [1000]}],
        }

        rebase_result_timestamps(result, 120.0)

        self.assertEqual(result["transcript"][0]["startMs"], 120_250)
        self.assertEqual(result["transcript"][0]["words"][0]["endMs"], 120_400)
        self.assertEqual(result["visualObservations"][0]["timeMs"], 120_600)
        self.assertEqual(result["tracks"][0]["endMs"], 120_700)
        self.assertEqual(result["scoreboardStates"][0]["timeMs"], 120_800)
        self.assertEqual(result["semanticObservations"][0]["endMs"], 120_900)
        self.assertEqual(result["videoEmbeddings"][0]["endMs"], 120_900)
        self.assertEqual(result["entities"][0]["timestampsMs"], [121_000])

    def test_long_balanced_indexing_has_a_bounded_visual_sample_count(self) -> None:
        # A 72-minute overview stays fast; the investigation agent can request
        # a denser bounded range later when a question needs it.
        interval = visual_sampling_interval("balanced", 72 * 60)
        self.assertEqual(interval, 6.0)
        self.assertLessEqual((72 * 60) / interval, 720)

    def test_short_deep_inspection_keeps_its_requested_density(self) -> None:
        self.assertEqual(visual_sampling_interval("deep", 60), 0.75)


if __name__ == "__main__":
    unittest.main()
