from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    model_dir: Path
    require_auth: bool
    shared_api_key: str | None
    admin_token: str | None
    workers: int
    device: str
    allow_local_paths: bool
    max_upload_bytes: int
    disable_heavy_operators: bool
    semantic_vision_enabled: bool
    semantic_vision_model: str
    reasoning_vision_model: str
    agent_enabled: bool
    agent_provider: str
    agent_model: str
    allowed_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        data_dir = Path(os.getenv("LARKUP_VIDEO_DATA_DIR", "/data")).resolve()
        model_dir = Path(os.getenv("LARKUP_VIDEO_MODEL_DIR", "/models")).resolve()
        data_dir.mkdir(parents=True, exist_ok=True)
        model_dir.mkdir(parents=True, exist_ok=True)
        return cls(
            data_dir=data_dir,
            model_dir=model_dir,
            require_auth=_bool("LARKUP_VIDEO_REQUIRE_AUTH", False),
            shared_api_key=os.getenv("LARKUP_VIDEO_SHARED_API_KEY") or None,
            admin_token=os.getenv("LARKUP_VIDEO_ADMIN_TOKEN") or None,
            workers=max(1, min(8, int(os.getenv("LARKUP_VIDEO_WORKERS", "1")))),
            device=os.getenv("LARKUP_VIDEO_DEVICE", "auto"),
            allow_local_paths=_bool("LARKUP_VIDEO_ALLOW_LOCAL_PATHS", False),
            max_upload_bytes=max(
                1,
                int(os.getenv("LARKUP_VIDEO_MAX_UPLOAD_BYTES", str(20 * 1024**3))),
            ),
            disable_heavy_operators=_bool("LARKUP_VIDEO_DISABLE_HEAVY_OPERATORS", False),
            semantic_vision_enabled=_bool("LARKUP_VIDEO_SEMANTIC_VISION", True),
            # Vercel AI Gateway model ids, not local HuggingFace paths -- both
            # run entirely through gateway_vision.GatewayVisionClient, which
            # reads these same env vars itself. Kept here too so /v1/health
            # can report them. The bulk model captions every clip cheaply;
            # the reasoning model is reserved for watch_original's final
            # dense-verification pass, where accuracy matters more than cost.
            semantic_vision_model=os.getenv(
                "LARKUP_VIDEO_SEMANTIC_VISION_MODEL", "google/gemini-3.6-flash"
            ),
            reasoning_vision_model=os.getenv(
                "LARKUP_VIDEO_REASONING_VISION_MODEL", "google/gemini-3.6-flash"
            ),
            agent_enabled=_bool("LARKUP_VIDEO_AGENT_ENABLED", True),
            agent_provider=os.getenv("LARKUP_VIDEO_AGENT_PROVIDER", "vercel_ai_gateway"),
            agent_model=os.getenv("LARKUP_VIDEO_AGENT_MODEL", "openai/gpt-5-mini"),
            allowed_origins=tuple(
                origin.strip()
                for origin in os.getenv(
                    "LARKUP_VIDEO_ALLOWED_ORIGINS", "http://localhost:3000"
                ).split(",")
                if origin.strip()
            ),
        )
