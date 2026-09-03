from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.model_configuration import temporary_model_environment


class JobModelConfigurationTests(unittest.TestCase):
    def test_requires_all_three_user_owned_model_roles(self) -> None:
        with self.assertRaisesRegex(ValueError, "audio"):
            with temporary_model_environment({"modelConfiguration": {}}):
                pass

    def test_applies_and_restores_audio_brain_and_vision_credentials(self) -> None:
        payload = {
            "modelConfiguration": {
                "audio": {
                    "provider": "deepgram",
                    "apiKey": "user-audio",
                    "model": "nova-3",
                },
                "brain": {
                    "provider": "openai",
                    "apiKey": "user-brain",
                    "model": "openai/gpt-5-mini",
                },
                "vision": {
                    "provider": "vercel_ai_gateway",
                    "apiKey": "user-vision",
                    "model": "google/gemini-3.6-flash",
                },
            }
        }
        stale = {
            "DEEPGRAM_API_KEY": "operator-audio",
            "LARKUP_VIDEO_AGENT_API_KEY": "operator-brain",
            "AI_GATEWAY_API_KEY": "operator-gateway",
            "LARKUP_VIDEO_EMBEDDING_PROVIDER": "gateway-gemini-embedding-2",
        }
        with patch.dict(os.environ, stale, clear=True):
            with temporary_model_environment(payload):
                self.assertEqual(os.environ["DEEPGRAM_API_KEY"], "user-audio")
                self.assertEqual(os.environ["LARKUP_VIDEO_DEEPGRAM_MODEL"], "nova-3")
                self.assertEqual(os.environ["LARKUP_VIDEO_AGENT_API_KEY"], "user-brain")
                self.assertEqual(os.environ["LARKUP_VIDEO_VISION_API_KEY"], "user-vision")
                self.assertEqual(os.environ["AI_GATEWAY_API_KEY"], "user-vision")
                self.assertEqual(os.environ["LARKUP_VIDEO_TRANSCRIPTION_FALLBACK"], "")
                self.assertEqual(os.environ["LARKUP_VIDEO_EMBEDDING_PROVIDER"], "disabled")
            self.assertEqual(os.environ["DEEPGRAM_API_KEY"], "operator-audio")
            self.assertEqual(os.environ["LARKUP_VIDEO_AGENT_API_KEY"], "operator-brain")
            self.assertEqual(os.environ["AI_GATEWAY_API_KEY"], "operator-gateway")
            self.assertEqual(
                os.environ["LARKUP_VIDEO_EMBEDDING_PROVIDER"],
                "gateway-gemini-embedding-2",
            )


if __name__ == "__main__":
    unittest.main()
