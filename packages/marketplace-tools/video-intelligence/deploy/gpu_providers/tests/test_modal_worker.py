from __future__ import annotations

import os
import subprocess
import unittest
from unittest.mock import Mock, patch

from gpu_providers.modal_worker_entrypoint import (
    GPU_IDLE_TIMEOUT_SECONDS,
    GPU_MAX_CONTAINERS,
    GPU_TYPE,
    _is_full_source_range,
    materialize_remote_video,
    preparation_progress,
)
from app.model_configuration import temporary_model_environment


class ModalWorkerEnvironmentTests(unittest.TestCase):
    def test_worker_uses_one_cost_optimized_gpu_and_scales_to_zero(self) -> None:
        self.assertEqual(GPU_TYPE, "T4")
        self.assertEqual(GPU_MAX_CONTAINERS, 1)
        self.assertEqual(GPU_IDLE_TIMEOUT_SECONDS, 15 * 60)

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

    def test_remote_materialization_downloads_and_uploads_without_model_secrets(self) -> None:
        updates = []

        def materialize(_url, destination, _duration, progress) -> str:
            destination.write_bytes(b"video")
            progress(99, "Ready")
            return "The real YouTube title"

        response = Mock()
        response.raise_for_status.return_value = None
        with patch(
            "gpu_providers.modal_worker_entrypoint.materialize_provider_source",
            side_effect=materialize,
        ) as download, patch(
            "gpu_providers.modal_worker_entrypoint.subprocess.run",
            return_value=subprocess.CompletedProcess(
                args=[], returncode=0, stdout='{"format":{"duration":"12.5"}}', stderr=""
            ),
        ), patch(
            "gpu_providers.modal_worker_entrypoint.requests.put", return_value=response
        ) as upload:
            result = materialize_remote_video(
                {
                    "sourceDurationSecs": 12.5,
                    "materializedSourceUploadUrl": "https://storage.example.test/upload",
                    "materializedSourceUploadHeaders": {"Content-Type": "video/mp4"},
                    "fileName": "song.mp4",
                },
                "https://www.youtube.com/watch?v=example",
                lambda *args: updates.append(args),
            )

        self.assertEqual(result["actualSourceMinutes"], 0)
        self.assertEqual(result["result"]["durationSecs"], 12.5)
        self.assertEqual(result["result"]["sizeBytes"], 5)
        self.assertEqual(result["result"]["fileName"], "The real YouTube title")
        self.assertEqual(download.call_count, 1)
        self.assertEqual(upload.call_args.kwargs["headers"], {"Content-Type": "video/mp4"})
        self.assertEqual(updates[-1][0], "complete")


if __name__ == "__main__":
    unittest.main()
