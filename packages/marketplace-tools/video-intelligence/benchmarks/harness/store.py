from __future__ import annotations

import contextlib
import json
import os
import sqlite3
import threading
import time
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterator

from .common import DomainError, canonical, digest, identifier, utc

SCHEMA = '''
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS config_revisions(id TEXT PRIMARY KEY, document TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, phase TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'draft', decision TEXT NOT NULL DEFAULT 'not_evaluated', document TEXT NOT NULL,
 config_revision TEXT NOT NULL, started_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources(run_id TEXT NOT NULL, id TEXT NOT NULL, document TEXT NOT NULL,
 PRIMARY KEY(run_id,id), FOREIGN KEY(run_id) REFERENCES runs(id));
CREATE TABLE IF NOT EXISTS questions(run_id TEXT NOT NULL, id TEXT NOT NULL, source_id TEXT NOT NULL,
 document TEXT NOT NULL, gold TEXT NOT NULL, PRIMARY KEY(run_id,id));
CREATE TABLE IF NOT EXISTS variants(run_id TEXT NOT NULL, id TEXT NOT NULL, document TEXT NOT NULL,
 PRIMARY KEY(run_id,id));
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, source_id TEXT NOT NULL,
 question_id TEXT NOT NULL DEFAULT '', variant_id TEXT NOT NULL, kind TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', depends_on TEXT REFERENCES tasks(id), attempt_count INTEGER NOT NULL DEFAULT 0,
 eligible_at REAL NOT NULL DEFAULT 0, lease_until REAL, lease_owner TEXT, current_attempt TEXT,
 output TEXT, issue TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(run_id,source_id,question_id,variant_id,kind));
CREATE INDEX IF NOT EXISTS tasks_dispatch ON tasks(state,eligible_at,run_id);
CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
 config_revision TEXT NOT NULL, route_id TEXT NOT NULL, route TEXT NOT NULL, scope_id TEXT NOT NULL,
 state TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, output TEXT, issue TEXT);
CREATE TABLE IF NOT EXISTS remote_handles(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
 provider TEXT NOT NULL, document TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provider_scopes(id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'healthy',
 cooldown_until REAL NOT NULL DEFAULT 0, balance TEXT, window_start REAL NOT NULL DEFAULT 0,
 requests INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0,
 day_start INTEGER NOT NULL DEFAULT 0, processing_seconds REAL NOT NULL DEFAULT 0,
 concurrency INTEGER NOT NULL DEFAULT 1, successes INTEGER NOT NULL DEFAULT 0, issue TEXT);
CREATE TABLE IF NOT EXISTS usage_events(id TEXT PRIMARY KEY, attempt_id TEXT REFERENCES attempts(id),
 run_id TEXT, recorded_at TEXT NOT NULL, document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
 document TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evaluations(attempt_id TEXT PRIMARY KEY, revision TEXT NOT NULL,
 predicted_option TEXT, correct INTEGER, issue TEXT);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT,
 type TEXT NOT NULL, occurred_at TEXT NOT NULL, revision TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS controls(scope TEXT NOT NULL, key TEXT NOT NULL, body_hash TEXT NOT NULL,
 response TEXT NOT NULL, status INTEGER NOT NULL, PRIMARY KEY(scope,key));
'''


