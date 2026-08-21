FROM python:3.12-slim AS smoke

WORKDIR /service
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-smoke.txt ./requirements-smoke.txt
RUN python3 -m pip install --no-cache-dir -r requirements-smoke.txt
COPY app ./app
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
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-cpu.txt ./requirements-cpu.txt
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir -r requirements-cpu.txt \
    && python3 -m pip install --no-cache-dir --no-deps rapidocr-onnxruntime==1.4.4
RUN mkdir -p /models /data \
    && python3 -c "import urllib.request; urllib.request.urlretrieve('$YOLOX_MODEL_URL', '/models/yolox_s.onnx')"
COPY app ./app
ENV PYTHONUNBUFFERED=1 \
    LARKUP_VIDEO_DATA_DIR=/data \
    LARKUP_VIDEO_MODEL_DIR=/models \
    LARKUP_VIDEO_DEVICE=cpu \
    LARKUP_VIDEO_OCR_ENGINE=RapidOCR
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/v1/health', timeout=4)" || exit 1
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]

FROM nvidia/cuda:12.3.2-cudnn9-runtime-ubuntu22.04 AS system

ARG DEBIAN_FRONTEND=noninteractive
ARG YOLOX_MODEL_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx

RUN apt-get update \
    && apt-get dist-upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /service

FROM system AS runtime
COPY requirements.txt ./requirements.txt
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir paddlepaddle==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/ \
    && python3 -m pip install --no-cache-dir -r requirements.txt

RUN mkdir -p /models /data \
    && curl --fail --location --retry 4 "$YOLOX_MODEL_URL" --output /models/yolox_s.onnx

COPY app ./app

ENV PYTHONUNBUFFERED=1 \
    LARKUP_VIDEO_DATA_DIR=/data \
    LARKUP_VIDEO_MODEL_DIR=/models \
    LARKUP_VIDEO_DEVICE=auto \
    LARKUP_VIDEO_REQUIRE_AUTH=false

EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD curl -fsS http://127.0.0.1:8787/v1/health || exit 1
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
