"""Job-scoped user model credentials shared by cloud worker entrypoints."""

from __future__ import annotations

from contextlib import contextmanager
import os
import threading
from typing import Any, Iterator


_MANAGED_KEYS = (
    "LARKUP_VIDEO_AGENT_ENABLED",
    "LARKUP_VIDEO_AGENT_PROVIDER",
    "LARKUP_VIDEO_AGENT_API_KEY",
    "LARKUP_VIDEO_AGENT_MODEL",
    "LARKUP_VIDEO_PLANNER_MODEL",
    "LARKUP_VIDEO_SEMANTIC_VISION",
    "LARKUP_VIDEO_VISION_PROVIDER",
    "LARKUP_VIDEO_VISION_API_KEY",
    "LARKUP_VIDEO_SEMANTIC_VISION_MODEL",
    "LARKUP_VIDEO_REASONING_VISION_MODEL",
    "LARKUP_VIDEO_TRANSCRIPTION_PROVIDER",
    "LARKUP_VIDEO_TRANSCRIPTION_FALLBACK",
    "LARKUP_VIDEO_DEEPGRAM_MODEL",
    "LARKUP_VIDEO_DEEPGRAM_AUTO_MODEL",
    "LARKUP_VIDEO_OPENAI_TRANSCRIPTION_MODEL",
    "LARKUP_VIDEO_GROQ_TRANSCRIPTION_MODEL",
    "LARKUP_VIDEO_ELEVENLABS_TRANSCRIPTION_MODEL",
    "DEEPGRAM_API_KEY",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "ELEVENLABS_API_KEY",
    "AI_GATEWAY_API_KEY",
    "LARKUP_VIDEO_AGENT_BASE_URL",
    "LARKUP_VIDEO_VISION_BASE_URL",
    "LARKUP_VIDEO_GEMINI_BASE_URL",
    "LARKUP_VIDEO_EMBEDDING_PROVIDER",
    "LARKUP_VIDEO_EMBEDDING_FALLBACK_PROVIDER",
    "LARKUP_VIDEO_GOOGLE_API_KEY",
    "LARKUP_VIDEO_GOOGLE_FALLBACK_API_KEY",
)
_ENVIRONMENT_LOCK = threading.RLock()


@contextmanager
def temporary_model_environment(payload: dict[str, Any]) -> Iterator[None]:
    """Apply one job's BYOK bundle and restore a warm worker after completion."""
    models = payload.get("modelConfiguration")
    if not isinstance(models, dict):
        raise ValueError(
            "Audio, agent / tool-brain, and vision provider settings are required"
        )
    parsed = {
        role: _model(models.get(role), role)
        for role in ("audio", "brain", "vision")
    }
    with _ENVIRONMENT_LOCK:
        previous = {key: os.environ.get(key) for key in _MANAGED_KEYS}
        try:
            for key in _MANAGED_KEYS:
                os.environ.pop(key, None)

            vision = parsed["vision"]
            os.environ.update(
                {
                    "LARKUP_VIDEO_SEMANTIC_VISION": "true",
                    "LARKUP_VIDEO_VISION_PROVIDER": vision["provider"],
                    "LARKUP_VIDEO_VISION_API_KEY": vision["apiKey"],
                    "LARKUP_VIDEO_SEMANTIC_VISION_MODEL": vision["model"],
                    "LARKUP_VIDEO_REASONING_VISION_MODEL": vision["model"],
                }
            )
            if vision["provider"] == "vercel_ai_gateway":
                os.environ["AI_GATEWAY_API_KEY"] = vision["apiKey"]

            brain = parsed["brain"]
            brain_base_url = {
                "anthropic": "https://api.anthropic.com/v1",
                "cohere": "https://api.cohere.ai/compatibility/v1",
                "deepseek": "https://api.deepseek.com",
                "google": "https://generativelanguage.googleapis.com/v1beta",
                "mistral": "https://api.mistral.ai/v1",
                "openai": "https://api.openai.com/v1",
                "vercel_ai_gateway": "https://ai-gateway.vercel.sh/v1",
            }[brain["provider"]]
            os.environ.update(
                {
                    "LARKUP_VIDEO_AGENT_ENABLED": "true",
                    "LARKUP_VIDEO_AGENT_PROVIDER": brain["provider"],
                    "LARKUP_VIDEO_AGENT_API_KEY": brain["apiKey"],
                    "LARKUP_VIDEO_AGENT_MODEL": brain["model"],
                    "LARKUP_VIDEO_PLANNER_MODEL": brain["model"],
                    "LARKUP_VIDEO_AGENT_BASE_URL": brain_base_url,
                }
            )

            os.environ["LARKUP_VIDEO_VISION_BASE_URL"] = (
                "https://api.openai.com/v1"
                if vision["provider"] == "openai"
                else "https://ai-gateway.vercel.sh/v1"
            )
            os.environ["LARKUP_VIDEO_GEMINI_BASE_URL"] = (
                "https://generativelanguage.googleapis.com/v1beta"
            )

            audio = parsed["audio"]
            os.environ["LARKUP_VIDEO_TRANSCRIPTION_PROVIDER"] = audio["provider"]
            # A managed worker must not silently spend Larkup GPU time on Whisper
            # after the user's paid provider rejects a request.
            os.environ["LARKUP_VIDEO_TRANSCRIPTION_FALLBACK"] = ""
            key_name, model_names = {
                "deepgram": (
                    "DEEPGRAM_API_KEY",
                    ("LARKUP_VIDEO_DEEPGRAM_MODEL", "LARKUP_VIDEO_DEEPGRAM_AUTO_MODEL"),
                ),
                "openai": ("OPENAI_API_KEY", ("LARKUP_VIDEO_OPENAI_TRANSCRIPTION_MODEL",)),
                "groq": ("GROQ_API_KEY", ("LARKUP_VIDEO_GROQ_TRANSCRIPTION_MODEL",)),
                "elevenlabs": (
                    "ELEVENLABS_API_KEY",
                    ("LARKUP_VIDEO_ELEVENLABS_TRANSCRIPTION_MODEL",),
                ),
            }[audio["provider"]]
            os.environ[key_name] = audio["apiKey"]
            for model_name in model_names:
                os.environ[model_name] = audio["model"]

            # Cloud vector generation is optional and must never fall through to
            # an operator-owned Gateway secret. Text evidence remains indexable.
            os.environ["LARKUP_VIDEO_EMBEDDING_PROVIDER"] = "disabled"
            os.environ["LARKUP_VIDEO_EMBEDDING_FALLBACK_PROVIDER"] = "disabled"
            yield
        finally:
            for key in _MANAGED_KEYS:
                value = previous[key]
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


@contextmanager
def unchanged_model_environment() -> Iterator[None]:
    """Keep process-scoped local settings isolated from transient remote jobs."""
    with _ENVIRONMENT_LOCK:
        yield


def _model(value: Any, role: str) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError(f"A configured {role} provider, model, and API key are required")
    result = {
        key: str(value.get(key) or "").strip()
        for key in ("provider", "apiKey", "model")
    }
    if not all(result.values()):
        raise ValueError(f"A configured {role} provider, model, and API key are required")
    return result
