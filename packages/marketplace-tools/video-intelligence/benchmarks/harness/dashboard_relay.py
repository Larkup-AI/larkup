"""Server-to-server BFF bridge: credentials stay server-side, controller Origin stays exact."""
from __future__ import annotations

import hmac
import json
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .main import BENCHMARK
from .common import DomainError, canonical, identifier


def offline(path):
    """Read a verified SQLite backup without migrations, leases, or dispatches."""
    from urllib.parse import urlsplit, parse_qs
    from .store import Store
    from .config import Config
    from .api import Controller
    database = BENCHMARK / 'data/state/remote-backup.sqlite3'
    if not database.exists():
        raise DomainError('NO_OFFLINE_SNAPSHOT', status=503)
    store = Store(database, readonly=True)
    try:
        saved = store.rows("SELECT value FROM settings WHERE key='active_config'")
        config = Config(json.loads(saved[0]['value']) if saved else json.loads((BENCHMARK / 'data/configs/active.json').read_text()), BENCHMARK / 'benchmark.env')
        parsed = urlsplit(path)
        result = Controller(store, config, BENCHMARK / 'data', '', readonly=True).get(parsed.path[len('/api/v1'):], parse_qs(parsed.query))
        if parsed.path.endswith('/health'):
            from datetime import datetime, timezone
            result.update(mode='offline', lastSyncedAt=datetime.fromtimestamp(database.stat().st_mtime, timezone.utc).isoformat())
        return result
    finally:
        store.close()


def main():
    token = json.loads((BENCHMARK / 'data/deployment/relay.json').read_text())['controllerToken']
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def proxy(self):
            if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                self.send_error(401)
                return
            if not self.path.startswith('/api/v1/') or self.command not in {'GET', 'POST'}:
                self.send_error(404)
                return
            size = int(self.headers.get('Content-Length', 0))
            if size > 1024 * 1024:
                self.send_error(413)
                return
            headers = {k: v for k, v in self.headers.items() if k.lower() in {'authorization', 'content-type', 'idempotency-key', 'if-match'}}
            if self.command == 'POST':
                headers['Origin'] = 'http://127.0.0.1:3100'
            request = urllib.request.Request('http://127.0.0.1:28890' + self.path, headers=headers,
                                             data=self.rfile.read(size) if self.command == 'POST' else None,
                                             method=self.command)
            try:
                response = urllib.request.urlopen(request, timeout=30)
            except urllib.error.HTTPError as e:
                response = e
            except OSError:
                try:
                    if self.command != 'GET':
                        raise DomainError('OFFLINE_READONLY', status=409)
                    result = offline(self.path)
                    status, body = 200, result if isinstance(result, bytes) else canonical(result).encode()
                except DomainError as error:
                    status, body = error.status, canonical({'error': {**error.issue(), 'requestId': identifier('req')}}).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'text/csv' if self.path.endswith('.csv') and status == 200 else 'application/json')
                self.send_header('X-Benchmark-Availability', 'offline')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            with response:
                body = response.read()
                self.send_response(response.status)
                for k, v in response.headers.items():
                    if k.lower() in {'content-type', 'content-disposition', 'etag'}:
                        self.send_header(k, v)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)
        do_GET = do_POST = proxy
    ThreadingHTTPServer(('127.0.0.1', 28891), Handler).serve_forever()


if __name__ == '__main__':
    main()