class Store:
    def __init__(self, path: Path, *, readonly=False):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = path
        self.lock = threading.RLock()
        self.readonly = readonly
        self.db = sqlite3.connect('file:' + str(path) + '?mode=ro&immutable=1' if readonly else path, uri=readonly,
                                  check_same_thread=False, timeout=30, isolation_level=None)
        self.build_revision = digest({str(p.relative_to(Path(__file__).parent)): __import__('hashlib').sha256(p.read_bytes()).hexdigest()
                                      for p in sorted(Path(__file__).parent.rglob('*'))
                                      if p.is_file() and p.suffix in {'.py', '.mjs', '.sql', '.sh'}})
        self.db.row_factory = sqlite3.Row
        if readonly:
            return
        os.chmod(path, 0o600)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(SCHEMA)
        self.db.execute('INSERT OR IGNORE INTO schema_migrations VALUES(1,?)', (utc(),))
        with self.transaction() as cx:
            for migration in sorted((Path(__file__).parent / 'migrations').glob('*.sql')):
                version = int(migration.name.split('_')[0])
                if not cx.execute('SELECT 1 FROM schema_migrations WHERE version=?', (version,)).fetchone():
                    for statement in migration.read_text().split(';'):
                        if statement.strip():
                            cx.execute(statement)
                    cx.execute('INSERT INTO schema_migrations VALUES(?,?)', (version, utc()))
        self.build_revision = digest({str(p.relative_to(Path(__file__).parent)): __import__('hashlib').sha256(p.read_bytes()).hexdigest()
                                      for p in sorted(Path(__file__).parent.rglob('*'))
                                      if p.is_file() and p.suffix in {'.py', '.mjs', '.sql', '.sh'}})

    @contextlib.contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        if self.readonly:
            raise DomainError('OFFLINE_READONLY', status=409)
        with self.lock:
            if self.db.in_transaction:
                name = 'nested_' + identifier('save').replace('-', '_')
                self.db.execute('SAVEPOINT ' + name)
                try:
                    yield self.db
                    self.db.execute('RELEASE SAVEPOINT ' + name)
                except BaseException:
                    self.db.execute('ROLLBACK TO SAVEPOINT ' + name)
                    self.db.execute('RELEASE SAVEPOINT ' + name)
                    raise
                return
            self.db.execute('BEGIN IMMEDIATE')
            try:
                yield self.db
                self.db.execute('COMMIT')
            except BaseException:
                self.db.execute('ROLLBACK')
                raise

    def rows(self, query: str, args: tuple = ()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.db.execute(query, args)]

    def one(self, query: str, args: tuple = ()) -> dict:
        rows = self.rows(query, args)
        if not rows:
            raise DomainError('NOT_FOUND', status=404)
        return rows[0]

    def event(self, cx: sqlite3.Connection, kind: str, run: str | None, data: dict) -> None:
        rev = None
        if run:
            cx.execute('UPDATE runs SET revision=revision+1,updated_at=? WHERE id=?', (utc(), run))
            row = cx.execute('SELECT revision FROM runs WHERE id=?', (run,)).fetchone()
            rev = str(row[0]) if row else None
        cx.execute('INSERT INTO events(run_id,type,occurred_at,revision,data) VALUES(?,?,?,?,?)',
                   (run, kind, utc(), rev, canonical(data)))

    def save_config(self, snapshot: Any) -> None:
        with self.transaction() as cx:
            cx.execute('INSERT OR IGNORE INTO config_revisions VALUES(?,?,?)',
                       (snapshot.revision, snapshot.document, utc()))

    def create(self, manifest: dict, variant_ids: list[str], snapshot: Any,
               phase: str = 'pilot', protocol_revision: str = 'pilot-v1') -> dict:
        if phase not in {'smoke', 'pilot', 'publication', 'ablation'}:
            raise DomainError('CONFIG_INVALID')
        if not variant_ids or len(set(variant_ids)) != len(variant_ids):
            raise DomainError('CONFIG_INVALID')
        variants = snapshot.config['variants']
        if any(v not in variants for v in variant_ids):
            raise DomainError('CONFIG_INVALID')
        if not manifest.get('sources') or not manifest.get('questions') or not manifest.get('protocol'):
            raise DomainError('MANIFEST_INVALID')
        if phase == 'publication':
            parents = self.rows("SELECT id FROM runs WHERE phase='pilot' AND decision='continue'")
            if not parents:
                raise DomainError('PILOT_GATE_REQUIRED')
        run, now = identifier('run'), utc()
        self.save_config(snapshot)
        with self.transaction() as cx:
            doc = dict(protocolRevision=protocol_revision, datasetManifestId=manifest['id'],
                       manifestHash=digest(manifest), protocol=manifest['protocol'], variantIds=variant_ids,
                       harnessRevision=self.build_revision)
            cx.execute('INSERT INTO runs(id,phase,document,config_revision,updated_at) VALUES(?,?,?,?,?)',
                       (run, phase, canonical(doc), snapshot.revision, now))
            for s in manifest['sources']:
                from pathlib import PurePosixPath
                source_path = PurePosixPath(s.get('path', ''))
                if not isinstance(s.get('durationMs'), (int, float)) or s['durationMs'] <= 0 or source_path.is_absolute() or '..' in source_path.parts:
                    raise DomainError('SOURCE_ADMISSION_REQUIRED')
                cx.execute('INSERT INTO sources VALUES(?,?,?)', (run, s['id'], canonical(s)))
            source_ids = {s['id'] for s in manifest['sources']}
            for q in manifest['questions']:
                if q['sourceId'] not in source_ids or q.get('correctOption') not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[:len(q['options'])]:
                    raise DomainError('MANIFEST_INVALID')
                public = {k: v for k, v in q.items() if k not in {'correctOption', 'goldEvidence', 'answer'}}
                cx.execute('INSERT INTO questions VALUES(?,?,?,?,?)',
                           (run, q['id'], q['sourceId'], canonical(public), q['correctOption']))
            for vid in variant_ids:
                cx.execute('INSERT INTO variants VALUES(?,?,?)', (run, vid, canonical(variants[vid])))
                for sid in source_ids:
                    allowed_questions = manifest['protocol'].get('variantQuestionIds', {}).get(vid)
                    selected_questions = [q for q in manifest['questions'] if q['sourceId'] == sid and
                                          (allowed_questions is None or q['id'] in allowed_questions)]
                    if not selected_questions:
                        continue
                    prep = identifier('task')
                    cx.execute('INSERT INTO tasks(id,run_id,source_id,variant_id,kind,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                               (prep, run, sid, vid, 'prepare', now, now))
                    for q in selected_questions:
                        if q['sourceId'] == sid:
                            cx.execute('INSERT INTO tasks(id,run_id,source_id,question_id,variant_id,kind,depends_on,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
                                       (identifier('task'), run, sid, q['id'], vid, 'answer', prep, now, now))
            self.event(cx, 'run.updated', run, {'state': 'draft'})
        return self.snapshot(run)

    def control(self, run: str, action: str, expected: str) -> dict:
        with self.transaction() as cx:
            r = cx.execute('SELECT * FROM runs WHERE id=?', (run,)).fetchone()
            if not r:
                raise DomainError('NOT_FOUND', status=404)
            if str(r['revision']) != str(expected):
                raise DomainError('REVISION_CONFLICT', status=409)
            allowed = {'start': {'draft'}, 'resume': {'paused', 'blocked'},
                       'pause': {'running', 'blocked'}, 'cancel': {'draft', 'running', 'paused', 'pausing', 'blocked'}}
            if action not in allowed or r['state'] not in allowed[action]:
                raise DomainError('STATE_CONFLICT', status=409)
            state = {'start': 'running', 'resume': 'running', 'pause': 'pausing', 'cancel': 'cancelling'}[action]
            cx.execute('UPDATE runs SET state=?,started_at=COALESCE(started_at,?) WHERE id=?', (state, utc(), run))
            if action == 'cancel':
                cx.execute("UPDATE tasks SET state='cancelled' WHERE run_id=? AND state IN ('pending','ready','waiting_quota','blocked')", (run,))
            if action == 'resume':
                # Only known rejection/dependency blockers are safe to admit again. Unknown paid outcomes
                # require handle reconciliation and are never retried by a resume click.
                cx.execute("""UPDATE tasks SET state='pending',issue=NULL,eligible_at=0 WHERE run_id=? AND state='blocked'
                  AND json_extract(issue,'$.code') IN ('NO_ELIGIBLE_ROUTE','DEPENDENCY_BLOCKED','AUTH_INVALID','CREDIT_EXHAUSTED','MODEL_UNAVAILABLE','REMOTE_OUTCOME_UNKNOWN','CANONICAL_ASR_FAILED')
                  AND (current_attempt IS NULL OR NOT EXISTS(SELECT 1 FROM attempts a WHERE a.id=tasks.current_attempt AND a.state='unknown'))
                  AND NOT EXISTS(SELECT 1 FROM attempts a JOIN tasks sibling ON sibling.id=a.task_id
                    WHERE sibling.run_id=tasks.run_id AND sibling.source_id=tasks.source_id
                      AND sibling.variant_id=tasks.variant_id AND a.state='unknown')""", (run,))
            self.event(cx, 'run.updated', run, {'state': state})
        self.settle(run)
        return self.snapshot(run)

    def snapshot(self, run: str) -> dict:
        r = self.one('SELECT * FROM runs WHERE id=?', (run,))
        doc = json.loads(r['document'])
        counts = {x['state']: x['n'] for x in self.rows('SELECT state,count(*) n FROM tasks WHERE run_id=? GROUP BY state', (run,))}
        pairs = self.rows("SELECT question_id,count(*) n FROM tasks WHERE run_id=? AND kind='answer' AND state='completed' GROUP BY question_id", (run,))
        planned = self.one('SELECT count(*) n FROM questions WHERE run_id=?', (run,))['n']
        variants = len(doc['variantIds'])
        core = doc['protocol'].get('coreVariantIds', doc['variantIds'])
        core_pairs = self.rows("SELECT question_id,variant_id FROM tasks WHERE run_id=? AND kind='answer' AND state='completed'", (run,))
        completed_core = {}
        for p in core_pairs:
            completed_core.setdefault(p['question_id'], set()).add(p['variant_id'])
        blockers = [json.loads(x['issue']) for x in self.rows("SELECT DISTINCT issue FROM tasks WHERE run_id=? AND issue IS NOT NULL AND state IN ('blocked','waiting_quota','failed')", (run,))]
        cursor = self.one('SELECT COALESCE(max(id),0) n FROM events')['n']
        return dict(id=run, revision=str(r['revision']), phase=r['phase'], state=r['state'],
                    decision=r['decision'], protocolRevision=doc['protocolRevision'],
                    datasetManifestId=doc['datasetManifestId'], configRevision=r['config_revision'],
                    startedAt=r['started_at'], updatedAt=r['updated_at'], taskCounts=counts,
                    coverage=dict(plannedQuestions=planned, plannedVariants=variants,
                                  completedPairs=sum(x['n'] for x in pairs),
                                  sharedCompletedQuestions=sum(set(core) <= v for v in completed_core.values())),
                    cost=self.cost(run), blockers=blockers, eventCursor=str(cursor))

    def cost(self, run: str, attempt: str | None = None, *, variant: str | None = None,
             task: str | None = None, kind: str | None = None) -> dict:
        from decimal import Decimal
        query = '''SELECT u.attempt_id,u.document,r.actual override FROM usage_events u
          JOIN attempts a ON a.id=u.attempt_id JOIN tasks t ON t.id=a.task_id
          LEFT JOIN usage_reconciliations r ON r.usage_id=u.id WHERE u.run_id=?'''
        args = [run]
        for column, value in [('u.attempt_id', attempt), ('t.variant_id', variant), ('t.id', task), ('t.kind', kind)]:
            if value is not None:
                query += ' AND ' + column + '=?'
                args.append(value)
        records = self.rows(query, tuple(args))
        entries = [json.loads(x['document']) for x in records]
        for record, entry in zip(records, entries):
            if record['override'] is not None:
                entry['actual'] = record['override']
        actual = [Decimal(e['actual']) for e in entries if e.get('actual') is not None]
        estimate = [Decimal(e['estimated']) for e in entries if e.get('estimated') is not None]
        unknown = len({record['attempt_id'] for record, e in zip(records, entries) if e.get('actual') is None})
        return dict(currency='USD', actual=str(sum(actual)) if actual else None,
                    estimated=str(sum(estimate)) if estimate else None,
                    unknownAttemptCount=unknown, reconciled=bool(entries) and not unknown)

    def reconcile_usage(self, records: list[dict]) -> None:
        from decimal import Decimal, InvalidOperation
        with self.transaction() as cx:
            for entry in records:
                try:
                    amount = Decimal(entry['actualUsd'])
                    if not amount.is_finite() or amount < 0 or not isinstance(entry['provenance'], str) or not entry['provenance'].strip():
                        raise ValueError()
                except (KeyError, TypeError, InvalidOperation, ValueError):
                    raise DomainError('USAGE_RECONCILIATION_INVALID') from None
                usage = cx.execute('SELECT * FROM usage_events WHERE id=?', (entry['usageEventId'],)).fetchone()
                if not usage:
                    raise DomainError('NOT_FOUND', status=404)
                old = cx.execute('SELECT * FROM usage_reconciliations WHERE usage_id=?', (entry['usageEventId'],)).fetchone()
                if old and (old['actual'] != str(amount) or old['provenance'] != entry['provenance']):
                    raise DomainError('RECONCILIATION_CONFLICT', status=409)
                cx.execute('INSERT OR IGNORE INTO usage_reconciliations VALUES(?,?,?,?)',
                           (entry['usageEventId'], str(amount), entry['provenance'], utc()))
                self.event(cx, 'usage.updated', usage['run_id'], {'usageEventId': entry['usageEventId'], 'reconciled': True})

    def refresh_ready(self, cx: sqlite3.Connection) -> None:
        cx.execute("""UPDATE tasks SET state='ready',ready_at=? WHERE state IN ('pending','waiting_quota') AND eligible_at<=?
         AND (depends_on IS NULL OR EXISTS(SELECT 1 FROM tasks parent WHERE parent.id=tasks.depends_on AND parent.state='completed'))
         AND run_id IN (SELECT id FROM runs WHERE state='running')""", (time.time(), time.time()))
        cx.execute("""UPDATE tasks SET state='blocked',issue=? WHERE state IN ('pending','ready') AND EXISTS
         (SELECT 1 FROM tasks parent WHERE parent.id=tasks.depends_on AND parent.state IN ('blocked','failed','cancelled'))""",
                   (canonical(DomainError('DEPENDENCY_BLOCKED').issue()),))

    def ready(self) -> list[dict]:
        with self.transaction() as cx:
            self.refresh_ready(cx)
        return self.rows("""SELECT t.* FROM tasks t JOIN runs r ON r.id=t.run_id WHERE r.state='running'
          AND t.state='ready' ORDER BY t.attempt_count,t.created_at,t.id""")

    def lease(self, task: dict, snapshot: Any, rid: str, route: dict, owner: str) -> dict | None:
        now = time.time()
        with self.transaction() as cx:
            eligible = cx.execute("SELECT 1 FROM tasks t JOIN runs r ON r.id=t.run_id WHERE t.id=? AND t.state='ready' AND r.state='running'", (task['id'],)).fetchone()
            if not eligible:
                return None
            scope = route['scopeId']
            cx.execute('INSERT OR IGNORE INTO provider_scopes(id,balance,concurrency) VALUES(?,?,?)',
                       (scope, route.get('balance'), route.get('concurrency', 1)))
            s = dict(cx.execute('SELECT * FROM provider_scopes WHERE id=?', (scope,)).fetchone())
            if s['state'] in {'credit_exhausted', 'auth_invalid', 'disabled'} or s['cooldown_until'] > now or (s['balance'] is not None and Decimal(str(s['balance'])) <= 0):
                return None
            active = cx.execute("SELECT count(*) FROM attempts WHERE scope_id=? AND state IN ('leased','submitted','running')", (scope,)).fetchone()[0]
            if active >= min(route.get('concurrency', 1), s['concurrency']):
                return None
            if now - s['window_start'] >= 60:
                s.update(window_start=now, requests=0, tokens=0)
            if int(now // 86400) != s['day_start']:
                s.update(day_start=int(now // 86400), processing_seconds=0)
            source = json.loads(cx.execute('SELECT document FROM sources WHERE run_id=? AND id=?', (task['run_id'], task['source_id'])).fetchone()[0])
            seconds = source.get('durationMs', 0) / 1000
            tokens = max(1, int(seconds * 300))  # conservative admission estimate, never reported as observed usage
            if s['requests'] >= route.get('rpm', 60) or (route.get('tokensPerMinute') and s['tokens'] + tokens > route['tokensPerMinute']):
                if tokens > route.get('tokensPerMinute', float('inf')):
                    cx.execute("UPDATE tasks SET state='blocked',issue=? WHERE id=?", (canonical(DomainError('QUOTA_REQUEST_TOO_LARGE').issue(scope)), task['id']))
                else:
                    cx.execute("UPDATE tasks SET state='waiting_quota',eligible_at=?,issue=? WHERE id=?", (s['window_start'] + 60, canonical(DomainError('QUOTA_WAIT').issue(scope)), task['id']))
                return None
            if route.get('secondsPerDay') is not None and s['processing_seconds'] + seconds > route['secondsPerDay']:
                if seconds > route['secondsPerDay']:
                    cx.execute("UPDATE tasks SET state='blocked',issue=? WHERE id=?", (canonical(DomainError('QUOTA_REQUEST_TOO_LARGE').issue(scope)), task['id']))
                else:
                    cx.execute("UPDATE tasks SET state='waiting_quota',eligible_at=?,issue=? WHERE id=?", ((int(now // 86400) + 1) * 86400, canonical(DomainError('QUOTA_WAIT').issue(scope)), task['id']))
                return None
            aid = identifier('attempt')
            cx.execute('INSERT INTO attempts(id,task_id,config_revision,route_id,route,scope_id,state,started_at) VALUES(?,?,?,?,?,?,?,?)',
                       (aid, task['id'], snapshot.revision, rid, canonical(route), scope, 'leased', utc()))
            cx.execute("UPDATE tasks SET state='leased',attempt_count=attempt_count+1,current_attempt=?,lease_owner=?,lease_until=?,updated_at=? WHERE id=?",
                       (aid, owner, now + 120, utc(), task['id']))
            cx.execute('UPDATE provider_scopes SET window_start=?,requests=?,tokens=?,day_start=?,processing_seconds=? WHERE id=?',
                       (s['window_start'], s['requests'] + 1, s['tokens'] + tokens, s['day_start'], s['processing_seconds'] + seconds, scope))
            self.event(cx, 'task.updated', task['run_id'], {'taskId': task['id'], 'state': 'leased'})
        return self.one('SELECT * FROM attempts WHERE id=?', (aid,))

    def mark_submitted(self, attempt: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE attempts SET state='submitted' WHERE id=?", (attempt,))
            cx.execute("UPDATE tasks SET state='submitted' WHERE current_attempt=?", (attempt,))

    def handle(self, attempt: str, provider: str, doc: dict) -> None:
        with self.transaction() as cx:
            cx.execute('INSERT OR REPLACE INTO remote_handles VALUES(?,?,?,?)', (attempt, provider, canonical(doc), utc()))

    def usage(self, attempt: str, doc: dict) -> None:
        task = self.one('SELECT t.run_id FROM tasks t JOIN attempts a ON a.task_id=t.id WHERE a.id=?', (attempt,))
        with self.transaction() as cx:
            if doc.get('providerEventId'):
                if not cx.execute('INSERT OR IGNORE INTO usage_receipts VALUES(?)', (doc['providerEventId'],)).rowcount:
                    return
            cx.execute('INSERT INTO usage_events VALUES(?,?,?,?,?)', (identifier('usage'), attempt, task['run_id'], utc(), canonical(doc)))
            self.event(cx, 'usage.updated', task['run_id'], {'attemptId': attempt})

    def attempt_usage(self, attempt: str | None) -> dict:
        entries = [json.loads(x['document']) for x in self.rows('SELECT document FROM usage_events WHERE attempt_id=?', (attempt,))]
        def total(field):
            values = [e[field] for e in entries if e.get(field) is not None]
            return sum(values) if values else None
        return dict(inputTokens=total('inputTokens'), outputTokens=total('outputTokens'),
                    reasoningTokens=total('reasoningTokens'), cachedTokens=total('cachedTokens'),
                    processingSeconds=total('processingSeconds'), freeAllowanceConsumed=None, apiCallCount=len(entries))

    def finish(self, task: dict, attempt: dict, output: dict) -> None:
        from .scoring import parse_option
        with self.transaction() as cx:
            if task['kind'] == 'answer':
                q = cx.execute('SELECT * FROM questions WHERE run_id=? AND id=?', (task['run_id'], task['question_id'])).fetchone()
                predicted = parse_option(output.get('answer', ''), len(json.loads(q['document'])['options']))
                correct = predicted == q['gold']
                output.update(predictedOption=predicted, correct=correct, evaluationRevision='official-mcq-v1')
                cx.execute('INSERT OR REPLACE INTO evaluations VALUES(?,?,?,?,?)',
                           (attempt['id'], 'official-mcq-v1', predicted, int(correct), None if predicted else 'INVALID_ANSWER_FORMAT'))
            else:
                artifact = 'index-' + digest(output.get('fingerprint', task['id']))[:24]
                output['artifactId'] = artifact
                cx.execute('INSERT OR IGNORE INTO artifacts VALUES(?,?,?,?,?)',
                           (artifact, task['id'], output.get('fingerprint', ''), canonical(output), utc()))
            cx.execute("UPDATE attempts SET state='completed',completed_at=?,output=?,issue=NULL WHERE id=?", (utc(), canonical(output), attempt['id']))
            cx.execute("UPDATE tasks SET state='completed',output=?,lease_until=NULL,issue=NULL,updated_at=? WHERE id=?", (canonical(output), utc(), task['id']))
            scope = json.loads(attempt['route'])['scopeId']
            cx.execute('UPDATE provider_scopes SET successes=successes+1,concurrency=CASE WHEN successes%8=7 THEN min(concurrency+1,4) ELSE concurrency END WHERE id=?', (scope,))
            self.event(cx, 'attempt.completed', task['run_id'], {'attemptId': attempt['id'], 'taskId': task['id']})

    def fail(self, task: dict, attempt: dict, error: DomainError, max_attempts: int) -> None:
        scope = json.loads(attempt['route'])['scopeId']
        issue = canonical(error.issue(scope))
        wait = error.wait if error.wait is not None else 5
        count = self.one('SELECT attempt_count FROM tasks WHERE id=?', (task['id'],))['attempt_count']
        if error.unknown:
            state = 'blocked'
        elif error.code in {'CREDIT_EXHAUSTED', 'AUTH_INVALID', 'MODEL_UNAVAILABLE'}:
            state = 'ready' if count < max_attempts else 'blocked'
        elif error.retryable and count < max_attempts:
            state = 'waiting_quota'
        else:
            state = 'blocked'
        with self.transaction() as cx:
            cx.execute('UPDATE attempts SET state=?,completed_at=?,issue=? WHERE id=?',
                       ('unknown' if error.unknown else 'failed', utc(), issue, attempt['id']))
            cx.execute('UPDATE tasks SET state=?,issue=?,eligible_at=?,lease_until=NULL,updated_at=? WHERE id=?',
                       (state, issue, time.time() + wait, utc(), task['id']))
            if error.code in {'CREDIT_EXHAUSTED', 'AUTH_INVALID', 'MODEL_UNAVAILABLE'}:
                cx.execute('UPDATE provider_scopes SET state=?,issue=? WHERE id=?',
                           ({'CREDIT_EXHAUSTED': 'credit_exhausted', 'AUTH_INVALID': 'auth_invalid', 'MODEL_UNAVAILABLE': 'disabled'}[error.code], issue, scope))
                if error.code == 'CREDIT_EXHAUSTED':
                    route = json.loads(attempt['route'])
                    cx.execute("""UPDATE provider_scopes SET state='credit_exhausted',issue=? WHERE id IN
                      (SELECT DISTINCT scope_id FROM attempts WHERE json_extract(route,'$.secretAlias')=? AND json_extract(route,'$.provider')=?)""",
                               (issue, route['secretAlias'], route['provider']))
            elif error.code == 'QUOTA_WAIT':
                cx.execute('UPDATE provider_scopes SET cooldown_until=?,concurrency=max(1,concurrency/2),issue=? WHERE id=?', (time.time() + wait, issue, scope))
            self.event(cx, 'task.updated', task['run_id'], {'taskId': task['id'], 'state': state, 'issue': json.loads(issue)})

    def settle(self, run: str) -> None:
        with self.transaction() as cx:
            r = cx.execute('SELECT state FROM runs WHERE id=?', (run,)).fetchone()
            if not r or r[0] in {'draft', 'completed', 'cancelled', 'failed', 'paused'}:
                return
            counts = {x[0]: x[1] for x in cx.execute('SELECT state,count(*) FROM tasks WHERE run_id=? GROUP BY state', (run,))}
            inflight = sum(counts.get(s, 0) for s in ('leased', 'running', 'submitted'))
            state = r[0]
            if state == 'pausing' and not inflight:
                state = 'paused'
            elif state == 'cancelling' and not inflight:
                state = 'cancelled'
            elif state == 'running' and not inflight:
                if sum(counts.values()) == counts.get('completed', 0):
                    # Export/evaluation is finalized by the scheduler before marking complete.
                    return
                if counts.get('blocked', 0) and not any(counts.get(s, 0) for s in ('ready', 'pending', 'waiting_quota')):
                    state = 'blocked'
            if state != r[0]:
                cx.execute('UPDATE runs SET state=? WHERE id=?', (state, run))
                self.event(cx, 'run.updated', run, {'state': state})

    def recover(self) -> list[dict]:
        resumable = []
        with self.transaction() as cx:
            rows = cx.execute("SELECT t.*,a.state attempt_state FROM tasks t JOIN attempts a ON a.id=t.current_attempt WHERE t.state IN ('leased','submitted','running')").fetchall()
            for row in rows:
                t = dict(row)
                handle = cx.execute('SELECT * FROM remote_handles WHERE attempt_id=?', (t['current_attempt'],)).fetchone()
                if handle:
                    resumable.append(t)
                elif t['attempt_state'] == 'leased':
                    cx.execute("UPDATE tasks SET state='ready',lease_until=NULL WHERE id=?", (t['id'],))
                    cx.execute("UPDATE attempts SET state='abandoned',completed_at=? WHERE id=?", (utc(), t['current_attempt']))
                else:
                    issue = canonical(DomainError('REMOTE_OUTCOME_UNKNOWN', unknown=True).issue())
                    cx.execute("UPDATE tasks SET state='blocked',issue=?,lease_until=NULL WHERE id=?", (issue, t['id']))
                    cx.execute("UPDATE attempts SET state='unknown',issue=? WHERE id=?", (issue, t['current_attempt']))
                self.event(cx, 'task.updated', t['run_id'], {'taskId': t['id'], 'recovered': True})
        return resumable

    def backup(self, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = target.with_suffix('.partial')
        with self.lock:
            connection = sqlite3.connect(temporary)
            try:
                self.db.backup(connection)
                if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise DomainError('BACKUP_INVALID')
            finally:
                connection.close()
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)

    def close(self) -> None:
        self.db.close()
