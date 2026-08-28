import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.services.pipeline import transcription_hints
from app.services.transcription import DeepgramProvider


class TranscriptionTests(unittest.TestCase):
    def test_explicit_entities_become_bounded_hints(self):
        hints = transcription_hints(
            {
                "knownEntities": ["Ada Lovelace"],
                "expectedQuestions": ["Who won between Dr Abdulaziz and Moataz?"],
            }
        )
        self.assertIn("Ada Lovelace", hints)
        self.assertEqual(hints, ["Ada Lovelace"])

    @patch.dict(os.environ, {"DEEPGRAM_API_KEY": "test-key"}, clear=False)
    @patch("app.services.transcription.requests.post")
    def test_deepgram_uses_media_type_and_repeated_keyterms(self, post):
        response = Mock(ok=True)
        response.json.return_value = {"results": {"channels": [{}], "utterances": []}}
        post.return_value = response
        with tempfile.NamedTemporaryFile(suffix=".mp4") as media:
            DeepgramProvider().transcribe(Path(media.name), "ar", ["Team One", "Team Two"])
        _, kwargs = post.call_args
        self.assertEqual(kwargs["headers"]["Content-Type"], "video/mp4")
        self.assertIn(("keyterm", "Team One"), kwargs["params"])
        self.assertIn(("keyterm", "Team Two"), kwargs["params"])
