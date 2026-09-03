from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from gpu_providers.modal_worker_entrypoint import (
    _is_full_source_range,
    preparation_progress,
)
from app.model_configuration import temporary_model_environment


class ModalWorkerEnvironmentTests(unittest.TestCase):
    def test_whole_source_range_is_not_treated_as_bounded_clip(self) -> None:
        self.assertTrue(_is_full_source_range([(0.0, 3600.0)], 3600.0))
        self.assertFalse(_is_full_source_range([(120.0, 180.0)], 3600.0))

    @patch("gpu_providers.modal_worker_entrypoint.time.monotonic", return_value=50.0)
    def test_preparation_progress_reports_measured_eta(self, _monotonic) -> None:
        updates = []
        report = preparation_progress(
            lambda *args: updates.append(args), started_at=10.0
        )

        report(25, "Preparing")

        stage, overall, message, stage_percent, details = updates[-1]
        self.assertEqual(
            (stage, overall, message, stage_percent), ("prepare", 6, "Preparing", 25)
        )
        self.assertEqual(details["elapsedSeconds"], 40)
        self.assertEqual(details["estimatedRemainingSeconds"], 120)
        self.assertEqual(details["unit"], "source preparation")

    def test_per_job_user_models_replace_stale_worker_secrets_temporarily(self) -> None:
        environment = {
            "LARKUP_VIDEO_VISION_PROVIDER": "google",
            "LARKUP_VIDEO_VISION_API_KEY": "stale-shared-key",
            "LARKUP_VIDEO_GOOGLE_API_KEY": "managed-google-key",
            "DEEPGRAM_API_KEY": "managed-audio-key",
        }
        payload = {
            "modelConfiguration": {
                "vision": {"provider": "openai", "apiKey": "vision-key", "model": "gpt-4.1-mini"},
                "brain": {"provider": "google", "apiKey": "brain-key", "model": "gemini-3.5-flash-lite"},
                "audio": {"provider": "groq", "apiKey": "audio-key", "model": "whisper-large-v3-turbo"},
            }
        }
        with patch.dict(os.environ, environment, clear=True):
            with temporary_model_environment(payload):
                self.assertEqual(os.environ["LARKUP_VIDEO_VISION_PROVIDER"], "openai")
                self.assertEqual(os.environ["LARKUP_VIDEO_VISION_API_KEY"], "vision-key")
                self.assertEqual(
                    os.environ["LARKUP_VIDEO_SEMANTIC_VISION_MODEL"], "gpt-4.1-mini"
                )
                self.assertEqual(os.environ["LARKUP_VIDEO_AGENT_API_KEY"], "brain-key")
                self.assertEqual(os.environ["GROQ_API_KEY"], "audio-key")
                self.assertNotIn("LARKUP_VIDEO_GOOGLE_API_KEY", os.environ)
                self.assertNotIn("DEEPGRAM_API_KEY", os.environ)
            self.assertEqual(os.environ["LARKUP_VIDEO_VISION_PROVIDER"], "google")
            self.assertEqual(
                os.environ["LARKUP_VIDEO_VISION_API_KEY"], "stale-shared-key"
            )
            self.assertEqual(os.environ["DEEPGRAM_API_KEY"], "managed-audio-key")


if __name__ == "__main__":
    unittest.main()
