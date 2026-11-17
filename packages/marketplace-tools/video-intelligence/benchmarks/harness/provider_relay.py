"""PC-only credential relay. RunPod receives revocable benchmark capabilities, never provider keys."""
from __future__ import annotations

import asyncio
import hmac
import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .common import DomainError, Secrets, atomic, canonical, digest, identifier, utc
from .config import ENDPOINTS
from .main import BENCHMARK
from .transport import HTTP


def runtime_payload(document, spec, input_modalities=None, reasoning_effort=None):
    payload=json.loads(json.dumps(document))
    payload['model']=spec['model']
    if spec['provider']=='deepseek' and payload.get('response_format',{}).get('type')=='json_schema':
        schema=payload['response_format']['json_schema']['schema']
        payload['response_format']={'type':'json_object'}
        payload.setdefault('messages',[]).append({'role':'user','content':'Return JSON matching this required schema: '+canonical(schema)})
    if spec['provider']!='vercel_ai_gateway':
        reasoning=payload.pop('reasoning',None)
        if reasoning and spec['provider'] in {'deepinfra','gemini_openai'}:
            effort=reasoning.get('effort')
            if effort:payload.setdefault('reasoning_effort',{'minimal':'low'}.get(effort,effort))
    if reasoning_effort is not None:
        if spec['provider']=='vercel_ai_gateway':payload['reasoning']={'effort':reasoning_effort}
        else:payload['reasoning_effort']=reasoning_effort
    if input_modalities is not None and set(input_modalities)=={'text'}:
        for message in payload.get('messages',[]):
            if isinstance(message.get('content'),list):
                message['content']=[part if part.get('type')=='text' else
                    {'type':'text','text':'[The reasoning role is text-only: scout image bytes are omitted. Use the supplied timestamped text signals; the vision role supplies visual evidence.]'}
                    for part in message['content']]
    return payload


def configured_role_specs(config):
    for variant in config['variants'].values():
        yield from variant.get('roles',{}).values()
        for candidates in variant.get('inputProtocol',{}).get('roleFallbacks',{}).values():
            yield from candidates


