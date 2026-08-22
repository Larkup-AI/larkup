from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import requests
import runpod

from .config import Settings
from .pipeline import run_pipeline
from .schemas import VideoIndexingBrief


def handler(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("input") or {}
    source_url = str(payload.get("sourceUrl") or "")
    if not source_url.startswith("https://"):
        raise ValueError("sourceUrl must be an HTTPS signed URL")
    brief = VideoIndexingBrief.model_validate(payload.get("brief") or {})
    settings = Settings.from_env()
    with tempfile.TemporaryDirectory(prefix="larkup-runpod-video-") as temporary:
        source_path = Path(temporary) / "source"
        response = requests.get(source_url, stream=True, timeout=(10, 300))
        response.raise_for_status()
        with source_path.open("wb") as destination:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    destination.write(chunk)
        result, actual_minutes = run_pipeline(
            source_path,
            brief.model_dump(by_alias=True),
            settings.model_dir,
            settings.device,
            lambda *_: None,
            settings.disable_heavy_operators,
            settings.semantic_vision_enabled,
            settings.semantic_vision_model,
        )
    return {"result": result, "actualSourceMinutes": actual_minutes}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
