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
trap 'echo "$?" >data/deployment/bootstrap.failed' ERR
# Keep downloaded tools on the persistent volume across container restarts.
export PATH="$bench/data/deployment/tools/bin:$bench/data/deployment/node/bin:$PATH"
if ! command -v ffmpeg >/dev/null || ! command -v espeak >/dev/null; then
  echo 'Installing container system dependencies'
  apt-get update -qq
  apt-get install -y -qq ffmpeg espeak curl xz-utils libgomp1 >data/deployment/apt.log 2>&1
fi
if ! command -v uv >/dev/null; then
  echo 'Preparing persistent Python tooling'
  curl -fsSL https://astral.sh/uv/install.sh | UV_INSTALL_DIR="$bench/data/deployment/tools/bin" sh >data/deployment/uv-install.log 2>&1
fi
if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]]; then
  echo 'Preparing persistent Node.js tooling'
  curl -fsSL https://nodejs.org/dist/v22.23.0/node-v22.23.0-linux-x64.tar.xz -o data/deployment/node.tar.xz
  mkdir -p data/deployment/node
  tar --no-same-owner -xJf data/deployment/node.tar.xz --strip-components=1 -C data/deployment/node
  rm data/deployment/node.tar.xz
fi
if ! command -v pnpm >/dev/null; then
  npm install -g --prefix "$bench/data/deployment/tools" pnpm@10.11.0 >data/deployment/pnpm-install.log 2>&1
fi
if [[ ! -x "$bench/data/deployment/venv/bin/python" ]]; then
  uv venv --python 3.12 "$bench/data/deployment/venv"
  rm -f data/deployment/runtime-deps.sha256
fi
runtime_revision="$(sha256sum "$repo/packages/marketplace-tools/video-intelligence/runtime/pyproject.toml" | cut -d' ' -f1)"
if [[ ! -f data/deployment/runtime-deps.sha256 ]] || [[ "$(cat data/deployment/runtime-deps.sha256)" != "$runtime_revision" ]]; then
  echo 'Preparing Python runtime dependencies'
  uv pip install --python "$bench/data/deployment/venv/bin/python" -e "$repo/packages/marketplace-tools/video-intelligence/runtime[cpu]" >data/deployment/runtime-install.log 2>&1
  uv pip install --python "$bench/data/deployment/venv/bin/python" onnxruntime-gpu==1.22.0 onnx >data/deployment/gpu-install.log 2>&1
  printf '%s' "$runtime_revision" >data/deployment/runtime-deps.sha256
fi
mkdir -p data/models
if [[ ! -f data/models/yolox_s.onnx ]]; then
  curl -fsSL https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx -o data/models/yolox_s.onnx
fi
node_revision="$(sha256sum "$repo/pnpm-lock.yaml" | cut -d' ' -f1)"
node_cache="$bench/data/deployment/node-deps.tar.gz"
node_store="${BENCHMARK_NODE_STORE:-/opt/larkup-benchmark-node}"
if [[ -f data/deployment/node-deps.sha256 ]] && [[ "$(cat data/deployment/node-deps.sha256)" == "$node_revision" ]] && [[ -f "$node_cache" ]] && [[ ! -d "$node_store" ]]; then
  echo 'Restoring prepared Node.js dependencies to the container disk'
  node_restore="$(mktemp -d "${node_store}.restore.XXXXXX")"
  tar --no-same-owner -xzf "$node_cache" -C "$node_restore"
  mv "$node_restore" "$node_store"
fi
if [[ ! -f data/deployment/node-deps.sha256 ]] || [[ "$(cat data/deployment/node-deps.sha256)" != "$node_revision" ]] || [[ ! -d "$repo/packages/core/node_modules/tsx" ]]; then
  echo 'Preparing Node.js dependencies on the container disk'
  cd "$repo"
  CI=true pnpm install --filter @larkup/core... --filter @larkup/marketplace --filter @larkup/tool-video-intelligence --frozen-lockfile --ignore-scripts --virtual-store-dir "$node_store" --store-dir /opt/larkup-benchmark-pnpm-store >"$bench/data/deployment/node-install.log" 2>&1
  cd "$bench"
  echo 'Saving prepared Node.js dependencies for the next wake up'
  tar -czf "$node_cache.partial" -C "$node_store" .
  mv "$node_cache.partial" "$node_cache"
  printf '%s' "$node_revision" >data/deployment/node-deps.sha256
fi
date -u +%FT%TZ >data/deployment/bootstrap.done
echo 'Starting GPU validation and benchmark services'
task_cuda_libraries="$(python3 -c 'import glob; print(":".join(glob.glob("/usr/local/lib/python*/site-packages/nvidia/*/lib")+glob.glob("/usr/local/lib/python*/dist-packages/nvidia/*/lib")+glob.glob("/opt/venv/lib/python*/site-packages/nvidia/*/lib")+glob.glob("/usr/local/cuda*/lib64")))')"
export LD_LIBRARY_PATH="$task_cuda_libraries:${LD_LIBRARY_PATH:-}"
exec data/deployment/venv/bin/python -m harness.remote_runtime
