from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from gpu_providers.progress import create_progress_reporter


class ProgressReporterTests(unittest.TestCase):
    def test_sends_structured_stage_updates_without_spamming_the_status_api(
        self,
    ) -> None:
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
        report = create_progress_reporter(
            lambda _: (_ for _ in ()).throw(RuntimeError("offline"))
        )
        report("probe", 3, "Reading metadata")

    def test_keeps_overall_progress_monotonic_when_parallel_stage_updates_arrive_late(
        self,
    ) -> None:
        sent: list[str] = []
        report = create_progress_reporter(sent.append)
        report("detect", 72, "Analyzing visual evidence")
        report("transcribe", 41, "Speech timeline ready")

        self.assertEqual([json.loads(payload)["percent"] for payload in sent], [72, 72])

    def test_relays_stage_progress_even_when_overall_integer_does_not_change(
        self,
    ) -> None:
        sent: list[str] = []
        with patch("gpu_providers.progress.time.monotonic", side_effect=[10.0, 11.0]):
            report = create_progress_reporter(sent.append)
            report("probe", 21, "Reading signals", 4)
            report("probe", 21, "Reading signals", 5)

        self.assertEqual(
            [json.loads(payload)["stagePercent"] for payload in sent], [4, 5]
        )

    def test_preserves_structured_eta_and_counters(self) -> None:
        sent: list[str] = []
        report = create_progress_reporter(sent.append)
        report(
            "synthesize",
            70,
            "Watching clips",
            40,
            {
                "estimatedRemainingSeconds": 123,
                "current": 4,
                "total": 10,
                "unit": "clips",
            },
        )

        payload = json.loads(sent[-1])
        self.assertEqual(payload["estimatedRemainingSeconds"], 123)
        self.assertEqual(
            (payload["current"], payload["total"], payload["unit"]), (4, 10, "clips")
        )

    def test_relays_liveness_sequence_without_changing_measured_percent(self) -> None:
        sent: list[str] = []
        with patch("gpu_providers.progress.time.monotonic", side_effect=[10.0, 10.1]):
            report = create_progress_reporter(sent.append)
            report("transcribe", 20, "Reading speech", 25, {"sequence": 1})
            report("transcribe", 20, "Reading speech", 25, {"sequence": 2})

        self.assertEqual([json.loads(payload)["percent"] for payload in sent], [20, 20])
        self.assertEqual([json.loads(payload)["sequence"] for payload in sent], [1, 2])


if __name__ == "__main__":
    unittest.main()
