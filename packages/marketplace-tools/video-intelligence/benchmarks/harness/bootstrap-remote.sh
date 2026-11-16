#!/usr/bin/env bash
set -euo pipefail
umask 077
repo="${1:?Repository snapshot path required}"
bench="$repo/packages/marketplace-tools/video-intelligence/benchmarks"
cd "$bench"
mkdir -p data/deployment
exec 9>data/deployment/bootstrap.lock
flock -n 9 || exit 0
rm -f data/deployment/bootstrap.failed
trap 'echo "$?" >"$bench/data/deployment/bootstrap.failed"' ERR
stage() { printf '%s\n' "$1"; printf '%s' "$1" >data/deployment/bootstrap-stage; }
# Tools and Python dependencies execute on the container SSD, avoiding slow volume metadata I/O.
tools_root="${BENCHMARK_TOOLS_ROOT:-/opt/larkup-benchmark-tools}"
node_root="${BENCHMARK_NODE_ROOT:-/opt/benchmark-node}"
python_env="${BENCHMARK_PYTHON_ENV:-/opt/larkup-benchmark-python}"
export PATH="$tools_root/bin:$node_root/bin:$PATH"
if ! command -v ffmpeg >/dev/null || ! command -v espeak >/dev/null; then
  stage 'Installing container system dependencies'
  apt-get update -qq
  apt-get install -y -qq ffmpeg espeak curl xz-utils libgomp1 >data/deployment/apt.log 2>&1
fi
if ! command -v uv >/dev/null; then
  stage 'Preparing Python tooling on the container SSD'
  curl -fsSL https://astral.sh/uv/install.sh | UV_INSTALL_DIR="$tools_root/bin" sh >data/deployment/uv-install.log 2>&1
fi
if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]]; then
  stage 'Preparing Node.js tooling on the container SSD'
  mkdir -p "$node_root"
  curl -fsSL https://nodejs.org/dist/v22.23.0/node-v22.23.0-linux-x64.tar.xz -o "$node_root/node.tar.xz"
  tar --no-same-owner -xJf "$node_root/node.tar.xz" --strip-components=1 -C "$node_root"
  rm "$node_root/node.tar.xz"
fi
if ! command -v pnpm >/dev/null; then
  npm install -g --prefix "$tools_root" pnpm@10.11.0 >data/deployment/pnpm-install.log 2>&1
fi
if [[ ! -x "$python_env/bin/python" ]]; then
  uv venv --python 3.12 "$python_env"
  rm -f "$python_env/.larkup-runtime-deps.sha256"
fi
runtime_revision="$(sha256sum "$repo/packages/marketplace-tools/video-intelligence/runtime/pyproject.toml" | cut -d' ' -f1)"
if [[ ! -f "$python_env/.larkup-runtime-deps.sha256" ]] || [[ "$(cat "$python_env/.larkup-runtime-deps.sha256")" != "$runtime_revision" ]]; then
  stage 'Preparing Python runtime dependencies on the container SSD'
  uv pip install --python "$python_env/bin/python" -e "$repo/packages/marketplace-tools/video-intelligence/runtime[cpu]" >data/deployment/runtime-install.log 2>&1
  uv pip install --python "$python_env/bin/python" onnxruntime-gpu==1.22.0 onnx >data/deployment/gpu-install.log 2>&1
  printf '%s' "$runtime_revision" >"$python_env/.larkup-runtime-deps.sha256"
fi
if [[ "$python_env" != "$bench/data/deployment/venv" ]]; then
  if [[ -d data/deployment/venv && ! -L data/deployment/venv ]]; then
    previous_env="$(mktemp -d "$bench/data/deployment/venv.previous.XXXXXX")"
    mv data/deployment/venv "$previous_env/venv"
  fi
  ln -sfn "$python_env" data/deployment/venv
fi
mkdir -p data/models
if [[ ! -f data/models/yolox_s.onnx ]]; then
  curl -fsSL https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx -o data/models/yolox_s.onnx
fi
node_revision="$(sha256sum "$repo/pnpm-lock.yaml" | cut -d' ' -f1)"
node_store="${BENCHMARK_NODE_STORE:-/opt/larkup-benchmark-node}"
if [[ ! -f "$node_store/.larkup-node-deps.sha256" ]] || [[ "$(cat "$node_store/.larkup-node-deps.sha256")" != "$node_revision" ]] || [[ ! -d "$repo/packages/core/node_modules/tsx" ]]; then
  stage 'Preparing Node.js dependencies on the container SSD'
  cd "$repo"
  CI=true pnpm install --filter @larkup/core... --filter @larkup/marketplace --filter @larkup/tool-video-intelligence --frozen-lockfile --ignore-scripts --virtual-store-dir "$node_store" --store-dir /opt/larkup-benchmark-pnpm-store >"$bench/data/deployment/node-install.log" 2>&1
  cd "$bench"
  printf '%s' "$node_revision" >"$node_store/.larkup-node-deps.sha256"
fi
date -u +%FT%TZ >data/deployment/bootstrap.done
stage 'Starting GPU validation and benchmark services'
task_cuda_libraries="$(python3 -c 'import glob; print(":".join(glob.glob("/usr/local/lib/python*/site-packages/nvidia/*/lib")+glob.glob("/usr/local/lib/python*/dist-packages/nvidia/*/lib")+glob.glob("/opt/venv/lib/python*/site-packages/nvidia/*/lib")+glob.glob("/usr/local/cuda*/lib64")))')"
export LD_LIBRARY_PATH="$task_cuda_libraries:${LD_LIBRARY_PATH:-}"
exec data/deployment/venv/bin/python -m harness.remote_runtime
