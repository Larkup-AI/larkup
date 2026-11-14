#!/usr/bin/env bash
set -euo pipefail
umask 077
repo="${1:?Repository snapshot path required}"
bench="$repo/packages/marketplace-tools/video-intelligence/benchmarks"
cd "$bench"
mkdir -p data/deployment
exec 9>data/deployment/bootstrap.lock
flock -n 9 || exit 0
if [[ ! -f data/deployment/bootstrap.done ]]; then
  apt-get update -qq
  apt-get install -y -qq ffmpeg espeak curl xz-utils libgomp1 >data/deployment/apt.log 2>&1
  if ! command -v uv >/dev/null; then
    curl -fsSL https://astral.sh/uv/install.sh | sh >data/deployment/uv-install.log 2>&1
  fi
  export PATH="/root/.local/bin:$PATH"
  if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]]; then
    curl -fsSL https://nodejs.org/dist/v22.23.0/node-v22.23.0-linux-x64.tar.xz -o data/deployment/node.tar.xz
    mkdir -p /opt/benchmark-node
    tar -xJf data/deployment/node.tar.xz --strip-components=1 -C /opt/benchmark-node
    ln -sf /opt/benchmark-node/bin/node /usr/local/bin/node
    ln -sf /opt/benchmark-node/bin/npm /usr/local/bin/npm
  fi
  export PATH="/root/.local/bin:/opt/benchmark-node/bin:$PATH"
  if ! command -v pnpm >/dev/null; then npm install -g pnpm@10.11.0 >data/deployment/pnpm-install.log 2>&1; fi
  if [[ ! -x "$bench/data/deployment/venv/bin/python" ]]; then uv venv --python 3.12 "$bench/data/deployment/venv"; fi
  uv pip install --python "$bench/data/deployment/venv/bin/python" -e "$repo/packages/marketplace-tools/video-intelligence/runtime[cpu]" >data/deployment/runtime-install.log 2>&1
  uv pip install --python "$bench/data/deployment/venv/bin/python" onnxruntime-gpu==1.22.0 onnx >data/deployment/gpu-install.log 2>&1
  mkdir -p data/models
  if [[ ! -f data/models/yolox_s.onnx ]]; then
    curl -fsSL https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx -o data/models/yolox_s.onnx
  fi
  cd "$repo"
  pnpm install --filter @larkup/core... --filter @larkup/marketplace --filter @larkup/tool-video-intelligence --frozen-lockfile --ignore-scripts >"$bench/data/deployment/node-install.log" 2>&1
  cd "$bench"
  date -u +%FT%TZ >data/deployment/bootstrap.done
fi
export PATH="/root/.local/bin:/opt/benchmark-node/bin:$PATH"
task_cuda_libraries="$(python3 -c 'import glob; print(":".join(glob.glob("/usr/local/lib/python*/site-packages/nvidia/*/lib")+glob.glob("/usr/local/lib/python*/dist-packages/nvidia/*/lib")+glob.glob("/opt/venv/lib/python*/site-packages/nvidia/*/lib")+glob.glob("/usr/local/cuda*/lib64")))')"
export LD_LIBRARY_PATH="$task_cuda_libraries:${LD_LIBRARY_PATH:-}"
exec data/deployment/venv/bin/python -m harness.remote_runtime
