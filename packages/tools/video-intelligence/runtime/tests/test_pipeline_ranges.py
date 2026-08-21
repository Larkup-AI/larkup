from __future__ import annotations

import unittest

from app.ranges import normalized_important_ranges


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


if __name__ == "__main__":
    unittest.main()
