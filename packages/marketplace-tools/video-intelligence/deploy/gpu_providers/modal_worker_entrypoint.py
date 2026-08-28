"""Modal worker entrypoint -- deployed separately with `modal deploy`.

Unlike RunPod's image-baked worker (built into the shared Dockerfile), a
Modal Function is deployed straight from this file. This has been deployed
for real (real `modal deploy`, real image build, real YOLOX weight download
inside the build) with this exact command -- module mode, not a plain
script path, because this file (like remote_source.py) uses a top-level
relative import:

    cd packages/marketplace-tools/video-intelligence
    modal deploy -m deploy.gpu_providers.modal_worker_entrypoint

That builds WORKER_IMAGE below and registers `process_video_job` under
APP_NAME, which modal_provider.ModalProvider looks up by default
(LARKUP_VIDEO_MODAL_APP / LARKUP_VIDEO_MODAL_FUNCTION override both if you
deploy under different names). Same shared `runtime/app` pipeline as every
other provider -- this only adds the Modal-specific glue around it.

Image build and function registration are now real-deploy-verified. A real
end-to-end job run (submit through modal_provider.ModalProvider, poll to
completion) is still the next verification step, not yet done.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import modal

from .remote_source import extract_bounded_remote_clip, materialize_remote_source

APP_NAME = "larkup-video-intelligence"
FUNCTION_NAME = "process_video_job"
YOLOX_MODEL_URL = (
    "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx"
)

WORKER_IMAGE = (
    modal.Image.from_registry("nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04", add_python="3.12")
    .apt_install("ffmpeg", "libgomp1", "curl", "ca-certificates")
    .run_commands(
        "python3 -m pip install --no-cache-dir --upgrade pip",
        "python3 -m pip install --no-cache-dir paddlepaddle==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/",
    )
    .pip_install_from_requirements("runtime/requirements.txt")
    .run_commands(
        "mkdir -p /models /data",
        f"curl --fail --location --retry 4 {YOLOX_MODEL_URL} --output /models/yolox_s.onnx",
    )
    .add_local_dir("runtime/app", remote_path="/service/app")
)

app = modal.App(APP_NAME)


@app.function(
    image=WORKER_IMAGE,
    gpu="A10G",
    timeout=6 * 60 * 60,
    secrets=[modal.Secret.from_name("larkup-video-intelligence")],
)
def process_video_job(payload: dict[str, Any]) -> dict[str, Any]:
    import sys

    sys.path.insert(0, "/service")
    from app.config import Settings
    from app.db.schemas import VideoIndexingBrief
    from app.services.pipeline import run_pipeline
    from app.utils.timing import normalized_important_ranges

    source_url = str(payload.get("sourceUrl") or "")
    if not source_url.startswith("https://"):
        raise ValueError("sourceUrl must be an HTTPS signed URL")
    brief = VideoIndexingBrief.model_validate(payload.get("brief") or {})
    source_duration_secs = float(payload.get("sourceDurationSecs") or 0)
    settings = Settings.from_env()
    with tempfile.TemporaryDirectory(prefix="larkup-modal-video-") as temporary:
        source_path = Path(temporary) / "source.mp4"
        important_ranges = normalized_important_ranges(
            brief.model_dump(by_alias=True), source_duration_secs
        )
        timestamp_offset_secs = 0.0
        analysis_brief = brief.model_dump(by_alias=True)
        if len(important_ranges) == 1:
            timestamp_offset_secs, end_secs = important_ranges[0]
            extract_bounded_remote_clip(source_url, source_path, timestamp_offset_secs, end_secs)
            analysis_brief["importantRanges"] = []
        else:
            materialize_remote_source(source_url, source_path)
        result, actual_minutes = run_pipeline(
            source_path,
            analysis_brief,
            settings.model_dir,
            settings.device,
            lambda stage, percent, message: None,
            settings.disable_heavy_operators,
            True,
            settings.semantic_vision_model,
            timestamp_offset_secs=timestamp_offset_secs,
            source_duration_secs=source_duration_secs or None,
        )
        result["brief"] = brief.model_dump(by_alias=True)
    return {"result": result, "actualSourceMinutes": actual_minutes}
