"""Speech-to-text, behind a provider so a deploy target can pick the cheapest
or fastest option available to it without the pipeline caring which one runs.

`whisper` decodes locally (faster-whisper); hosted providers are preferred by
managed workers and may fall back to Whisper when they return no usable speech.
"""

from __future__ import annotations

import os
import subprocess
import threading
import mimetypes
import tempfile
from abc import ABC, abstractmethod
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable
import requests

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
OPENAI_TRANSCRIPT_URL = "https://api.openai.com/v1/audio/transcriptions"
GROQ_TRANSCRIPT_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
ELEVENLABS_TRANSCRIPT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
TranscriptionProgress = Callable[[int, int], None]


class TranscriptionProvider(ABC):
    @abstractmethod
    def transcribe(
        self, path: Path, language_hint: str | None, hints: list[str] | None = None
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Returns (segments, detected_language). Each segment has startMs/endMs/text/words."""


class EmptyTranscriptionError(RuntimeError):
    """A provider completed successfully but returned no usable speech evidence."""


def _materialize_hosted_audio_chunks(
    path: Path, duration_secs: float, chunk_secs: int, destination: Path
) -> list[tuple[float, Path]]:
    """Decode a long source once into small speech-provider uploads."""
    if duration_secs <= chunk_secs:
        return [(0.0, path)]
    pattern = destination / "speech-%05d.mp3"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "48k",
            "-f",
            "segment",
            "-segment_time",
            str(chunk_secs),
            "-reset_timestamps",
            "1",
            str(pattern),
        ],
        check=True,
        capture_output=True,
    )
    chunks = sorted(destination.glob("speech-*.mp3"))
    if not chunks:
        raise RuntimeError("ffmpeg produced no audio chunks")
    return [(index * float(chunk_secs), chunk) for index, chunk in enumerate(chunks)]


def _rebase_segments(
    segments: list[dict[str, Any]], offset_secs: float
) -> list[dict[str, Any]]:
    offset_ms = round(offset_secs * 1_000)
    rebased: list[dict[str, Any]] = []
    for segment in segments:
        copy = {**segment}
        for key in ("startMs", "endMs"):
            if isinstance(copy.get(key), (int, float)):
                copy[key] = round(float(copy[key])) + offset_ms
        copy["words"] = [
            {
                **word,
                **{
                    key: round(float(word[key])) + offset_ms
                    for key in ("startMs", "endMs")
                    if isinstance(word.get(key), (int, float))
                },
            }
            for word in segment.get("words") or []
            if isinstance(word, dict)
        ]
        rebased.append(copy)
    return rebased


def _timestamped_segment(
    item: dict[str, Any], words: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    return {
        "startMs": round(float(item.get("start", 0)) * 1_000),
        "endMs": round(float(item.get("end", 0)) * 1_000),
        "text": str(item.get("transcript") or item.get("text") or "").strip(),
        "words": [
            {
                "startMs": round(float(word.get("start", 0)) * 1_000),
                "endMs": round(float(word.get("end", 0)) * 1_000),
                "text": str(
                    word.get("punctuated_word") or word.get("word") or ""
                ).strip(),
                "confidence": round(float(word.get("confidence", 0)), 4),
            }
            for word in (words if words is not None else item.get("words") or [])
            if str(word.get("punctuated_word") or word.get("word") or "").strip()
        ],
    }


def _deepgram_segments(results: dict[str, Any]) -> list[dict[str, Any]]:
    utterances = [
        _timestamped_segment(utterance)
        for utterance in results.get("utterances") or []
        if str(utterance.get("transcript") or "").strip()
    ]
    if utterances:
        return utterances

    channels = results.get("channels") or []
    alternatives = channels[0].get("alternatives") or [] if channels else []
    alternative = alternatives[0] if alternatives else {}
    paragraphs = (alternative.get("paragraphs") or {}).get("paragraphs") or []
    sentences = [
        sentence
        for paragraph in paragraphs
        for sentence in paragraph.get("sentences") or []
        if str(sentence.get("text") or "").strip()
    ]
    if sentences:
        words = alternative.get("words") or []
        return [
            _timestamped_segment(
                sentence,
                [
                    word
                    for word in words
                    if float(sentence.get("start", 0))
                    <= float(word.get("start", 0))
                    <= float(sentence.get("end", 0))
                ],
            )
            for sentence in sentences
        ]

    words = [
        word
        for word in alternative.get("words") or []
        if str(word.get("punctuated_word") or word.get("word") or "").strip()
    ]
    if not words:
        return []

    # Some Deepgram responses omit both utterances and paragraph metadata.
    # Build short evidence windows from word timestamps instead of collapsing
    # a long recording into one unusable segment.
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for word in words:
        previous_end = float(current[-1].get("end", 0)) if current else 0
        group_start = float(current[0].get("start", 0)) if current else 0
        word_start = float(word.get("start", 0))
        if current and (
            word_start - previous_end > 1.25 or word_start - group_start >= 15
        ):
            groups.append(current)
            current = []
        current.append(word)
        punctuated = str(word.get("punctuated_word") or "")
        if punctuated.endswith((".", "?", "!", "؟")):
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return [
        _timestamped_segment(
            {
                "start": group[0].get("start", 0),
                "end": group[-1].get("end", group[0].get("start", 0)),
                "text": " ".join(
                    str(word.get("punctuated_word") or word.get("word") or "").strip()
                    for word in group
                ),
            },
            group,
        )
        for group in groups
    ]


class WhisperProvider(TranscriptionProvider):
    # Below this share of the source carrying speech, voice detection is
    # assumed to have discarded speech rather than found silence. Continuous
    # background noise -- a crowd, traffic, music, a busy room -- is what
    # triggers it, and the speech it swallows is exactly the commentary or
    # narration an answer later depends on. Measured on a noisy source: voice
    # detection kept 2 segments where a second pass without it recovered 66.
    MINIMUM_SPEECH_COVERAGE = 0.1

    def __init__(self, device: str) -> None:
        self.device = device
        self._lock = threading.Lock()
        self._model: Any = None

    def _decode(
        self,
        path: Path,
        language_hint: str | None,
        hints: list[str] | None,
        use_voice_detection: bool,
    ) -> tuple[list[dict[str, Any]], Any]:
        segments, info = self._model.transcribe(
            str(path),
            language=language_hint,
            vad_filter=use_voice_detection,
            word_timestamps=True,
            beam_size=5,
            initial_prompt=", ".join(
                hint.strip() for hint in (hints or []) if hint.strip()
            )[:900]
            or None,
        )
        return [
            {
                "startMs": round(segment.start * 1_000),
                "endMs": round(segment.end * 1_000),
                "text": segment.text.strip(),
                "words": [
                    {
                        "startMs": round((word.start or segment.start) * 1_000),
                        "endMs": round((word.end or segment.end) * 1_000),
                        "text": word.word.strip(),
                        "confidence": round(float(word.probability), 4),
                    }
                    for word in (segment.words or [])
                ],
            }
            for segment in segments
            if segment.text.strip()
        ], info

    def transcribe(
        self, path: Path, language_hint: str | None, hints: list[str] | None = None
    ) -> tuple[list[dict[str, Any]], str | None]:
        with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                model_name = os.getenv("LARKUP_VIDEO_WHISPER_MODEL", "small")
                compute_type = "float16" if self.device == "cuda" else "int8"
                self._model = WhisperModel(
                    model_name, device=self.device, compute_type=compute_type
                )
            result, info = self._decode(path, language_hint, hints, True)
            duration = float(getattr(info, "duration", 0) or 0)
            speech_secs = sum(
                (item["endMs"] - item["startMs"]) / 1_000 for item in result
            )
            if duration > 0 and speech_secs / duration < self.MINIMUM_SPEECH_COVERAGE:
                # Keep whichever pass heard more. Voice detection is worth
                # having when it works -- it is faster and suppresses
                # hallucinated text over silence -- so it is only overridden
                # when a second pass demonstrably recovers more speech.
                retried, retried_info = self._decode(path, language_hint, hints, False)
                if len(retried) > len(result):
                    return retried, getattr(retried_info, "language", None)
        return result, getattr(info, "language", None)


class DeepgramProvider(TranscriptionProvider):
    def transcribe(
        self, path: Path, language_hint: str | None, hints: list[str] | None = None
    ) -> tuple[list[dict[str, Any]], str | None]:
        api_key = os.getenv("DEEPGRAM_API_KEY")
        if not api_key:
            raise RuntimeError("DEEPGRAM_API_KEY is not configured")
        automatic_language = not language_hint or language_hint == "auto"
        model = (
            os.getenv(
                (
                    "LARKUP_VIDEO_DEEPGRAM_AUTO_MODEL"
                    if automatic_language
                    else "LARKUP_VIDEO_DEEPGRAM_MODEL"
                ),
                "nova-3",
            ).strip()
            or "nova-3"
        )
        params: list[tuple[str, str]] = [
            ("model", model),
            ("smart_format", "true"),
            ("punctuate", "true"),
            ("utterances", "true"),
        ]
        if not automatic_language:
            params.append(("language", language_hint))
        else:
            # Nova-3's multilingual route recognizes code-switching and RTL
            # languages in one pass. Generic language detection can select a
            # single wrong model from noisy music, crowds, or commentary.
            params.append(("language", "multi"))
        for hint in (hints or [])[:100] if model.startswith("nova-3") else []:
            normalized = hint.strip()
            if normalized:
                # Nova-3 keyterms improve transcription of people,
                # organizations, products, and other proper nouns without
                # changing the meaning of the audio or relying on a scenario.
                params.append(("keyterm", normalized[:200]))
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        timeout_secs = max(
            30,
            min(
                900,
                int(
                    os.getenv(
                        "LARKUP_VIDEO_TRANSCRIPTION_REQUEST_TIMEOUT_SECONDS", "60"
                    )
                ),
            ),
        )
        with path.open("rb") as source:
            response = requests.post(
                DEEPGRAM_URL,
                params=params,
                # Deepgram's pre-recorded endpoint uses the media Content-Type
                # to decode local containers accurately; omitting it makes
                # video speech recognition materially less reliable.
                headers={
                    "Authorization": f"Token {api_key}",
                    "Content-Type": media_type,
                },
                data=source,
                timeout=timeout_secs,
            )
        if not response.ok:
            raise RuntimeError(
                f"Deepgram request failed {response.status_code}: {response.text[:500]}"
            )
        body = response.json()
        results = body.get("results") or {}
        channels = results.get("channels") or [{}]
        detected_language = channels[0].get("detected_language") if channels else None
        segments = _deepgram_segments(results)
        return segments, detected_language or (
            language_hint if language_hint != "auto" else None
        )


class OpenAICompatibleProvider(TranscriptionProvider):
    """Timestamped transcription through OpenAI or Groq's compatible API."""

    def __init__(self, provider: str) -> None:
        self.provider = provider

    def transcribe(
        self, path: Path, language_hint: str | None, hints: list[str] | None = None
    ) -> tuple[list[dict[str, Any]], str | None]:
        is_groq = self.provider == "groq"
        api_key = os.getenv("GROQ_API_KEY" if is_groq else "OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(f"{self.provider.upper()}_API_KEY is not configured")
        model = os.getenv(
            (
                "LARKUP_VIDEO_GROQ_TRANSCRIPTION_MODEL"
                if is_groq
                else "LARKUP_VIDEO_OPENAI_TRANSCRIPTION_MODEL"
            ),
            "whisper-large-v3-turbo" if is_groq else "whisper-1",
        )
        data: list[tuple[str, str]] = [
            ("model", model),
            ("response_format", "verbose_json"),
            ("timestamp_granularities[]", "segment"),
            ("timestamp_granularities[]", "word"),
        ]
        if language_hint and language_hint != "auto":
            data.append(("language", language_hint))
        prompt = ", ".join(hint.strip() for hint in (hints or []) if hint.strip())[:900]
        if prompt:
            data.append(("prompt", prompt))
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        with path.open("rb") as source:
            response = requests.post(
                GROQ_TRANSCRIPT_URL if is_groq else OPENAI_TRANSCRIPT_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files={"file": (path.name, source, media_type)},
                timeout=900,
            )
        if not response.ok:
            raise RuntimeError(
                f"{self.provider} transcription failed {response.status_code}: {response.text[:500]}"
            )
        body = response.json()
        segments = [
            {
                "startMs": round(float(segment.get("start", 0)) * 1_000),
                "endMs": round(float(segment.get("end", 0)) * 1_000),
                "text": str(segment.get("text") or "").strip(),
                "words": [
                    {
                        "startMs": round(float(word.get("start", 0)) * 1_000),
                        "endMs": round(float(word.get("end", 0)) * 1_000),
                        "text": str(word.get("word") or word.get("text") or "").strip(),
                        "confidence": 0.8,
                    }
                    for word in body.get("words") or []
                    if float(segment.get("start", 0))
                    <= float(word.get("start", 0))
                    <= float(segment.get("end", 0))
                ],
            }
            for segment in body.get("segments") or []
            if str(segment.get("text") or "").strip()
        ]
        return segments, body.get("language") or (
            language_hint if language_hint != "auto" else None
        )


class ElevenLabsProvider(TranscriptionProvider):
    def transcribe(
        self, path: Path, language_hint: str | None, hints: list[str] | None = None
    ) -> tuple[list[dict[str, Any]], str | None]:
        api_key = os.getenv("ELEVENLABS_API_KEY")
        if not api_key:
            raise RuntimeError("ELEVENLABS_API_KEY is not configured")
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        data = {
            "model_id": os.getenv(
                "LARKUP_VIDEO_ELEVENLABS_TRANSCRIPTION_MODEL", "scribe_v2"
            )
        }
        if language_hint and language_hint != "auto":
            data["language_code"] = language_hint
        with path.open("rb") as source:
            response = requests.post(
                ELEVENLABS_TRANSCRIPT_URL,
                headers={"xi-api-key": api_key},
                data=data,
                files={"file": (path.name, source, media_type)},
                timeout=900,
            )
        if not response.ok:
            raise RuntimeError(
                f"ElevenLabs transcription failed {response.status_code}: {response.text[:500]}"
            )
        body = response.json()
        words = [
            word
            for word in body.get("words") or []
            if str(word.get("text") or "").strip()
        ]
        segments = [
            {
                "startMs": round(float(word.get("start", 0)) * 1_000),
                "endMs": round(float(word.get("end", 0)) * 1_000),
                "text": str(word.get("text") or "").strip(),
                "words": [
                    {
                        "startMs": round(float(word.get("start", 0)) * 1_000),
                        "endMs": round(float(word.get("end", 0)) * 1_000),
                        "text": str(word.get("text") or "").strip(),
                        "confidence": float(word.get("logprob", 0.8)),
                    }
                ],
            }
            for word in words
            if str(word.get("type") or "word") == "word"
        ]
        return segments, body.get("language_code") or (
            language_hint if language_hint != "auto" else None
        )


class TranscriptionService:
    def __init__(self, device: str) -> None:
        self._factories: dict[str, Any] = {
            "whisper": lambda: WhisperProvider(device),
            "deepgram": DeepgramProvider,
            "openai": lambda: OpenAICompatibleProvider("openai"),
            "groq": lambda: OpenAICompatibleProvider("groq"),
            "elevenlabs": ElevenLabsProvider,
        }
        self._providers: dict[str, TranscriptionProvider] = {}
        self.last_diagnostics: dict[str, Any] = {
            "provider": None,
            "fallbackProvider": None,
            "fallbackUsed": False,
            "chunkCount": 0,
            "chunkErrors": 0,
        }

    def _get_provider(self, name: str) -> TranscriptionProvider:
        if name not in self._providers:
            factory = self._factories.get(name)
            if factory is None:
                raise ValueError(f"unknown transcription provider: {name!r}")
            self._providers[name] = factory()
        return self._providers[name]

    def transcribe(
        self,
        path: Path,
        language_hint: str | None,
        hints: list[str] | None = None,
        source_duration_secs: float | None = None,
        progress: TranscriptionProgress | None = None,
    ) -> tuple[list[dict[str, Any]], str | None]:
        primary_name = os.getenv(
            "LARKUP_VIDEO_TRANSCRIPTION_PROVIDER", "whisper"
        ).strip()
        fallback_name = os.getenv(
            "LARKUP_VIDEO_TRANSCRIPTION_FALLBACK",
            "whisper" if primary_name != "whisper" else "",
        ).strip()
        self.last_diagnostics = {
            "provider": primary_name,
            "fallbackProvider": None,
            "fallbackUsed": False,
            "chunkCount": 0,
            "completedChunks": 0,
            "chunkErrors": 0,
        }
        primary_error: BaseException | None = None
        try:
            segments, language = self._transcribe_primary(
                primary_name,
                path,
                language_hint,
                hints,
                source_duration_secs,
                progress,
            )
            if segments:
                return segments, language
            primary_error = EmptyTranscriptionError(
                f"{primary_name} returned no usable speech segments"
            )
        except BaseException as error:
            primary_error = error

        if fallback_name and fallback_name != primary_name:
            try:
                self.last_diagnostics["fallbackProvider"] = fallback_name
                self.last_diagnostics["fallbackUsed"] = True
                if progress:
                    progress(0, 1)
                segments, language = self._get_provider(fallback_name).transcribe(
                    path, language_hint, hints
                )
                if segments:
                    self.last_diagnostics["completedChunks"] = 1
                    if progress:
                        progress(1, 1)
                    return segments, language
                raise EmptyTranscriptionError(
                    f"{fallback_name} returned no usable speech segments"
                )
            except BaseException as fallback_error:
                raise RuntimeError(
                    f"primary transcription failed ({type(primary_error).__name__}: "
                    f"{primary_error}); fallback failed ({type(fallback_error).__name__}: "
                    f"{fallback_error})"
                ) from fallback_error

        assert primary_error is not None
        raise primary_error

    def _transcribe_primary(
        self,
        provider_name: str,
        path: Path,
        language_hint: str | None,
        hints: list[str] | None,
        source_duration_secs: float | None,
        progress: TranscriptionProgress | None,
    ) -> tuple[list[dict[str, Any]], str | None]:
        provider = self._get_provider(provider_name)
        chunk_secs = max(
            30,
            min(900, int(os.getenv("LARKUP_VIDEO_TRANSCRIPTION_CHUNK_SECONDS", "180"))),
        )
        duration_secs = max(0.0, float(source_duration_secs or 0))
        if provider_name == "whisper" or duration_secs <= chunk_secs:
            self.last_diagnostics["chunkCount"] = 1
            if progress:
                progress(0, 1)
            result = provider.transcribe(path, language_hint, hints)
            self.last_diagnostics["completedChunks"] = 1
            if progress:
                progress(1, 1)
            return result

        concurrency = max(
            1,
            min(8, int(os.getenv("LARKUP_VIDEO_TRANSCRIPTION_CONCURRENCY", "3"))),
        )
        with tempfile.TemporaryDirectory(prefix="larkup-speech-chunks-") as temporary:
            chunks = _materialize_hosted_audio_chunks(
                path, duration_secs, chunk_secs, Path(temporary)
            )
            self.last_diagnostics["chunkCount"] = len(chunks)
            if progress:
                progress(0, len(chunks))
            completed: list[tuple[float, list[dict[str, Any]], str | None]] = []
            errors: list[BaseException] = []
            processed_chunks = 0
            with ThreadPoolExecutor(max_workers=min(concurrency, len(chunks))) as pool:
                futures = {
                    pool.submit(
                        provider.transcribe, chunk, language_hint, hints
                    ): offset
                    for offset, chunk in chunks
                }
                for future in as_completed(futures):
                    try:
                        segments, language = future.result()
                        completed.append((futures[future], segments, language))
                    except BaseException as error:
                        errors.append(error)
                    finally:
                        processed_chunks += 1
                        self.last_diagnostics["completedChunks"] = processed_chunks
                        if progress:
                            progress(processed_chunks, len(chunks))
            self.last_diagnostics["chunkErrors"] = len(errors)
            minimum_successes = max(1, round(len(chunks) * 0.8))
            if len(completed) < minimum_successes:
                detail = errors[0] if errors else "no chunk completed"
                raise RuntimeError(
                    f"hosted transcription completed {len(completed)}/{len(chunks)} chunks: {detail}"
                )
            merged = [
                segment
                for offset, segments, _language in sorted(completed)
                for segment in _rebase_segments(segments, offset)
            ]
            languages = Counter(
                language for _offset, _segments, language in completed if language
            )
            detected = languages.most_common(1)[0][0] if languages else None
            return merged, detected or (
                language_hint if language_hint != "auto" else None
            )
