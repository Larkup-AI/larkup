FROM python:3.12-slim AS smoke

WORKDIR /service
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY runtime/requirements-smoke.txt ./requirements-smoke.txt
RUN python3 -m pip install --no-cache-dir -r requirements-smoke.txt
COPY runtime/app ./app
ENV PYTHONUNBUFFERED=1 \
    LARKUP_VIDEO_DATA_DIR=/data \
    LARKUP_VIDEO_MODEL_DIR=/models \
    LARKUP_VIDEO_DEVICE=cpu \
    LARKUP_VIDEO_DISABLE_HEAVY_OPERATORS=true
EXPOSE 8787
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]

FROM python:3.12-slim AS cpu

ARG YOLOX_MODEL_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx

WORKDIR /service
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY runtime/requirements-cpu.txt ./requirements-cpu.txt
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir -r requirements-cpu.txt \
    && python3 -m pip install --no-cache-dir --no-deps rapidocr-onnxruntime==1.4.4
RUN mkdir -p /models /data \
    && python3 -c "import urllib.request; urllib.request.urlretrieve('$YOLOX_MODEL_URL', '/models/yolox_s.onnx')"
COPY runtime/app ./app
ENV PYTHONUNBUFFERED=1 \
    LARKUP_VIDEO_DATA_DIR=/data \
    LARKUP_VIDEO_MODEL_DIR=/models \
    LARKUP_VIDEO_DEVICE=cpu \
    LARKUP_VIDEO_OCR_ENGINE=RapidOCR
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/v1/health', timeout=4)" || exit 1
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]

# Blackwell workers require a CUDA 12.8-compatible runtime for onnxruntime-gpu
# (YOLOX detection) and PaddleOCR. Vision captioning and video embeddings
# are both HTTPS calls from app/services/ -- this image only ever runs
# local decode/detect/OCR/transcribe.
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04 AS system

ARG DEBIAN_FRONTEND=noninteractive
ARG YOLOX_MODEL_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx

RUN apt-get update \
    && apt-get dist-upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg libgomp1 python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /service

FROM system AS runtime
COPY runtime/requirements.txt ./requirements.txt
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir paddlepaddle==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/ \
    && python3 -m pip install --no-cache-dir -r requirements.txt

RUN mkdir -p /models /data \
    && curl --fail --location --retry 4 "$YOLOX_MODEL_URL" --output /models/yolox_s.onnx

COPY runtime/app ./app

ENV PYTHONUNBUFFERED=1 \
    LARKUP_VIDEO_DATA_DIR=/data \
    LARKUP_VIDEO_MODEL_DIR=/models \
    LARKUP_VIDEO_DEVICE=auto \
    LARKUP_VIDEO_SEMANTIC_VISION=true \
    LARKUP_VIDEO_SEMANTIC_VISION_MODEL=google/gemini-3.6-flash \
    LARKUP_VIDEO_EMBEDDING_PROVIDER=disabled \
    LARKUP_VIDEO_EMBEDDING_FALLBACK_PROVIDER=disabled \
    LARKUP_VIDEO_TRANSCRIPTION_PROVIDER="" \
    LARKUP_VIDEO_TRANSCRIPTION_FALLBACK="" \
    LARKUP_VIDEO_TRANSCRIPTION_CHUNK_SECONDS=300 \
    LARKUP_VIDEO_TRANSCRIPTION_CONCURRENCY=6 \
    LARKUP_VIDEO_TRANSCRIPTION_REQUEST_TIMEOUT_SECONDS=120 \
    LARKUP_VIDEO_REQUIRE_AUTH=false

EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD curl -fsS http://127.0.0.1:8787/v1/health || exit 1
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]

FROM runtime AS runpod

# The RunPod entrypoint is deliberately kept out of runtime/app (and out of
# the published npm package) -- see deploy/gpu_providers/README.md. It still
# has to land inside the `app` package here because its imports and the
# `python -m app.runpod_worker` entrypoint below both assume that. Only this
# stage needs it: a local (non-RunPod) `runtime`-target build never imports it.
COPY deploy/gpu_providers/runpod_worker_entrypoint.py ./app/runpod_worker.py
COPY deploy/gpu_providers/remote_source.py ./app/remote_source.py
COPY deploy/gpu_providers/progress.py ./app/progress.py

# Fail the image build if the exact RunPod entrypoint cannot import. This
# catches native-library and Python dependency failures before a worker is
# scheduled, where logs are much harder to recover.
RUN python3 -c "import cv2, runpod; from app.runpod_worker import handler; assert callable(handler)"

# This stage is the immutable serverless image. Do not rely on a template
# command override: it must start the worker even when deployed as-is.
HEALTHCHECK NONE
CMD ["python3", "-m", "app.runpod_worker"]

FROM runtime AS cloud-worker

# Shared image for the "rent-a-VM" providers (vast, shadeform, salad,
# scaleway, thundercompute, gpuai, northflank, hyperstack): each just starts
# this image with job-specific env vars, see deploy/gpu_providers/base.py.
COPY deploy/gpu_providers/cloud_worker_entrypoint.py ./app/cloud_worker.py

RUN python3 -c "import boto3; from app.cloud_worker import main; assert callable(main)"

HEALTHCHECK NONE
CMD ["python3", "-m", "app.cloud_worker"]