class Relay:
    def __init__(self, benchmark: Path, capability: str):
        self.benchmark, self.data, self.capability = benchmark, benchmark / 'data', capability
        self.secrets = Secrets(benchmark / 'benchmark.env')
        self.http, self.lock = HTTP(), threading.RLock()
        self.context = None
        self.usage = self.data / 'runs/relay-usage.jsonl'
        self.usage.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.calls = {}
        self.total_calls = {}
        self.exhausted_aliases = set()
        self.asr_locks = {}

    def record(self, entry):
        with self.lock:
            with self.usage.open('a') as f:
                os.chmod(self.usage, 0o600)
                f.write(canonical(self.secrets.clean({'providerEventId': identifier('provider-usage'), 'recordedAt': utc(), **entry})) + '\n')
                f.flush()

    def asr(self, body):
        # Source registration is local and immutable. Never accept a filesystem path from a Pod/model.
        source = None
        for file in (self.data / 'datasets').glob('*.json'):
            manifest = json.loads(file.read_text())
            source = next((s for s in manifest['sources'] if s['id'] == body.get('sourceId') and s.get('sha256') == body.get('sha256')), None)
            if source:
                break
        if not source:
            raise DomainError('SOURCE_UNAVAILABLE')
        path = (self.data / source['path']).resolve()
        if not path.is_relative_to(self.data.resolve()) or not path.is_file():
            raise DomainError('SOURCE_UNAVAILABLE')
        spec = body.get('audio', {'provider': 'deepgram', 'model': 'nova-3', 'secretAlias': 'DEEPGRAM_APIKEY1'})
        configured = json.loads((self.data / 'configs/active.json').read_text())
        allowed_audio = [v['roles']['audio'] for v in configured['variants'].values() if v.get('roles', {}).get('audio')]
        if spec not in allowed_audio or spec['provider'] != 'deepgram':
            raise DomainError('CAPABILITY_UNSUPPORTED')
        implementation = self.benchmark.parent / 'runtime/app/services/transcription.py'
        cache = self.data / 'artifacts' / digest([source['sha256'], spec['provider'], spec['model'],
                                                __import__('hashlib').sha256(implementation.read_bytes()).hexdigest()]) / 'transcript.json'
        with self.lock:
            source_lock = self.asr_locks.setdefault(str(cache), threading.Lock())
        with source_lock:
            if cache.exists():
                return {**json.loads(cache.read_text()), 'artifactId': cache.parent.name, 'reused': True}
            request = dict(path=str(path), durationSecs=source['durationMs'] / 1000,
                           apiKey=self.secrets.get(spec['secretAlias']), model=spec['model'], runtime=str(self.benchmark.parent / 'runtime'))
            child = subprocess.run(['uv', 'run', '--python', '3.12', '--with', 'requests', 'python',
                                    str(self.benchmark / 'harness/asr_local.py')], input=canonical(request),
                                   text=True, capture_output=True, timeout=900)
            if child.returncode:
                self.record(dict(operation='canonical_asr', sourceId=source['id'], actual=None, status='failed'))
                raise DomainError('CANONICAL_ASR_FAILED')
            try:
                output = json.loads(child.stdout)
            except ValueError:
                raise DomainError('CANONICAL_ASR_FAILED') from None
            atomic(cache, self.secrets.clean(output))
            called = output.get('diagnostics', {}).get('providerCalled', True)
            self.record(dict(operation='canonical_asr', sourceId=source['id'], actual=None if called else '0',
                             processingSeconds=source['durationMs'] / 1000 if called else 0,
                             provenance='canonical speech call' if called else 'ffprobe: no audio stream; provider not called',
                             accountAlias=spec['secretAlias'], model=spec['model'], status='completed',
                             attemptId=body.get('attemptId'), provider='deepgram', origin='canonical-asr'))
            return {**output, 'artifactId': cache.parent.name, 'reused': False}

    def runtime_forward(self, context, role, suffix, method, body, headers):
        primary=context['roles'][role]
        fallbacks=context.get('roleFallbacks',{}).get(role,[])
        if any(spec.get('verifiedEquivalent') is not True for spec in fallbacks):raise DomainError('ROUTE_EQUIVALENCE_UNVERIFIED')
        candidates=[primary,*fallbacks]
        bases={'vercel_ai_gateway':'https://ai-gateway.vercel.sh/v1',
               'gemini_openai':'https://generativelanguage.googleapis.com/v1beta/openai',
               'google':'https://generativelanguage.googleapis.com/v1beta',
               'deepinfra':'https://api.deepinfra.com/v1/openai','deepseek':'https://api.deepseek.com/v1'}
        last=None
        for spec in candidates:
            outbound=body;out_headers=dict(headers)
            if body and 'application/json' in headers.get('content-type',''):
                doc=runtime_payload(json.loads(body),spec,context.get('roleInputModalities',{}).get(role),context.get('roleReasoningEffort',{}).get(role))
                outbound=json.dumps(doc).encode();out_headers['content-length']=str(len(outbound))
            try:
                return self.forward(bases[spec['provider']]+suffix,spec['secretAlias'],method,outbound,out_headers,
                                    context['attemptId'],origin='runtime',role=role)
            except DomainError as error:
                if error.code!='CREDIT_EXHAUSTED':raise
                last=error
        raise last or DomainError('NO_ELIGIBLE_ROUTE')

    def forward(self, target: str, alias: str, method: str, body: bytes, headers: dict, attempt=None, origin='adapter', role=None):
        from urllib.parse import urlsplit
        parsed = urlsplit(target)
        allowed = any(target.startswith(base + '/') or target == base for bases in ENDPOINTS.values() for base in bases if base.startswith('https://'))
        # Resumable uploads use the same fixed Google host, under the documented upload prefix.
        allowed = allowed or (parsed.scheme == 'https' and parsed.hostname == 'generativelanguage.googleapis.com' and parsed.path.startswith('/upload/v1beta/'))
        if not allowed or parsed.username or parsed.password or method not in {'GET', 'POST', 'PUT'}:
            raise DomainError('DESTINATION_INVALID')
        config = json.loads((self.data / 'configs/active.json').read_text())
        permitted_aliases = {r['secretAlias'] for r in config['routes'].values()}
        permitted_aliases.update(s['secretAlias'] for s in configured_role_specs(config))
        if alias not in permitted_aliases:
            raise DomainError('AUTH_INVALID')
        provider_for_host = {'ai-gateway.vercel.sh': 'gateway', 'generativelanguage.googleapis.com': 'gemini',
                             'api.deepseek.com': 'deepseek', 'api.deepinfra.com': 'deepinfra', 'api.twelvelabs.io': 'twelvelabs',
                             'dashscope.aliyuncs.com': 'qwen', 'dashscope-intl.aliyuncs.com': 'qwen',
                             'dashscope-us.aliyuncs.com': 'qwen'}
        intended = {r['provider'] for r in config['routes'].values() if r['secretAlias'] == alias}
        intended.update({'google': 'gemini', 'gemini_openai': 'gemini', 'vercel_ai_gateway': 'gateway'}.get(s['provider'], s['provider'])
                        for s in configured_role_specs(config) if s['secretAlias'] == alias)
        if provider_for_host.get(parsed.hostname) not in intended:
            raise DomainError('SECRET_SCOPE_MISMATCH', status=403)
        requested_model=None
        if body and 'application/json' in headers.get('content-type', ''):
            payload = json.loads(body)
            allowed_models = {r['model'] for r in config['routes'].values()} | {s['model'] for s in configured_role_specs(config)}
            requested_model = payload.get('model') or payload.get('model_name') or headers.get('ai-language-model-id')
            if requested_model and requested_model not in allowed_models:
                raise DomainError('MODEL_VARIANT_MISMATCH')
        if '/models/' in parsed.path:
            model = parsed.path.split('/models/', 1)[1].split(':', 1)[0]
            if model not in {r['model'].split('/')[-1] for r in config['routes'].values()} | {s['model'].split('/')[-1] for s in configured_role_specs(config)}:
                raise DomainError('MODEL_VARIANT_MISMATCH')
        key = self.secrets.get(alias)
        if method != 'GET' and alias in self.exhausted_aliases:
            raise DomainError('CREDIT_EXHAUSTED')
        outbound = {k: v for k, v in headers.items() if k in {'content-type', 'content-length'} or k.startswith('x-goog-upload-') or k.startswith('ai-')}
        if alias.startswith('GEMINI'):
            # Google's native API takes x-goog-api-key; its OpenAI-compatible endpoint
            # (/v1beta/openai/...), used for Larkup vision, authenticates with a Bearer token.
            if '/openai/' in parsed.path:
                outbound['Authorization'] = 'Bearer ' + key
            else:
                outbound['x-goog-api-key'] = key
        elif alias.startswith('TWELEVE'):
            outbound['x-api-key'] = key
        else:
            outbound['Authorization'] = 'Bearer ' + key
        with self.lock:
            counter = self.calls.setdefault(attempt or 'unattributed', [])
            now = time.time()
            counter[:] = [t for t in counter if t > now - 60]
            if len(counter) >= 60:
                raise DomainError('QUOTA_WAIT', retryable=True, wait=60)
            counter.append(now)
            if method == 'POST' and any(x in parsed.path for x in ('generateContent', 'completions', 'analyze/tasks')):
                self.total_calls[attempt] = self.total_calls.get(attempt, 0) + 1
                if self.total_calls[attempt] > 128:
                    raise DomainError('EXECUTION_BUDGET_EXCEEDED')
        paid = method == 'POST' and any(x in parsed.path for x in ('generateContent', 'completions', 'analyze/tasks', 'language-model', 'interactions'))
        provider = 'gateway' if parsed.hostname == 'ai-gateway.vercel.sh' else 'gemini' if parsed.hostname == 'generativelanguage.googleapis.com' else 'deepseek' if parsed.hostname == 'api.deepseek.com' else 'deepinfra' if parsed.hostname == 'api.deepinfra.com' else 'twelvelabs'
        try:
            response = self.http.sync(method, target, body=body or None, headers=outbound, timeout=600, submitted=paid)
        except DomainError as e:
            if e.code == 'CREDIT_EXHAUSTED':
                self.exhausted_aliases.add(alias)
            if paid:
                self.record(dict(attemptId=attempt, accountAlias=alias, operation=parsed.path,
                                 provider=provider, origin=origin, role=role, model=requested_model, actual=None, issue=e.issue()))
            raise
        if paid:
            try:
                payload = response.json()
                usage = payload.get('usageMetadata') or payload.get('usage') or {}
            except DomainError:
                usage = {}
            self.record(dict(attemptId=attempt, accountAlias=alias, operation=parsed.path.split('?')[0],
                             usage=usage, actual=usage.get('cost'), status=response.status,
                             provider=provider, origin=origin, role=role, model=requested_model))
        return response

    def handler(self):
        relay = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def handle_request(self):
                try:
                    if not hmac.compare_digest(self.headers.get('X-Benchmark-Capability', self.headers.get('x-goog-api-key', self.headers.get('Authorization', '').removeprefix('Bearer '))), relay.capability):
                        raise DomainError('UNAUTHORIZED', status=401)
                    size = int(self.headers.get('Content-Length', 0))
                    if size > 2 * 1024**3:
                        raise DomainError('PAYLOAD_TOO_LARGE', status=413)
                    body = self.rfile.read(size)
                    headers = {k.lower(): v for k, v in self.headers.items()}
                    path = urlsplit(self.path).path
                    if path == '/control/index-context':
                        context = json.loads(body)
                        context['expires'] = time.time() + 3600
                        relay.context = context
                        payload, status, extra = b'{}', 200, {}
                    elif path == '/control/reload':
                        from .config import Config
                        candidate = json.loads(body)
                        validated = Config(candidate, relay.benchmark / 'benchmark.env')
                        with relay.lock:
                            relay.secrets = validated.active.secrets
                            atomic(relay.data / 'configs/active.json', candidate)
                        payload, status, extra = b'{}', 200, {}
                    elif path.startswith('/usage/attempt/'):
                        aid = path.rsplit('/', 1)[-1]
                        with relay.lock:
                            entries = [json.loads(line) for line in relay.usage.read_text().splitlines()] if relay.usage.exists() else []
                        payload, status, extra = canonical({'items': [e for e in entries if e.get('attemptId') == aid and e.get('origin') in {'runtime', 'canonical-asr'}]}).encode(), 200, {}
                    elif path == '/canonical-asr':
                        payload, status, extra = canonical(relay.asr(json.loads(body))).encode(), 200, {}
                    else:
                        if path.startswith('/runtime/'):
                            context = relay.context
                            if not context or context['expires'] < time.time():
                                raise DomainError('RUNTIME_CONTEXT_REQUIRED')
                            role = 'vision' if path.startswith('/runtime/vision') else 'brain'
                            suffix = self.path[len('/runtime/' + role):]
                            response=relay.runtime_forward(context,role,suffix,self.command,body,headers)
                        elif path == '/forward':
                            target, alias, attempt = self.headers.get('X-Benchmark-Target', ''), self.headers.get('X-Benchmark-Account', ''), self.headers.get('X-Benchmark-Attempt')
                            response=relay.forward(target,alias,self.command,body,headers,attempt)
                        else:
                            raise DomainError('NOT_FOUND', status=404)
                        payload, status = response.body, response.status
                        extra = {k: v for k, v in response.headers.items() if k in {'x-goog-upload-url', 'content-type', 'retry-after'}}
                    self.send_response(status)
                    self.send_header('Content-Length', str(len(payload)))
                    for k, v in extra.items():
                        self.send_header(k, v)
                    self.end_headers()
                    self.wfile.write(payload)
                except DomainError as e:
                    # Domain code is sufficient for the remote scheduler; no upstream error text.
                    payload = canonical({'benchmarkError': e.code, 'retryable': e.retryable, 'wait': e.wait, 'unknown': e.unknown}).encode()
                    self.send_response(getattr(e, 'upstream_status', e.status))
                    if e.wait is not None:
                        self.send_header('Retry-After', str(max(1, round(e.wait))))
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                except Exception:
                    payload = b'{"benchmarkError":"INFRA_FAILURE"}'
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
            do_POST = do_GET = do_PUT = handle_request
        return Handler


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8891)
    parser.add_argument('--capability-file', type=Path, required=True)
    args = parser.parse_args()
    capability = json.loads(args.capability_file.read_text())['relayCapability']
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Relay(BENCHMARK, capability).handler())
    server.daemon_threads = True
    server.serve_forever()


if __name__ == '__main__':
    main()
