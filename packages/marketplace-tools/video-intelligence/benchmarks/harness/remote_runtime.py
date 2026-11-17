"""Launch canonical executable unchanged, with secrets supplied only in child memory."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import signal
import threading
from pathlib import Path

from .common import Secrets, atomic
from .main import BENCHMARK, initialize
from .recovery_contract import runtime_command


def main():
    initialize(BENCHMARK)
    from .gpu_probe import verify
    verify(BENCHMARK)
    private = Secrets(BENCHMARK / 'benchmark.env')
    config = json.loads((BENCHMARK / 'data/configs/active.json').read_text())
    relay_file = BENCHMARK / 'data/deployment/relay.json'
    if relay_file.exists():
        relay = json.loads(relay_file.read_text())
        os.environ.update(BENCHMARK_PROVIDER_PROXY='http://127.0.0.1:18891',
                          BENCHMARK_RELAY_CAPABILITY=relay['relayCapability'])
    env = dict(os.environ)
    env.update(LARKUP_VIDEO_DATA_DIR=str(BENCHMARK / 'data/runtime'),
               LARKUP_VIDEO_MODEL_DIR=str(BENCHMARK / 'data/models'),
               LARKUP_VIDEO_DEVICE='cuda', LARKUP_VIDEO_OCR_ENGINE='RapidOCR',
               LARKUP_VIDEO_HOST='127.0.0.1', LARKUP_VIDEO_PORT='8787',
               LARKUP_VIDEO_WORKERS='1', LARKUP_VIDEO_REQUIRE_AUTH='true',
               LARKUP_VIDEO_SHARED_API_KEY=private.get('BENCHMARK_RUNTIME_TOKEN'),
               LARKUP_VIDEO_EMBEDDING_PROVIDER='disabled', LARKUP_VIDEO_EMBEDDING_FALLBACK_PROVIDER='disabled',
               LARKUP_VIDEO_TRANSCRIPTION_CONCURRENCY='2', LARKUP_VIDEO_TRANSCRIPTION_FALLBACK='',
               LARKUP_VIDEO_GATEWAY_CONCURRENCY='2', LARKUP_VIDEO_GOOGLE_CONCURRENCY='2')
    if os.environ.get('BENCHMARK_PROVIDER_PROXY'):
        proxy = os.environ['BENCHMARK_PROVIDER_PROXY']
        capability = os.environ['BENCHMARK_RELAY_CAPABILITY']
        profile = config['variants'][config['runtime']['profileVariantId']]
        roles = profile['roles']
        env.update(LARKUP_VIDEO_AGENT_ENABLED='true', LARKUP_VIDEO_AGENT_PROVIDER=roles['brain']['provider'],
                   LARKUP_VIDEO_AGENT_MODEL=roles['brain']['model'], LARKUP_VIDEO_PLANNER_MODEL=roles['brain']['model'],
                   LARKUP_VIDEO_AGENT_API_KEY=capability, LARKUP_VIDEO_AGENT_BASE_URL=proxy + '/runtime/brain',
                   LARKUP_VIDEO_SEMANTIC_VISION='true', LARKUP_VIDEO_VISION_PROVIDER=roles['vision']['provider'],
                   LARKUP_VIDEO_SEMANTIC_VISION_MODEL=roles['vision']['model'], LARKUP_VIDEO_REASONING_VISION_MODEL=roles['vision']['model'],
                   LARKUP_VIDEO_VISION_API_KEY=capability, LARKUP_VIDEO_GOOGLE_API_KEY=capability,
                   LARKUP_VIDEO_VISION_BASE_URL=proxy + '/runtime/vision',
                   LARKUP_VIDEO_GEMINI_BASE_URL=proxy + '/runtime/vision')
    # Canonical jobs receive transient role credentials from the harness. No platform/production env.
    logs = BENCHMARK / 'data/deployment'
    logs.mkdir(parents=True, exist_ok=True)
    with (logs / 'runtime.log').open('ab') as runtime_log, (logs / 'controller.log').open('ab') as controller_log:
        stopping = threading.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: stopping.set())
        runtime = subprocess.Popen(runtime_command(sys.executable, env), cwd=BENCHMARK.parent / 'runtime',
                                   env=env, stdout=runtime_log, stderr=subprocess.STDOUT)
        controller = subprocess.Popen([sys.executable, '-m', 'harness.main', 'serve'], cwd=BENCHMARK,
                                      env={**os.environ}, stdout=controller_log, stderr=subprocess.STDOUT)
        atomic(logs / 'processes.json', {'runtimePid': runtime.pid, 'controllerPid': controller.pid,
                                        'supervisorPid': os.getpid()})
        try:
            while runtime.poll() is None and controller.poll() is None and not stopping.wait(2):
                pass
        finally:
            for process in (controller, runtime):
                if process.poll() is None:
                    process.terminate()
            for process in (controller, runtime):
                try:
                    process.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    process.kill()
        raise SystemExit(1)


if __name__ == '__main__':
    main()
