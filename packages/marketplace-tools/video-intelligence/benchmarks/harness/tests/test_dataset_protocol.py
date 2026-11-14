import unittest
from harness.datasets import aligned_subtitles


class SubtitleProtocolTest(unittest.TestCase):
    def test_excerpt_offsets_remove_unseen_source_content_without_rebasing_twice(self):
        raw = [{'start': '00:01:38.000', 'end': '00:01:39.000', 'line': 'Before excerpt'},
               {'start': '00:01:40.500', 'end': '00:01:42.000', 'line': 'Inside excerpt'},
               {'start': '00:01:44.000', 'end': '00:01:46.000', 'line': 'After excerpt'}]
        self.assertEqual(aligned_subtitles(raw, 3000, 100), [{'startMs': 500, 'endMs': 2000, 'text': 'Inside excerpt'}])

    def test_timestamp_arrays_missing_end_and_boundary_crossing_are_preserved(self):
        raw = [{'timestamp': [1.0, None], 'text': 'Continues to end'},
               {'start': '00:00:00,500', 'end': '00:00:01,500', 'line': 'Crosses origin'}]
        self.assertEqual(aligned_subtitles(raw, 2000, 1), [{'startMs': 0, 'endMs': 500, 'text': 'Crosses origin'},
                                                         {'startMs': 0, 'endMs': 2000, 'text': 'Continues to end'}])


if __name__ == '__main__':
    unittest.main()
