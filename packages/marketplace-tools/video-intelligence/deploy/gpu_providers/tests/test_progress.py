from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from gpu_providers.progress import create_progress_reporter


class ProgressReporterTests(unittest.TestCase):
    def test_sends_structured_stage_updates_without_spamming_the_status_api(self) -> None:
        sent: list[str] = []
        with patch("gpu_providers.progress.time.monotonic", return_value=10.0):
            report = create_progress_reporter(sent.append)
            report("transcribe", 8, "Transcribing")
            report("transcribe", 9, "Transcribing")
            report("transcribe", 10, "Transcribing")
            report("decode", 42, "Selecting frames")

        self.assertEqual(len(sent), 3)
        self.assertEqual(json.loads(sent[0])["percent"], 8)
        self.assertEqual(json.loads(sent[1])["percent"], 10)
        self.assertEqual(json.loads(sent[2])["stage"], "decode")

    def test_progress_transport_failure_does_not_raise(self) -> None:
        report = create_progress_reporter(lambda _: (_ for _ in ()).throw(RuntimeError("offline")))
        report("probe", 3, "Reading metadata")


if __name__ == "__main__":
    unittest.main()
