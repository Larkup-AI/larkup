from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path

from .adapters import Context, adapters
from .common import DomainError, canonical, identifier, utc
from .scoring import decision, export
from .transport import HTTP


class Scheduler:
    def __init__(self, store, config, root: Path, package: Path, *, implementations=None, http=None):
        self.store, self.config, self.root, self.package = store, config, root, package
        self.adapters = implementations or adapters(package)
        self.http = http or HTTP()
        self.owner = identifier('controller')
        self.inflight: dict[str, asyncio.Task] = {}
        self.last_fair: tuple | None = None
        self.last_kind = 'answer'
        self.stopping = False
        self.last_backup = 0.0
        self.refreshes = {}

    async def refresh_scope(self, key, job, snapshot):
        route, scope = job['route'], job['scopeId']
        alias = route['secretAlias']
        credential = snapshot.secrets.get(alias)
        header = 'x-goog-api-key' if route['provider'] == 'gemini' else 'x-api-key' if route['provider'] == 'twelvelabs' else 'Authorization'
        headers = {header: credential if header != 'Authorization' else 'Bearer ' + credential,
                   'X-Benchmark-Account': alias}
        url = ('https://ai-gateway.vercel.sh/v1/credits' if route['provider'] == 'gateway' else
               'https://api.twelvelabs.io/v1.3/indexes?page_limit=1' if route['provider'] == 'twelvelabs' else route['endpoint'] + '/models')
        try:
            response = await self.http.request('GET', url, headers=headers, timeout=25)
            payload = response.json()
            balance = payload.get('balance') if route['provider'] == 'gateway' else None
            if balance is not None:
                from decimal import Decimal
                balance = str(Decimal(str(balance)))
            with self.store.transaction() as cx:
                cx.execute('INSERT OR IGNORE INTO provider_scopes(id) VALUES(?)', (scope,))
                cx.execute("UPDATE provider_scopes SET balance=COALESCE(?,balance),state=?,issue=NULL WHERE id=?",
                           (balance, 'credit_exhausted' if balance is not None and __import__('decimal').Decimal(balance) <= 0 else 'healthy', scope))
                job.update(state='completed', observedAt=utc(), balance=balance,
                           quotaHeaders={k: v for k, v in response.headers.items() if 'ratelimit' in k.lower() or k.lower() == 'retry-after'})
                cx.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', (key, canonical(job)))
                self.store.event(cx, 'quota.updated', None, {'scopeId': scope, 'observedAt': job['observedAt']})
        except DomainError as error:
            with self.store.transaction() as cx:
                cx.execute('INSERT OR IGNORE INTO provider_scopes(id) VALUES(?)', (scope,))
                if error.code in {'AUTH_INVALID', 'CREDIT_EXHAUSTED', 'MODEL_UNAVAILABLE'}:
                    cx.execute('UPDATE provider_scopes SET state=?,issue=? WHERE id=?',
                               ({'AUTH_INVALID': 'auth_invalid', 'CREDIT_EXHAUSTED': 'credit_exhausted', 'MODEL_UNAVAILABLE': 'disabled'}[error.code], canonical(error.issue(scope)), scope))
                elif error.code == 'QUOTA_WAIT':
                    cx.execute('UPDATE provider_scopes SET cooldown_until=?,issue=? WHERE id=?', (time.time() + (error.wait or 60), canonical(error.issue(scope)), scope))
                job.update(state='failed', issue=error.issue(scope))
                cx.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', (key, canonical(job)))
                self.store.event(cx, 'quota.updated', None, {'scopeId': scope, 'issue': error.issue(scope)})

    def route(self, task: dict, snapshot) -> tuple[str, dict] | None:
        variant = json.loads(self.store.one('SELECT document FROM variants WHERE run_id=? AND id=?', (task['run_id'], task['variant_id']))['document'])
        candidates = variant['routes']
        affinity = None
        if task['depends_on']:
            prepared = self.store.one('SELECT output FROM tasks WHERE id=?', (task['depends_on'],))
            affinity = json.loads(prepared['output'] or '{}').get('accountAlias')
        for rid in candidates:
            r = snapshot.config['routes'].get(rid)
            if not r or not r.get('enabled', True) or r['logicalModel'] != variant['logicalModel']:
                continue
            # Gemini/TwelveLabs assets are scoped to the account that uploaded them.
            if affinity and variant['adapter'] in {'gemini', 'twelvelabs'} and r['secretAlias'] != affinity:
                continue
            scopes = self.store.rows('SELECT * FROM provider_scopes WHERE id=?', (r['scopeId'],))
            if scopes and (scopes[0]['state'] != 'healthy' or (scopes[0]['balance'] is not None and __import__('decimal').Decimal(str(scopes[0]['balance'])) <= 0) or scopes[0]['cooldown_until'] > time.time()):
                continue
            exhausted = self.store.rows("""SELECT 1 FROM provider_scopes s JOIN attempts a ON a.scope_id=s.id
              WHERE s.state='credit_exhausted' AND json_extract(a.route,'$.secretAlias')=?
              AND json_extract(a.route,'$.provider')=? LIMIT 1""", (r['secretAlias'], r['provider']))
            if exhausted:
                continue
            if task['kind'] == 'prepare' and variant['adapter'] in {'larkup', 'retrieval'}:
                # The answer model is not called by indexing. Keep its admission slot available
                # to native QA while the separately bounded GPU/role pipeline indexes.
                r = {**r, 'scopeId': r['scopeId'] + ':canonical-index'}
            return rid, r
        return None

    def capacity(self, task: dict, snapshot) -> bool:
        limits = snapshot.config['limits']
        if len(self.inflight) >= limits['global']:
            return False
        variant = json.loads(self.store.one('SELECT document FROM variants WHERE run_id=? AND id=?', (task['run_id'], task['variant_id']))['document'])
        kind = 'gpu' if (task['kind'] == 'prepare' and variant['adapter'] in {'larkup', 'retrieval'}) else 'cpu' if task['kind'] == 'prepare' and variant['adapter'] == 'qwen' else 'upload' if task['kind'] == 'prepare' else 'qa'
        busy = 0
        for tid in self.inflight:
            other = self.store.one('SELECT kind,variant_id,run_id FROM tasks WHERE id=?', (tid,))
            ov = json.loads(self.store.one('SELECT document FROM variants WHERE run_id=? AND id=?', (other['run_id'], other['variant_id']))['document'])
            if variant['adapter'] in {'larkup', 'retrieval'} and ov['adapter'] in {'larkup', 'retrieval'}:
                return False
            ok = 'gpu' if other['kind'] == 'prepare' and ov['adapter'] in {'larkup', 'retrieval'} else 'cpu' if other['kind'] == 'prepare' and ov['adapter'] == 'qwen' else 'upload' if other['kind'] == 'prepare' else 'qa'
            busy += ok == kind
        return busy < limits[kind]

    async def perform(self, task: dict, attempt: dict, snapshot, resume=None):
        c = Context(self.store, task, attempt, snapshot, self.root, self.http, resume)
        try:
            adapter = self.adapters[c.variant['adapter']]
            start = time.monotonic()
            if task['kind'] == 'prepare':
                output = await asyncio.wait_for(adapter.prepare(c), timeout=snapshot.config['limits']['deadlineSeconds'])
                output['accountAlias'] = c.route['secretAlias']
            else:
                question = json.loads(self.store.one('SELECT document FROM questions WHERE run_id=? AND id=?', (task['run_id'], task['question_id']))['document'])
                prepared = json.loads(self.store.one('SELECT output FROM tasks WHERE id=?', (task['depends_on'],))['output'])
                output = await asyncio.wait_for(adapter.answer(c, question, prepared), timeout=snapshot.config['limits']['deadlineSeconds'])
                elapsed = (time.monotonic() - start) * 1000
                started_wall = __import__('datetime').datetime.fromisoformat(attempt['started_at'].replace('Z', '+00:00')).timestamp()
                ready_wall = task.get('ready_at') or started_wall
                queued = max(0, (started_wall - ready_wall) * 1000)
                previous = self.store.one("""SELECT count(*) n FROM tasks WHERE run_id=? AND source_id=?
                  AND variant_id=? AND kind='answer' AND state='completed'""",
                                          (task['run_id'], task['source_id'], task['variant_id']))['n']
                prep_timing = prepared.get('timing', {})
                prep_ms = sum(prep_timing.get(k) or 0 for k in ('prepareMs', 'uploadMs', 'indexMs'))
                output.setdefault('timing', {}).update(answerMs=elapsed, queueMs=queued, endToEndMs=queued + elapsed,
                                                       inputReuse=bool(previous) or prepared.get('reused', False),
                                                       coldFirstAnswerMs=prep_ms + elapsed if not previous and not prepared.get('reused') else None)
                output.setdefault('resolvedModel', c.route['model'])
            self.store.finish(task, attempt, snapshot.secrets.clean(output))
        except asyncio.CancelledError:
            self.store.fail(task, attempt, DomainError('REMOTE_OUTCOME_UNKNOWN', unknown=True), snapshot.config['limits']['attempts'])
            raise
        except asyncio.TimeoutError:
            self.store.fail(task, attempt, DomainError('REMOTE_OUTCOME_UNKNOWN', unknown=True), snapshot.config['limits']['attempts'])
        except DomainError as e:
            self.store.fail(task, attempt, e, snapshot.config['limits']['attempts'])
            self.store.usage(attempt['id'], dict(operation='unsuccessful_attempt', currency='USD', actual=None,
                                               estimated=None, unknownReason=e.code, provider=c.route['provider']))
        except Exception:
            # No raw exceptions, upstream payloads, URLs, or keys enter state/events/logs.
            self.store.fail(task, attempt, DomainError('INFRA_FAILURE'), snapshot.config['limits']['attempts'])

    async def tick(self):
        for key, future in list(self.refreshes.items()):
            if future.done():
                future.result()
                self.refreshes.pop(key)
        for row in self.store.rows("SELECT * FROM settings WHERE key LIKE 'scope_refresh:%'"):
            job = json.loads(row['value'])
            if job['state'] == 'pending' and row['key'] not in self.refreshes and len(self.refreshes) < 2:
                self.refreshes[row['key']] = asyncio.create_task(self.refresh_scope(row['key'], job, self.config.active))
        for tid, future in list(self.inflight.items()):
            if future.done():
                try:
                    future.result()
                except asyncio.CancelledError:
                    pass
                self.inflight.pop(tid)
        snapshot = self.config.active
        self.store.save_config(snapshot)
        ready = self.store.ready()
        def group(t):
            source = json.loads(self.store.one('SELECT document FROM sources WHERE run_id=? AND id=?', (t['run_id'], t['source_id']))['document'])
            return t['variant_id'], source.get('durationGroup', ''), t['source_id']
        # Rotate across provider, duration, and source groups after each accepted dispatch.
        grouped = {}
        for t in ready:
            grouped.setdefault(group(t), []).append(t)
        keys = sorted(grouped)
        if self.last_fair in keys:
            i = keys.index(self.last_fair) + 1
            keys = keys[i:] + keys[:i]
        preferred = 'answer' if self.last_kind == 'prepare' else 'prepare'
        keys.sort(key=lambda key: not any(t['kind'] == preferred for t in grouped[key]))
        for key in keys:
            for task in grouped[key]:
                if not self.capacity(task, snapshot) or task['id'] in self.inflight:
                    continue
                uncertain = self.store.rows('''SELECT 1 FROM attempts a JOIN tasks t ON t.id=a.task_id
                  WHERE t.run_id=? AND t.source_id=? AND t.variant_id=? AND a.state='unknown' LIMIT 1''',
                                            (task['run_id'], task['source_id'], task['variant_id']))
                if uncertain:
                    # One failed input transport is enough: do not pay for sibling questions
                    # against the same source until its accepted outcome is reconciled.
                    with self.store.transaction() as cx:
                        cx.execute("UPDATE tasks SET state='blocked',issue=? WHERE id=?",
                                   (canonical(DomainError('REMOTE_OUTCOME_UNKNOWN', unknown=True).issue()), task['id']))
                        self.store.event(cx, 'task.updated', task['run_id'], {'taskId': task['id'], 'state': 'blocked'})
                    continue
                selected = self.route(task, snapshot)
                if not selected:
                    # A cooling route may become eligible again; exhaustion/auth are persistent.
                    variant = json.loads(self.store.one('SELECT document FROM variants WHERE run_id=? AND id=?', (task['run_id'], task['variant_id']))['document'])
                    cooldowns = [s['cooldown_until'] for rid in variant['routes']
                                 if rid in snapshot.config['routes']
                                 for s in self.store.rows('SELECT * FROM provider_scopes WHERE id=?', (snapshot.config['routes'][rid]['scopeId'],))
                                 if s['state'] == 'healthy' and s['cooldown_until'] > time.time()]
                    with self.store.transaction() as cx:
                        state = 'waiting_quota' if cooldowns else 'blocked'
                        issue = canonical(DomainError('QUOTA_WAIT' if cooldowns else 'NO_ELIGIBLE_ROUTE').issue())
                        cx.execute('UPDATE tasks SET state=?,issue=?,eligible_at=? WHERE id=?', (state, issue, min(cooldowns) if cooldowns else 0, task['id']))
                        self.store.event(cx, 'task.updated', task['run_id'], {'taskId': task['id'], 'state': state})
                    continue
                rid, route = selected
                attempt = self.store.lease(task, snapshot, rid, route, self.owner)
                if attempt:
                    self.last_fair = key
                    self.last_kind = task['kind']
                    self.inflight[task['id']] = asyncio.create_task(self.perform(task, attempt, snapshot))
                    break
        for r in self.store.rows("SELECT id,state FROM runs WHERE state NOT IN ('draft','completed','failed','cancelled')"):
            self.store.settle(r['id'])
            current = self.store.snapshot(r['id'])
            if current['state'] == 'blocked' and current['decision'] == 'not_evaluated':
                d, _ = decision(self.store, r['id'])
                with self.store.transaction() as cx:
                    cx.execute('UPDATE runs SET decision=? WHERE id=?', (d, r['id']))
                export(self.store, r['id'], self.package / 'benchmarks/results/multimodal/video-understanding/data/runs' / r['id'])
            unfinished = self.store.one("SELECT count(*) n FROM tasks WHERE run_id=? AND state!='completed'", (r['id'],))['n']
            if not unfinished and r['state'] == 'running':
                d, _ = decision(self.store, r['id'])
                with self.store.transaction() as cx:
                    cx.execute('UPDATE runs SET decision=? WHERE id=?', (d, r['id']))
                target = self.package / 'benchmarks/results/multimodal/video-understanding/data/runs' / r['id']
                export(self.store, r['id'], target)
                with self.store.transaction() as cx:
                    cx.execute("UPDATE runs SET state='completed' WHERE id=?", (r['id'],))
                    self.store.event(cx, 'export.ready', r['id'], {'checksum': __import__('hashlib').sha256((target / 'results.csv').read_bytes()).hexdigest()})
        if time.monotonic() - self.last_backup > 60:
            self.store.backup(self.root / 'state' / 'backup.sqlite3')
            self.last_backup = time.monotonic()

    async def run(self, *, until_idle=False):
        # File locking prevents a second controller from recovering leases owned by a live process.
        import fcntl
        lock = (self.root / 'state/controller.lock').open('a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock.close()
            raise DomainError('CONTROLLER_ALREADY_RUNNING') from None
        try:
            for task in self.store.recover():
                attempt = self.store.one('SELECT * FROM attempts WHERE id=?', (task['current_attempt'],))
                handle = json.loads(self.store.one('SELECT document FROM remote_handles WHERE attempt_id=?', (attempt['id'],))['document'])
                # Recover with the original immutable profile and current secret file, never mutate prior output.
                from .config import Snapshot
                document = self.store.one('SELECT document FROM config_revisions WHERE id=?', (attempt['config_revision'],))['document']
                snapshot = Snapshot(attempt['config_revision'], document, self.config.active.secrets)
                self.inflight[task['id']] = asyncio.create_task(self.perform(task, attempt, snapshot, resume=handle))
            while not self.stopping:
                await self.tick()
                active = self.store.rows("SELECT id FROM runs WHERE state IN ('running','pausing','cancelling')")
                if until_idle and not active and not self.inflight:
                    break
                await asyncio.sleep(.15)
        finally:
            # Pause is a drain; shutdown never throws away in-flight paid calls.
            if self.inflight:
                await asyncio.gather(*self.inflight.values(), return_exceptions=True)
            self.store.backup(self.root / 'state' / 'backup.sqlite3')
            fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()
