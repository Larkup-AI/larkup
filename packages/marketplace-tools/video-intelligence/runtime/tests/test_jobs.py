from __future__ import annotations

from io import StringIO
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.services.jobs import PREPARATION_CEILING_PERCENT, analysis_source


class AnalysisSourceTest(unittest.TestCase):
    def test_keeps_a_non_av1_source(self) -> None:
        source = Path("/tmp/video.mp4")
        with patch(
            "app.services.jobs.subprocess.run",
            return_value=subprocess.CompletedProcess([], 0, stdout="h264\n", stderr=""),
        ):
            actual, temporary = analysis_source(source, "job_123")
        self.assertEqual(actual, source)
        self.assertIsNone(temporary)

    def test_transcodes_an_av1_source_to_h264(self) -> None:
        source = Path("/tmp/video.webm")
        calls: list[list[str]] = []
        updates: list[tuple[int, str]] = []

        def run(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
            calls.append(command)
            stdout = "av1\n" if len(calls) == 1 else "600\n"
            return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

        process = Mock()
        process.stdout = StringIO("out_time_us=300000000\nprogress=continue\nprogress=end\n")
        process.stderr = StringIO("")
        process.wait.return_value = 0

        with (
            patch("app.services.jobs.subprocess.run", side_effect=run),
            patch("app.services.jobs.subprocess.Popen", return_value=process) as popen,
        ):
            actual, temporary = analysis_source(source, "job_123", lambda percent, message: updates.append((percent, message)))
        self.assertEqual(actual, Path("/tmp/video.larkup-job_123.h264.mp4"))
        self.assertEqual(temporary, actual)
        command = popen.call_args.args[0]
        self.assertIn("libx264", command)
        self.assertIn("ultrafast", command)
        self.assertIn("aac", command)
        self.assertTrue(any("50%" in message for _, message in updates))
        self.assertEqual(updates[-1][0], PREPARATION_CEILING_PERCENT)
        # Preparation reports its own share of the bar and nothing beyond it.
        self.assertEqual([percent for percent, _ in updates], sorted(percent for percent, _ in updates))
        self.assertTrue(all(percent <= PREPARATION_CEILING_PERCENT for percent, _ in updates))
