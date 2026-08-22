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
    admin_token: str | None
    workers: int
    device: str
    allow_local_paths: bool
    max_upload_bytes: int
    disable_heavy_operators: bool
    semantic_vision_enabled: bool
    semantic_vision_model: str
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
            semantic_vision_model=os.getenv(
                "LARKUP_VIDEO_SEMANTIC_VISION_MODEL", "Qwen/Qwen2.5-VL-3B-Instruct"
            ),
            allowed_origins=tuple(
                origin.strip()
                for origin in os.getenv(
                    "LARKUP_VIDEO_ALLOWED_ORIGINS", "http://localhost:3000"
                ).split(",")
                if origin.strip()
            ),
        )
