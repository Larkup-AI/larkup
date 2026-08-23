from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.remote_source import extract_bounded_remote_clip


class BoundedRunPodWorkerTests(unittest.TestCase):
    def test_serverless_image_starts_worker_without_an_http_healthcheck(self) -> None:
        dockerfile = (
            Path(__file__).resolve().parents[1] / "Dockerfile"
        ).read_text(encoding="utf-8")
        runpod_stage = dockerfile.split("FROM runtime AS runpod", maxsplit=1)[1]

        self.assertIn("HEALTHCHECK NONE", runpod_stage)
        self.assertIn('CMD ["python3", "-m", "app.runpod_worker"]', runpod_stage)

    def test_seeks_signed_source_before_input_and_never_uses_http_downloader(self) -> None:
        with TemporaryDirectory() as temporary:
            destination = Path(temporary) / "clip.mp4"

            def complete(command: list[str], **_: object):
                destination.write_bytes(b"clip")
                return type("Completed", (), {"returncode": 0, "stderr": ""})()

            with patch("app.remote_source.subprocess.run", side_effect=complete) as run:
                extract_bounded_remote_clip(
                    "https://example.test/source.mp4", destination, 600, 630
                )

            command = run.call_args.args[0]
            self.assertLess(command.index("-ss"), command.index("-i"))
            self.assertEqual(command[command.index("-ss") + 1], "600.000")
            self.assertEqual(command[command.index("-t") + 1], "30.000")
            self.assertEqual(
                command[command.index("-avoid_negative_ts") + 1], "make_zero"
            )
            self.assertIn("h264_nvenc", command)


if __name__ == "__main__":
    unittest.main()
