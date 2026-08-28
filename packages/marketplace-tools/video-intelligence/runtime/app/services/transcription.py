"""Speech-to-text, behind a provider so a deploy target can pick the cheapest
or fastest option available to it without the pipeline caring which one runs.

`whisper` decodes locally (faster-whisper); `deepgram` is a hosted API call,
used by the managed-cloud image so its GPU worker never loads Whisper.
"""

from __future__ import annotations

import os
import threading
import mimetypes
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import requests

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"


class TranscriptionProvider(ABC):
    @abstractmethod
    def transcribe(
        self, path: Path, language_hint: str | None, hints: list[str] | None = None
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Returns (segments, detected_language). Each segment has startMs/endMs/text/words."""


class WhisperProvider(TranscriptionProvider):
    def __init__(self, device: str) -> None:
        self.device = device
        self._lock = threading.Lock()
        self._model: Any = None

    def transcribe(
        self, path: Path, language_hint: str | None, hints: list[str] | None = None
    ) -> tuple[list[dict[str, Any]], str | None]:
        with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                model_name = os.getenv("LARKUP_VIDEO_WHISPER_MODEL", "small")
                compute_type = "float16" if self.device == "cuda" else "int8"
                self._model = WhisperModel(model_name, device=self.device, compute_type=compute_type)
            segments, info = self._model.transcribe(
                str(path),
                language=language_hint,
                vad_filter=True,
                word_timestamps=True,
                beam_size=5,
            )
            result = [
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
            ]
        return result, getattr(info, "language", None)


class DeepgramProvider(TranscriptionProvider):
    def transcribe(
        self, path: Path, language_hint: str | None, hints: list[str] | None = None
    ) -> tuple[list[dict[str, Any]], str | None]:
        api_key = os.getenv("DEEPGRAM_API_KEY")
        if not api_key:
            raise RuntimeError("DEEPGRAM_API_KEY is not configured")
        params: list[tuple[str, str]] = [
            # Nova-3 is the current multilingual general model. Nova-2 does
            # not support every language accepted by this service (including
            # Arabic), which otherwise makes a video job fail before its
            # timestamped speech evidence can be indexed.
            ("model", os.getenv("LARKUP_VIDEO_DEEPGRAM_MODEL", "nova-3")),
            ("smart_format", "true"),
            ("punctuate", "true"),
            ("utterances", "true"),
        ]
        if language_hint and language_hint != "auto":
            params.append(("language", language_hint))
        else:
            params.append(("detect_language", "true"))
        for hint in (hints or [])[:100]:
            normalized = hint.strip()
            if normalized:
                # Nova-3 keyterms improve transcription of people, teams,
                # products, and other question-specific proper nouns without
                # changing the meaning of the audio or relying on a scenario.
                params.append(("keyterm", normalized[:200]))
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        with path.open("rb") as source:
            response = requests.post(
                DEEPGRAM_URL,
                params=params,
                # Deepgram's pre-recorded endpoint uses the media Content-Type
                # to decode local containers accurately; omitting it makes
                # video speech recognition materially less reliable.
                headers={"Authorization": f"Token {api_key}", "Content-Type": media_type},
                data=source,
                timeout=900,
            )
        if not response.ok:
            raise RuntimeError(f"Deepgram request failed {response.status_code}: {response.text[:500]}")
        body = response.json()
        results = body.get("results") or {}
        channels = results.get("channels") or [{}]
        detected_language = channels[0].get("detected_language") if channels else None
        segments = [
            {
                "startMs": round(float(utterance.get("start", 0)) * 1_000),
                "endMs": round(float(utterance.get("end", 0)) * 1_000),
                "text": str(utterance.get("transcript") or "").strip(),
                "words": [
                    {
                        "startMs": round(float(word.get("start", 0)) * 1_000),
                        "endMs": round(float(word.get("end", 0)) * 1_000),
                        "text": str(word.get("punctuated_word") or word.get("word") or "").strip(),
                        "confidence": round(float(word.get("confidence", 0)), 4),
                    }
                    for word in utterance.get("words") or []
                ],
            }
            for utterance in results.get("utterances") or []
            if str(utterance.get("transcript") or "").strip()
        ]
        return segments, detected_language or (language_hint if language_hint != "auto" else None)


class TranscriptionService:
    def __init__(self, device: str) -> None:
        self._factories: dict[str, Any] = {
            "whisper": lambda: WhisperProvider(device),
            "deepgram": DeepgramProvider,
        }
        self._provider: TranscriptionProvider | None = None

    def _get_provider(self) -> TranscriptionProvider:
        if self._provider is None:
            name = os.getenv("LARKUP_VIDEO_TRANSCRIPTION_PROVIDER", "whisper")
            factory = self._factories.get(name)
            if factory is None:
                raise ValueError(f"unknown transcription provider: {name!r}")
            self._provider = factory()
        return self._provider

    def transcribe(
        self, path: Path, language_hint: str | None, hints: list[str] | None = None
    ) -> tuple[list[dict[str, Any]], str | None]:
        return self._get_provider().transcribe(path, language_hint, hints)
