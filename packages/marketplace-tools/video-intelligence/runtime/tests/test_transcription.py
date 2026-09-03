import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.services.pipeline import transcription_hints
from app.services.transcription import (
    DeepgramProvider,
    ElevenLabsProvider,
    EmptyTranscriptionError,
    OpenAICompatibleProvider,
    TranscriptionService,
    WhisperProvider,
)


def _segment(start: float, end: float, text: str) -> Mock:
    return Mock(start=start, end=end, text=text, words=[])


class WhisperVoiceDetectionTests(unittest.TestCase):
    """Continuous background noise makes voice detection discard real speech."""

    def _provider(self, passes: list[list[Mock]]) -> tuple[WhisperProvider, Mock]:
        provider = WhisperProvider("cpu")
        model = Mock()
        calls: list[bool] = []

        def transcribe(_path, **kwargs):
            calls.append(kwargs["vad_filter"])
            return iter(passes[len(calls) - 1]), Mock(duration=600.0, language="ar")

        model.transcribe.side_effect = transcribe
        provider._model = model
        model.calls = calls
        return provider, model

    def test_a_nearly_silent_result_is_retried_without_voice_detection(self) -> None:
        provider, model = self._provider(
            [
                [_segment(10, 12, "a fragment")],
                [_segment(start, start + 4, f"line {start}") for start in range(0, 400, 4)],
            ]
        )

        result, language = provider.transcribe(Path("/tmp/source.wav"), "ar")

        self.assertEqual(model.calls, [True, False])
        self.assertEqual(len(result), 100)
        self.assertEqual(language, "ar")

    def test_a_healthy_result_keeps_voice_detection_and_does_not_retry(self) -> None:
        provider, model = self._provider(
            [[_segment(start, start + 5, f"line {start}") for start in range(0, 500, 5)]]
        )

        result, _language = provider.transcribe(Path("/tmp/source.wav"), "ar")

        self.assertEqual(model.calls, [True])
        self.assertEqual(len(result), 100)

    def test_a_retry_that_hears_less_keeps_the_first_pass(self) -> None:
        # Without voice detection a decoder can emit hallucinated text over
        # silence. The retry only wins when it actually recovers more speech.
        provider, model = self._provider(
            [[_segment(10, 12, "a fragment")], []],
        )

        result, _language = provider.transcribe(Path("/tmp/source.wav"), "ar")

        self.assertEqual(model.calls, [True, False])
        self.assertEqual([item["text"] for item in result], ["a fragment"])


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
            DeepgramProvider().transcribe(
                Path(media.name), "ar", ["Team One", "Team Two"]
            )
        _, kwargs = post.call_args
        self.assertEqual(kwargs["headers"]["Content-Type"], "video/mp4")
        self.assertIn(("language", "ar"), kwargs["params"])
        self.assertNotIn(("language", "multi"), kwargs["params"])
        self.assertIn(("keyterm", "Team One"), kwargs["params"])
        self.assertIn(("keyterm", "Team Two"), kwargs["params"])

    @patch.dict(os.environ, {"DEEPGRAM_API_KEY": "test-key"}, clear=False)
    @patch("app.services.transcription.requests.post")
    def test_deepgram_recovers_timestamped_words_when_utterances_are_missing(
        self, post
    ):
        response = Mock(ok=True)
        response.json.return_value = {
            "results": {
                "channels": [
                    {
                        "detected_language": "en",
                        "alternatives": [
                            {
                                "transcript": "Hello world.",
                                "words": [
                                    {
                                        "word": "Hello",
                                        "start": 1.0,
                                        "end": 1.3,
                                        "confidence": 0.9,
                                    },
                                    {
                                        "punctuated_word": "world.",
                                        "start": 1.4,
                                        "end": 1.8,
                                        "confidence": 0.8,
                                    },
                                ],
                            }
                        ],
                    }
                ],
                "utterances": [],
            }
        }
        post.return_value = response
        with tempfile.NamedTemporaryFile(suffix=".mp4") as media:
            segments, language = DeepgramProvider().transcribe(Path(media.name), "auto")
        _, kwargs = post.call_args
        self.assertIn(("model", "nova-3"), kwargs["params"])
        self.assertIn(("language", "multi"), kwargs["params"])
        self.assertNotIn(("detect_language", "true"), kwargs["params"])
        self.assertEqual(kwargs["timeout"], 60)
        self.assertEqual(language, "en")
        self.assertEqual(segments[0]["startMs"], 1_000)
        self.assertEqual(segments[0]["endMs"], 1_800)
        self.assertEqual(segments[0]["text"], "Hello world.")

    @patch.dict(
        os.environ,
        {
            "LARKUP_VIDEO_TRANSCRIPTION_PROVIDER": "deepgram",
            "LARKUP_VIDEO_TRANSCRIPTION_FALLBACK": "whisper",
        },
        clear=False,
    )
    def test_service_falls_back_when_hosted_provider_returns_no_speech(self):
        service = TranscriptionService("cpu")
        primary = Mock()
        primary.transcribe.return_value = ([], "en")
        fallback = Mock()
        fallback.transcribe.return_value = (
            [{"startMs": 0, "endMs": 500, "text": "Hello", "words": []}],
            "en",
        )
        service._factories = {"deepgram": lambda: primary, "whisper": lambda: fallback}
        segments, language = service.transcribe(Path("media.mp4"), "auto")
        self.assertEqual(language, "en")
        self.assertEqual(segments[0]["text"], "Hello")
        fallback.transcribe.assert_called_once()
        self.assertTrue(service.last_diagnostics["fallbackUsed"])
        self.assertEqual(service.last_diagnostics["fallbackProvider"], "whisper")

    @patch.dict(
        os.environ,
        {
            "LARKUP_VIDEO_TRANSCRIPTION_PROVIDER": "deepgram",
            "LARKUP_VIDEO_TRANSCRIPTION_FALLBACK": "",
        },
        clear=False,
    )
    def test_service_reports_empty_primary_result_when_fallback_is_disabled(self):
        service = TranscriptionService("cpu")
        primary = Mock()
        primary.transcribe.return_value = ([], "en")
        service._factories = {"deepgram": lambda: primary}
        with self.assertRaisesRegex(EmptyTranscriptionError, "no usable speech"):
            service.transcribe(Path("media.mp4"), "auto")

    @patch.dict(
        os.environ,
        {
            "LARKUP_VIDEO_TRANSCRIPTION_PROVIDER": "deepgram",
            "LARKUP_VIDEO_TRANSCRIPTION_FALLBACK": "",
            "LARKUP_VIDEO_TRANSCRIPTION_CHUNK_SECONDS": "30",
            "LARKUP_VIDEO_TRANSCRIPTION_CONCURRENCY": "2",
        },
        clear=False,
    )
    @patch("app.services.transcription._materialize_hosted_audio_chunks")
    def test_service_transcribes_long_hosted_audio_in_parallel_rebased_chunks(
        self, chunks
    ):
        chunks.return_value = [(0.0, Path("first.mp3")), (30.0, Path("second.mp3"))]
        service = TranscriptionService("cpu")
        primary = Mock()

        def transcribe(path, _language, _hints):
            text = path.stem
            return (
                [{"startMs": 1_000, "endMs": 2_000, "text": text, "words": []}],
                "en",
            )

        primary.transcribe.side_effect = transcribe
        service._factories = {"deepgram": lambda: primary}

        progress = Mock()
        segments, language = service.transcribe(
            Path("media.mp4"), "auto", source_duration_secs=70, progress=progress
        )

        self.assertEqual(language, "en")
        self.assertEqual([segment["startMs"] for segment in segments], [1_000, 31_000])
        self.assertEqual(service.last_diagnostics["chunkCount"], 2)
        self.assertEqual(service.last_diagnostics["completedChunks"], 2)
        self.assertEqual(service.last_diagnostics["chunkErrors"], 0)
        self.assertFalse(service.last_diagnostics["fallbackUsed"])
        self.assertIsNone(service.last_diagnostics["fallbackProvider"])
        progress.assert_any_call(0, 2)
        progress.assert_any_call(2, 2)

    @patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}, clear=False)
    @patch("app.services.transcription.requests.post")
    def test_groq_uses_compatible_timestamped_transcription(self, post):
        response = Mock(ok=True)
        response.json.return_value = {"segments": [], "language": "en"}
        post.return_value = response
        with tempfile.NamedTemporaryFile(suffix=".mp4") as media:
            OpenAICompatibleProvider("groq").transcribe(
                Path(media.name), "en", ["Larkup"]
            )
        _, kwargs = post.call_args
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer test-key")
        self.assertIn(("response_format", "verbose_json"), kwargs["data"])

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-key"}, clear=False)
    @patch("app.services.transcription.requests.post")
    def test_elevenlabs_converts_word_timestamps_to_segments(self, post):
        response = Mock(ok=True)
        response.json.return_value = {
            "language_code": "en",
            "words": [{"text": "Hello", "start": 0, "end": 0.5, "type": "word"}],
        }
        post.return_value = response
        with tempfile.NamedTemporaryFile(suffix=".mp4") as media:
            segments, language = ElevenLabsProvider().transcribe(
                Path(media.name), "auto"
            )
        self.assertEqual(language, "en")
        self.assertEqual(segments[0]["startMs"], 0)
        self.assertEqual(segments[0]["endMs"], 500)
