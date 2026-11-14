from __future__ import annotations

import asyncio
import email.utils
import http.client
import json
import socket
import ssl
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .common import DomainError, canonical, identifier


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes
    elapsed_ms: float

    def json(self) -> dict:
        try:
            if self.headers.get('content-type', '').startswith('text/event-stream'):
                text, model, usage, finished = '', None, {}, False
                for line in self.body.decode().splitlines():
                    if not line.startswith('data:'):
                        continue
                    content = line[5:].strip()
                    if content == '[DONE]':
                        finished = True
                        continue
                    event = json.loads(content)
                    if event.get('error'):
                        raise ValueError()
                    model = event.get('model', model)
                    usage = event.get('usage') or usage
                    for choice in event.get('choices', []):
                        text += choice.get('delta', {}).get('content') or ''
                        finished = finished or choice.get('finish_reason') is not None
                if not finished:
                    raise ValueError()
                return {'model': model, 'choices': [{'message': {'content': text}}], 'usage': usage}
            return json.loads(self.body)
        except (ValueError, UnicodeDecodeError):
            raise DomainError('PROVIDER_RESPONSE_INVALID') from None


def classify(status: int, body: bytes, headers: dict, *, submitted: bool = False) -> DomainError:
    text = body[:10000].decode(errors='replace').lower()
    if status in {401, 403}:
        return DomainError('AUTH_INVALID')
    if status == 402 or any(x in text for x in ('insufficient_quota', 'insufficient credit', 'credit balance', 'billing_hard_limit', 'video_hour_limit', 'not enough credit', 'exceeded your current quota')):
        return DomainError('CREDIT_EXHAUSTED')
    if status == 429:
        after = headers.get('retry-after', '60')
        try:
            wait = float(after)
        except ValueError:
            try:
                wait = email.utils.parsedate_to_datetime(after).timestamp() - time.time()
            except (ValueError, TypeError):
                wait = 60
        return DomainError('QUOTA_WAIT', retryable=True, wait=max(1, wait))
    if status == 404:
        return DomainError('MODEL_UNAVAILABLE')
    if status >= 500:
        return DomainError('REMOTE_OUTCOME_UNKNOWN' if submitted else 'INFRA_FAILURE', retryable=not submitted, wait=10, unknown=submitted)
    return DomainError('CAPABILITY_UNSUPPORTED' if status in {400, 413, 422} else 'INFRA_FAILURE')


class HTTP:
    async def request(self, method: str, url: str, *, headers: dict | None = None,
                      document=None, body=None, timeout: int = 120, submitted=False) -> Response:
        return await asyncio.to_thread(self.sync, method, url, headers=headers, document=document,
                                       body=body, timeout=timeout, submitted=submitted)

    def sync(self, method: str, url: str, *, headers=None, document=None, body=None,
             timeout=120, submitted=False) -> Response:
        parsed = urlsplit(url)
        if parsed.username or parsed.password or parsed.fragment or (parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname == '127.0.0.1')):
            raise DomainError('DESTINATION_INVALID')
        headers = dict(headers or {})
        if document is not None:
            body = canonical(document).encode()
            headers['Content-Type'] = 'application/json'
        import os
        proxy = os.environ.get('BENCHMARK_PROVIDER_PROXY')
        if proxy and parsed.scheme == 'https':
            # Existing provider keys never leave the PC. Only a benchmark-scoped capability
            # crosses the SSH tunnel; the PC relay injects actual upstream authentication.
            headers['X-Benchmark-Target'] = url
            headers['X-Benchmark-Capability'] = os.environ['BENCHMARK_RELAY_CAPABILITY']
            parsed = urlsplit(proxy + '/forward')
        conn_cls = http.client.HTTPSConnection if parsed.scheme == 'https' else http.client.HTTPConnection
        conn = conn_cls(parsed.hostname, port=parsed.port, timeout=timeout)
        start = time.monotonic()
        try:
            conn.request(method, parsed.path + ('?' + parsed.query if parsed.query else ''), body=body, headers=headers)
            response = conn.getresponse()
            # All expected provider JSON fits this ceiling. Large media are streamed separately.
            raw = response.read(64 * 1024 * 1024 + 1)
            if len(raw) > 64 * 1024 * 1024:
                raise DomainError('PROVIDER_RESPONSE_TOO_LARGE')
            h = {k.lower(): v for k, v in response.getheaders()}
            if proxy:
                try:
                    envelope = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    envelope = {}
                if isinstance(envelope, dict) and envelope.get('benchmarkError'):
                    raise DomainError(envelope['benchmarkError'], retryable=envelope.get('retryable', False),
                                      wait=envelope.get('wait'), unknown=envelope.get('unknown', False))
            if response.status >= 300:
                error = classify(response.status, raw, h, submitted=submitted)
                error.upstream_status = response.status
                raise error
            return Response(response.status, h, raw, (time.monotonic() - start) * 1000)
        except (TimeoutError, socket.timeout, OSError, http.client.HTTPException):
            raise DomainError('REMOTE_OUTCOME_UNKNOWN' if submitted else 'INFRA_FAILURE',
                              retryable=not submitted, wait=10, unknown=submitted) from None
        finally:
            conn.close()


def multipart(path: Path, fields: dict | None = None):
    boundary = identifier('form')
    prefix = b''
    for key, value in (fields or {}).items():
        prefix += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
    prefix += f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="source.mp4"\r\nContent-Type: video/mp4\r\n\r\n'.encode()
    suffix = f'\r\n--{boundary}--\r\n'.encode()

    def stream():
        yield prefix
        with path.open('rb') as f:
            while chunk := f.read(1024 * 1024):
                yield chunk
        yield suffix

    return stream(), {'Content-Type': f'multipart/form-data; boundary={boundary}',
                      'Content-Length': str(len(prefix) + path.stat().st_size + len(suffix))}
