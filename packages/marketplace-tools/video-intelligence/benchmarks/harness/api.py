from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from .common import DomainError, canonical, digest, identifier, utc
from .scoring import metrics, results


class Controller:
    def __init__(self, store, config, data: Path, token: str, *, origin='http://127.0.0.1:3000', readonly=False):
        self.store, self.config, self.data, self.token = store, config, data, token
        self.origin, self.readonly = origin, readonly
        self.write_lock = threading.RLock()
        self.rate: dict[str, list[float]] = {}

    def page(self, items: list, query: dict) -> dict:
        try:
            limit = max(1, min(200, int(query.get('limit', ['50'])[0])))
            cursor = max(0, int(query.get('cursor', ['0'])[0]))
        except (ValueError, TypeError):
            raise DomainError('MALFORMED_INPUT', status=400) from None
        return dict(items=items[cursor:cursor + limit], nextCursor=str(cursor + limit) if cursor + limit < len(items) else None,
                    hasMore=cursor + limit < len(items))

    def provider_scopes(self):
        from datetime import datetime, timezone
        scopes = {s['id']: s for s in self.store.rows('SELECT * FROM provider_scopes')}
        output = {}
        for route in self.config.active.config['routes'].values():
            sid = route['scopeId']
            state = scopes.get(sid, {})
            cooldown = state.get('cooldown_until', 0)
            item = dict(id=sid, provider=route['provider'], accountAlias=route['secretAlias'],
                        capabilities=route.get('capabilities', []), balance=state.get('balance'),
                        balanceCurrency='USD' if state.get('balance') is not None else None,
                        balanceReason=None if state.get('balance') is not None else 'Provider balance not observed',
                        freeAllowanceRemaining=None, freeAllowanceUnit=None,
                        quotaState='exhausted' if state.get('state') == 'credit_exhausted' else 'waiting_quota' if cooldown > time.time() else 'unknown',
                        cooldownUntil=datetime.fromtimestamp(cooldown, timezone.utc).isoformat() if cooldown else None,
                        routeHealth='down' if state.get('state') in {'auth_invalid', 'disabled'} else 'healthy' if state.get('successes', 0) else 'unknown',
                        tier=route['tier'])
            item['revision'] = digest(item)
            output[sid] = item
        return list(output.values())

    def get(self, path: str, query: dict):
        s = self.store
        if path == '/health':
            return dict(apiVersion='v1', controllerBuild=self.store.build_revision, schemaVersion='3',
                        availability='offline' if self.readonly else 'available', readonly=self.readonly, serverTime=utc())
        if path == '/config':
            return self.config.public()
        if path == '/provider-scopes':
            return self.page(self.provider_scopes(), query)
        if path == '/services':
            if self.readonly:
                return {'items': [dict(name='benchmark controller',state='offline',location='RunPod'),
                                  dict(name='canonical video runtime',state='unobserved',location='RunPod')]}
            from .transport import HTTP
            services = [dict(name='benchmark controller', state='running', location='RunPod')]
            try:
                health = HTTP().sync('GET', self.config.active.config.get('runtime', {}).get('endpoint', 'http://127.0.0.1:8787') + '/v1/health',
                    headers={'Authorization': 'Bearer ' + self.config.active.secrets.get('BENCHMARK_RUNTIME_TOKEN')}, timeout=2).json()
                services.append(dict(name='canonical video runtime', state='running', location='RunPod', operators=health.get('operators', {})))
            except DomainError:
                services.append(dict(name='canonical video runtime', state='unreachable', location='RunPod'))
            return {'items': services}
        if path == '/database/tables':
            from .inspection import tables
            return {'items': tables(s), 'readonly': True}
        if path.startswith('/database/'):
            from .inspection import database
            bits = path.strip('/').split('/')
            if len(bits) not in {2, 3} or (len(bits) == 3 and bits[2] != 'export.json'):
                raise DomainError('NOT_FOUND', status=404)
            return database(s, self.config.active.secrets, bits[1], query, export=len(bits) == 3)
        if path == '/logs':
            from .inspection import logs
            return logs(self.data, self.config.active.secrets, query.get('service', ['controller'])[0], query)
        if path == '/runs':
            return self.page([s.snapshot(r['id']) for r in s.rows('SELECT id FROM runs ORDER BY updated_at DESC,id DESC')], query)
        parts = path.strip('/').split('/')
        if len(parts) < 2 or parts[0] != 'runs':
            raise DomainError('NOT_FOUND', status=404)
        run = parts[1]
        s.one('SELECT id FROM runs WHERE id=?', (run,))
        if len(parts) == 2:
            return s.snapshot(run)
        if parts[2:] == ['exports', 'results.json']:
            from .inspection import database
            document = dict(snapshot=s.snapshot(run), metrics=metrics(s, run), results=results(s, run),
                            usage=database(s,self.config.active.secrets,'usage_events',{'runId':[run]},export=True)['items'],
                            exportedAt=utc(), redactions=['credentials','gold labels'])
            for table in ('sources','questions','variants','tasks','attempts','events','artifacts','remote_handles','evaluations','audits'):
                document[table] = database(s,self.config.active.secrets,table,{'runId':[run]},export=True)['items']
            return document
        if parts[2] == 'metrics':
            return metrics(s, run)
        if parts[2] == 'events':
            try:
                after = max(0, int(query.get('after', ['0'])[0]))
                limit = max(1, min(200, int(query.get('limit', ['50'])[0])))
            except ValueError:
                raise DomainError('MALFORMED_INPUT', status=400) from None
            events = s.rows('SELECT * FROM events WHERE id>? AND (run_id=? OR run_id IS NULL) ORDER BY id LIMIT ?', (after, run, limit + 1))
            return dict(events=[dict(id=str(e['id']), type=e['type'], runId=e['run_id'], occurredAt=e['occurred_at'],
                                     revision=e['revision'], data=json.loads(e['data'])) for e in events[:limit]],
                        nextCursor=str(events[min(limit, len(events)) - 1]['id']) if events else str(after), hasMore=len(events) > limit)
        if parts[2] == 'results':
            rows = results(s, run)
            for key in ('variantId', 'durationGroup', 'system', 'provider', 'state', 'sourceId'):
                if key in query:
                    rows = [r for r in rows if r[key] == query[key][0]]
            return self.page(rows, query)
        if parts[2] == 'tasks':
            rows = s.rows('SELECT * FROM tasks WHERE run_id=? ORDER BY created_at,id', (run,))
            out = []
            progress_by_task = {}
            for event in s.rows("SELECT data,occurred_at FROM events WHERE run_id=? AND type='task.updated' AND json_type(data,'$.progress') IS NOT NULL ORDER BY id DESC", (run,)):
                document = json.loads(event['data'])
                progress_by_task.setdefault(document.get('taskId'), (document.get('progress'), event['occurred_at']))
            for t in rows:
                variant = json.loads(s.one('SELECT document FROM variants WHERE run_id=? AND id=?', (run, t['variant_id']))['document'])
                attempt = s.rows('SELECT * FROM attempts WHERE id=?', (t['current_attempt'],))
                route = json.loads(attempt[0]['route']) if attempt else {}
                source = json.loads(s.one('SELECT document FROM sources WHERE run_id=? AND id=?', (run, t['source_id']))['document'])
                attempt_rows = s.rows('SELECT * FROM attempts WHERE task_id=? ORDER BY started_at', (t['id'],))
                progress, progress_at = progress_by_task.get(t['id'], (None, t['updated_at']))
                stage = progress.get('stage') if isinstance(progress, dict) else None
                percent = progress.get('percent') if isinstance(progress, dict) else None
                doc = dict(id=t['id'], taskId=t['id'], runId=run, sourceId=t['source_id'], questionId=t['question_id'] or None,
                           variantId=t['variant_id'], kind=t['kind'], state=t['state'], attemptCount=t['attempt_count'],
                           provider=route.get('provider'), system=variant['adapter'], attemptId=t['current_attempt'],
                           dataset=source.get('dataset'), accountAlias=route.get('secretAlias'), routeId=attempt[0]['route_id'] if attempt else None,
                           role=None, durationGroup=source.get('durationGroup'), stage=stage, percent=percent, progress=progress, progressObservedAt=progress_at,
                           updatedAt=t['updated_at'], attempts=[dict(attemptId=a['id'], state=a['state'] if a['state'] != 'unknown' else 'blocked',
                                                                    stage=None, percent=None, startedAt=a['started_at'],
                                                                    issue=json.loads(a['issue']) if a['issue'] else None) for a in attempt_rows],
                           issue=json.loads(t['issue']) if t['issue'] else None)
                if any(key in query and doc.get(key) != query[key][0] for key in ('state', 'provider', 'system', 'variantId', 'sourceId')):
                    continue
                out.append(doc)
            return self.page(out, query)
        exports = {'results.csv', 'questions.csv', 'summary.csv', 'usage.csv', 'attempts.csv',
                   'indexes.csv', 'metrics.csv', 'timing.csv', 'provider-usage.csv', 'paired.csv'}
        if len(parts) == 4 and parts[2] == 'exports' and parts[3] in exports:
            # Generate a snapshot export without mutating run/task state.
            from .scoring import export
            root = self.data / 'exports' / run
            export(s, run, root)
            return (root / ('' if parts[3] == 'results.csv' else 'data') / parts[3]).read_bytes()
        raise DomainError('NOT_FOUND', status=404)

    def mutate(self, path: str, body: dict, key: str):
        if self.readonly:
            raise DomainError('OFFLINE_READONLY', status=409)
        fingerprint = digest(body)
        with self.write_lock:
            saved = self.store.rows('SELECT * FROM controls WHERE scope=? AND key=?', (path, key))
            if saved:
                if saved[0]['body_hash'] != fingerprint:
                    raise DomainError('IDEMPOTENCY_CONFLICT', status=409)
                return saved[0]['status'], json.loads(saved[0]['response'])
            # Transaction wraps accepted control AND dedup record. Store operations use savepoints
            # through the reentrant transaction helper; a crash cannot separate them.
            with self.store.transaction() as cx:
                if path == '/runs':
                    name = body.get('datasetManifestId', '')
                    if not isinstance(name, str) or not name or not all(c.isalnum() or c in '-_' for c in name):
                        raise DomainError('MANIFEST_INVALID', status=400)
                    file = self.data / 'datasets' / (name + '.json')
                    if not file.is_file():
                        raise DomainError('NOT_FOUND', status=404)
                    manifest = json.loads(file.read_text())
                    answer = self.store.create(manifest, body.get('variantIds', []), self.config.active,
                                               body.get('phase', 'pilot'), body.get('protocolRevision', 'pilot-v1'))
                    status = 201
                elif path == '/config/validate':
                    answer = self.config.validate(body.get('config', {}), body.get('expectedRevision', ''))
                    status = 200
                elif path == '/config/activate':
                    # Validate activation before swapping; persist its document/event before exposing it.
                    previous = self.config.active
                    try:
                        snapshot = self.config.activate(body.get('candidateId', ''), body.get('expectedRevision', ''))
                        import os
                        if os.environ.get('BENCHMARK_PROVIDER_PROXY'):
                            from .transport import HTTP
                            HTTP().sync('POST', os.environ['BENCHMARK_PROVIDER_PROXY'] + '/control/reload',
                                        headers={'X-Benchmark-Capability': os.environ['BENCHMARK_RELAY_CAPABILITY']},
                                        document=snapshot.config)
                        self.store.save_config(snapshot)
                        cx.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', ('active_config', snapshot.document))
                        self.store.event(cx, 'config.activated', None, {'configRevision': snapshot.revision})
                        answer, status = self.config.public(), 202
                    except BaseException:
                        self.config.active = previous
                        raise
                else:
                    parts = path.strip('/').split('/')
                    if len(parts) == 3 and parts[0] == 'runs' and parts[2] in {'start', 'pause', 'resume', 'cancel'}:
                        answer = self.store.control(parts[1], parts[2], body.get('expectedRevision', ''))
                        status = 202
                    elif len(parts) == 3 and parts[0] == 'provider-scopes' and parts[2] == 'refresh':
                        scope = next((s for s in self.provider_scopes() if s['id'] == parts[1]), None)
                        if not scope:
                            raise DomainError('NOT_FOUND', status=404)
                        if body.get('expectedRevision') != scope['revision']:
                            raise DomainError('REVISION_CONFLICT', status=409)
                        route = next(r for r in self.config.active.config['routes'].values() if r['scopeId'] == parts[1])
                        job = dict(id=identifier('refresh'), scopeId=parts[1], route=route,
                                   configRevision=self.config.active.revision, state='pending')
                        cx.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', ('scope_refresh:' + parts[1], canonical(job)))
                        answer = dict(id=parts[1], refreshId=job['id'], state='pending')
                        status = 202
                    else:
                        raise DomainError('NOT_FOUND', status=404)
                self.store.db.execute('INSERT INTO controls VALUES(?,?,?,?,?)', (path, key, fingerprint, canonical(answer), status))
            return status, answer

    def handler(self):
        controller = self
        class Handler(BaseHTTPRequestHandler):
            server_version = 'VideoBenchmark/1'
            def log_message(self, *args):
                pass

            def respond(self, status, value):
                csv = isinstance(value, bytes)
                payload = value if csv else canonical(controller.config.active.secrets.clean(value)).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'text/csv; charset=utf-8' if csv else 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(payload)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                if csv or urlsplit(self.path).path.endswith('/export.json') or urlsplit(self.path).path.endswith('/results.json'):
                    filename = urlsplit(self.path).path.rsplit('/', 1)[-1]
                    self.send_header('Content-Disposition', 'attachment; filename="' + filename + '"')
                    self.send_header('ETag', '"' + hashlib.sha256(payload).hexdigest() + '"')
                self.end_headers()
                self.wfile.write(payload)

            def handle_request(self, mutation=False):
                try:
                    # Also reject Host rebinding; no wildcard CORS or unauthenticated reads of results.
                    host = self.headers.get('Host', '').split(':')[0]
                    if host not in {'127.0.0.1', 'localhost'}:
                        raise DomainError('ORIGIN_REJECTED', status=403)
                    parsed = urlsplit(self.path)
                    if not parsed.path.startswith('/api/v1/'):
                        raise DomainError('NOT_FOUND', status=404)
                    path = unquote(parsed.path[len('/api/v1'):])
                    if not (path == '/health' and not mutation):
                        auth = self.headers.get('Authorization', '')
                        if not hmac.compare_digest(auth, 'Bearer ' + controller.token):
                            raise DomainError('UNAUTHORIZED', status=401)
                    if mutation:
                        with controller.write_lock:
                            now = time.monotonic()
                            controller.rate['mutations'] = [t for t in controller.rate.get('mutations', []) if now - t < 60]
                            if len(controller.rate['mutations']) >= 120:
                                raise DomainError('CONTROL_RATE_LIMIT', status=429, retryable=True, wait=60)
                            controller.rate['mutations'].append(now)
                        if self.headers.get('Origin') != controller.origin:
                            raise DomainError('ORIGIN_REJECTED', status=403)
                        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                            raise DomainError('CONTENT_TYPE_INVALID', status=400)
                        key = self.headers.get('Idempotency-Key', '')
                        if not 1 <= len(key) <= 200:
                            raise DomainError('IDEMPOTENCY_KEY_REQUIRED', status=400)
                        size = int(self.headers.get('Content-Length', '0'))
                        if size <= 0 or size > 1024 * 1024:
                            raise DomainError('MALFORMED_INPUT', status=400)
                        body = json.loads(self.rfile.read(size))
                        if not isinstance(body, dict):
                            raise DomainError('MALFORMED_INPUT', status=400)
                        status, result = controller.mutate(path, body, key)
                        self.respond(status, result)
                    else:
                        self.respond(200, controller.get(path, parse_qs(parsed.query)))
                except DomainError as e:
                    self.respond(e.status, {'error': {**e.issue(), 'requestId': identifier('req')}})
                except (ValueError, TypeError, KeyError):
                    self.respond(400, {'error': {**DomainError('MALFORMED_INPUT').issue(), 'requestId': identifier('req')}})
                except Exception:
                    self.respond(503, {'error': {**DomainError('INFRA_FAILURE').issue(), 'requestId': identifier('req')}})

            def do_GET(self):
                self.handle_request()

            def do_POST(self):
                self.handle_request(True)
        return Handler

    def server(self, port=8890):
        server = ThreadingHTTPServer(('127.0.0.1', port), self.handler())
        server.daemon_threads = True
        return server
