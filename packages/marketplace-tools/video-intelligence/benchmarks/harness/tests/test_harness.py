from __future__ import annotations

import asyncio
import copy
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from harness.api import Controller
from harness.common import DomainError, Secrets, atomic, canonical, digest
from harness.config import Config
from harness.scheduler import Scheduler
from harness.scoring import accuracy, decision, export, parse_option, results
from harness.store import Store
from harness.transport import classify


def profile():
    route = dict(provider='gemini', model='model-one', logicalModel='model-one',
                 endpoint='https://generativelanguage.googleapis.com/v1beta',
                 secretAlias='KEY_ONE', scopeId='project-one-model-one', tier='unknown',
                 concurrency=2, rpm=100, capabilities=['text'], balance=None)
    variant = dict(adapter='gemini', logicalModel='model-one', routes=['direct'],
                   inputProtocol={'modality': 'video'}, maxSteps=4)
    return dict(routes={'direct': route}, variants={'arm-one': variant}, limits={'global': 4})


def manifest(count=2):
    return dict(id='fixture', sources=[dict(id='source-' + str(i), path='sources/file.mp4',
                                           durationMs=8000, durationGroup='short', dataset='development') for i in range(count)],
                questions=[dict(id='q-' + str(i), sourceId='source-' + str(i), question='Which symbol appears?',
                                options=['triangle', 'square', 'circle', 'star'], correctOption='C', capability='visual') for i in range(count)],
                protocol=dict(minimumSources=8, minimumNetWins=2))


class Fake:
    def __init__(self, *, delay=0, failures=None):
        self.delay, self.failures, self.calls, self.gate = delay, list(failures or []), [], None

    async def prepare(self, c):
        self.calls.append(('prepare', c.task['source_id'], c.snapshot.revision))
        if self.gate:
            await self.gate.wait()
        await asyncio.sleep(self.delay)
        if self.failures:
            raise self.failures.pop(0)
        return {'fingerprint': digest(c.source), 'evidencePath': 'fake'}

    async def answer(self, c, question, prepared):
        assert 'correctOption' not in question
        self.calls.append(('answer', c.task['source_id'], c.snapshot.revision))
        await asyncio.sleep(self.delay)
        if self.failures:
            raise self.failures.pop(0)
        c.store.mark_submitted(c.attempt['id'])
        c.store.usage(c.attempt['id'], {'actual': None, 'estimated': '0.001', 'operation': 'fake'})
        return {'answer': '{"option":"C"}', 'evidence': [], 'cost': {'actual': None, 'estimated': '0.001'}}


class HarnessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.secret = self.root / 'benchmark.env'
        atomic(self.secret, 'KEY_ONE="private-value-one"\nKEY_TWO=private-value-two\n', raw=True)
        self.config = Config(profile(), self.secret)
        self.store = Store(self.root / 'state' / 'db.sqlite3')
        self.run = self.store.create(manifest(), ['arm-one'], self.config.active, 'smoke')

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def scheduler(self, fake=None, config=None, implementations=None):
        return Scheduler(self.store, config or self.config, self.root, self.root,
                         implementations=implementations or {'gemini': fake or Fake()})

    def start(self):
        return self.store.control(self.run['id'], 'start', self.run['revision'])

    async def finish(self, scheduler, ticks=150):
        for _ in range(ticks):
            await scheduler.tick()
            if not scheduler.inflight and self.store.snapshot(self.run['id'])['state'] in {'blocked', 'completed', 'paused', 'cancelled'}:
                return
            await asyncio.sleep(.005)
        self.fail('Scheduler did not settle')

    def test_dotenv_is_data_and_permission_guard(self):
        atomic(self.secret, "KEY_ONE='$(touch /tmp/benchmark-unsafe)'\n", raw=True)
        self.assertEqual(Secrets(self.secret).get('KEY_ONE'), '$(touch /tmp/benchmark-unsafe)')
        self.secret.chmod(0o644)
        with self.assertRaises(DomainError):
            Secrets(self.secret)

    def test_secret_redaction_recursive(self):
        value = self.config.active.secrets.clean({'answer': 'private-value-one https://host/path?token=anything', 'nested': {'apiKey': 'hidden'}})
        self.assertNotIn('private-value-one', canonical(value))
        self.assertNotIn('token=anything', canonical(value))
        self.assertEqual(value['nested'], {})

    def test_strict_official_scorer(self):
        for answer in ['A', '{"option":"A"}', '```json\n{"option":"A"}\n```']:
            self.assertEqual(parse_option(answer), 'A')
        for answer in ['Answer is A or B', '{"option":["A"]}', 'A. triangle', 'E', '{"explanation":"A"}', '', '{"option":"C"']:
            self.assertIsNone(parse_option(answer))
        self.assertEqual(accuracy([{'correct': None, 'state': 'blocked'}])['value'], None)

    def test_retry_after_credit_and_auth_classification(self):
        self.assertEqual(classify(429, b'{}', {'retry-after': '12'}).wait, 12)
        self.assertEqual(classify(429, b'{"error":"insufficient_quota"}', {}).code, 'CREDIT_EXHAUSTED')
        self.assertEqual(classify(401, b'private key', {}).code, 'AUTH_INVALID')
        self.assertTrue(classify(503, b'', {}, submitted=True).unknown)

    def test_invalid_reload_rollback_and_inflight_snapshot(self):
        original = self.config.active
        doc = copy.deepcopy(profile())
        doc['routes']['direct']['secretAlias'] = 'ABSENT'
        with self.assertRaises(DomainError):
            self.config.validate(doc, original.revision)
        self.assertIs(self.config.active, original)
        doc['routes']['direct']['secretAlias'] = 'KEY_TWO'
        candidate = self.config.validate(doc, original.revision)
        self.config.activate(candidate['candidateId'], original.revision)
        self.assertEqual(original.config['routes']['direct']['secretAlias'], 'KEY_ONE')
        self.assertEqual(self.config.active.config['routes']['direct']['secretAlias'], 'KEY_TWO')
        with self.assertRaises(DomainError):
            self.config.activate(candidate['candidateId'], original.revision)

    def test_model_change_cannot_silently_mutate_variant(self):
        doc = copy.deepcopy(profile())
        doc['routes']['direct']['model'] = 'different-model'
        candidate = self.config.validate(doc, self.config.active.revision)
        with self.assertRaises(DomainError):
            self.config.activate(candidate['candidateId'], self.config.active.revision)
        doc = copy.deepcopy(profile())
        doc['variants']['arm-one']['inputProtocol']['modality'] = 'text-only'
        candidate = self.config.validate(doc, self.config.active.revision)
        with self.assertRaises(DomainError):
            self.config.activate(candidate['candidateId'], self.config.active.revision)

    def test_exact_model_gateway_route_requires_verification(self):
        doc = profile()
        gateway = {**doc['routes']['direct'], 'provider': 'gateway', 'endpoint': 'https://ai-gateway.vercel.sh/v1', 'scopeId': 'gateway-credit'}
        doc['routes']['gateway'] = gateway
        doc['variants']['arm-one']['routes'].append('gateway')
        with self.assertRaises(DomainError):
            Config(doc, self.secret)
        gateway['verifiedEquivalent'] = True
        config = Config(doc, self.secret)
        self.assertEqual(config.active.config['routes']['gateway']['logicalModel'], 'model-one')
        gateway['logicalModel'] = 'different'
        with self.assertRaises(DomainError):
            Config(doc, self.secret)

    def test_transaction_rolls_back_control_and_dag_together(self):
        with self.assertRaises(RuntimeError):
            with self.store.transaction():
                self.start()
                raise RuntimeError()
        self.assertEqual(self.store.snapshot(self.run['id'])['state'], 'draft')

    def test_backup_restores_real_wal_state(self):
        self.start()
        target = self.root / 'snapshot.sqlite3'
        self.store.backup(target)
        restored = Store(target)
        try:
            self.assertEqual(restored.snapshot(self.run['id'])['state'], 'running')
            self.assertEqual(len(restored.rows('SELECT * FROM tasks')), 4)
        finally:
            restored.close()

    def test_leases_are_transactional_and_shared_scope_limits_aggregate_keys(self):
        self.start()
        tasks = self.store.ready()
        route = self.config.active.config['routes']['direct']
        route['concurrency'] = 1
        first = self.store.lease(tasks[0], self.config.active, 'direct', route, 'one')
        self.assertIsNotNone(first)
        self.assertIsNone(self.store.lease(tasks[0], self.config.active, 'direct', route, 'two'))
        alternate_key = {**route, 'secretAlias': 'KEY_TWO'}
        self.assertIsNone(self.store.lease(tasks[1], self.config.active, 'direct', alternate_key, 'two'))
        independent = {**alternate_key, 'scopeId': 'independent-confirmed-project'}
        self.assertIsNotNone(self.store.lease(tasks[1], self.config.active, 'direct', independent, 'two'))

    def test_unknown_outcome_is_not_retried_after_crash(self):
        self.start()
        task = self.store.ready()[0]
        attempt = self.store.lease(task, self.config.active, 'direct', self.config.active.config['routes']['direct'], 'dead')
        self.store.mark_submitted(attempt['id'])
        self.assertEqual(self.store.recover(), [])
        self.assertEqual(self.store.one('SELECT state FROM tasks WHERE id=?', (task['id'],))['state'], 'blocked')
        self.assertEqual(self.store.one('SELECT state FROM attempts WHERE id=?', (attempt['id'],))['state'], 'unknown')

    def test_saved_remote_handle_is_reconciled(self):
        self.start()
        task = self.store.ready()[0]
        attempt = self.store.lease(task, self.config.active, 'direct', self.config.active.config['routes']['direct'], 'dead')
        self.store.mark_submitted(attempt['id'])
        self.store.handle(attempt['id'], 'gemini', {'fileName': 'files/opaque'})
        recovered = self.store.recover()
        self.assertEqual(recovered[0]['current_attempt'], attempt['id'])
        self.assertEqual(self.store.one('SELECT attempt_count FROM tasks WHERE id=?', (task['id'],))['attempt_count'], 1)

    def test_pre_submission_crash_can_safely_requeue(self):
        self.start()
        task = self.store.ready()[0]
        self.store.lease(task, self.config.active, 'direct', self.config.active.config['routes']['direct'], 'dead')
        self.store.recover()
        self.assertEqual(self.store.one('SELECT state FROM tasks WHERE id=?', (task['id'],))['state'], 'ready')

    def test_full_dag_scoring_export_and_unknown_cost(self):
        self.start()
        asyncio.run(self.finish(self.scheduler()))
        self.assertEqual(self.store.snapshot(self.run['id'])['state'], 'completed')
        self.assertTrue(all(x['correct'] for x in results(self.store, self.run['id'])))
        self.assertIsNone(self.store.snapshot(self.run['id'])['cost']['actual'])
        root = self.root / 'export'
        export(self.store, self.run['id'], root)
        self.assertTrue((root / 'blog.md').exists())
        self.assertTrue((root / 'results.csv').exists())
        self.assertEqual(decision(self.store, self.run['id'])[0], 'not_evaluated')

    def test_pause_drains_then_resume_without_duplicate_work(self):
        async def exercise():
            fake = Fake(delay=.03)
            scheduler = self.scheduler(fake)
            self.start()
            await scheduler.tick()
            snap = self.store.snapshot(self.run['id'])
            self.store.control(self.run['id'], 'pause', snap['revision'])
            await self.finish(scheduler)
            self.assertEqual(self.store.snapshot(self.run['id'])['state'], 'paused')
            self.assertEqual(len(fake.calls), 2)
            snap = self.store.snapshot(self.run['id'])
            self.store.control(self.run['id'], 'resume', snap['revision'])
            await self.finish(scheduler)
            self.assertEqual(len(fake.calls), 4)
        asyncio.run(exercise())

    def test_fast_provider_does_not_wait_for_slow_provider(self):
        async def exercise():
            doc = profile()
            doc['routes']['slow'] = {**doc['routes']['direct'], 'scopeId': 'slow'}
            doc['variants']['slow'] = {**doc['variants']['arm-one'], 'adapter': 'qwen', 'routes': ['slow']}
            config = Config(doc, self.secret)
            run = self.store.create(manifest(1), ['arm-one', 'slow'], config.active, 'smoke')
            self.store.control(run['id'], 'start', run['revision'])
            slow, fast = Fake(delay=.15), Fake()
            scheduler = self.scheduler(config=config, implementations={'gemini': fast, 'qwen': slow})
            for _ in range(8):
                await scheduler.tick()
                await asyncio.sleep(.005)
            fast_tasks = self.store.rows("SELECT state FROM tasks WHERE run_id=? AND variant_id='arm-one'", (run['id'],))
            self.assertTrue(all(t['state'] == 'completed' for t in fast_tasks))
            self.assertFalse(all(t['state'] == 'completed' for t in self.store.rows("SELECT state FROM tasks WHERE run_id=? AND variant_id='slow'", (run['id'],))))
            await asyncio.gather(*scheduler.inflight.values())
        asyncio.run(exercise())

    def test_credit_exhaustion_blocks_branch_and_retains_denominator(self):
        self.start()
        asyncio.run(self.finish(self.scheduler(Fake(failures=[DomainError('CREDIT_EXHAUSTED')]))))
        rows = results(self.store, self.run['id'])
        self.assertTrue(all(x['correct'] is None for x in rows))
        self.assertEqual(accuracy(rows)['plannedCount'], 2)
        self.assertEqual(accuracy(rows)['denominator'], 0)
        self.assertEqual(self.store.snapshot(self.run['id'])['state'], 'blocked')

    def test_zero_balance_rejected_unknown_balance_admitted(self):
        self.start()
        task = self.store.ready()[0]
        route = self.config.active.config['routes']['direct']
        self.assertIsNone(self.store.lease(task, self.config.active, 'direct', {**route, 'balance': '0.00'}, 'zero'))
        with self.store.transaction() as cx:
            cx.execute('DELETE FROM provider_scopes')
        self.assertIsNotNone(self.store.lease(task, self.config.active, 'direct', route, 'unknown'))

    def test_token_and_processing_duration_admission(self):
        self.start()
        task = self.store.ready()[0]
        route = self.config.active.config['routes']['direct']
        self.assertIsNone(self.store.lease(task, self.config.active, 'direct', {**route, 'tokensPerMinute': 1}, 'tokens'))
        self.assertIsNone(self.store.lease(task, self.config.active, 'direct', {**route, 'secondsPerDay': 1}, 'duration'))

    def test_quota_retry_recovers_after_cooldown(self):
        async def exercise():
            self.start()
            fake = Fake(failures=[DomainError('QUOTA_WAIT', retryable=True, wait=1)])
            scheduler = self.scheduler(fake)
            await scheduler.tick()
            await asyncio.gather(*scheduler.inflight.values())
            self.assertTrue(self.store.rows("SELECT * FROM tasks WHERE state='waiting_quota'"))
            with self.store.transaction() as cx:
                cx.execute('UPDATE provider_scopes SET cooldown_until=0')
                cx.execute('UPDATE tasks SET eligible_at=0')
            await self.finish(scheduler)
            self.assertEqual(self.store.snapshot(self.run['id'])['state'], 'completed')
            self.assertGreater(len(fake.calls), 4)
        asyncio.run(exercise())

    def test_exact_model_gateway_fallback_after_direct_exhaustion(self):
        doc = profile()
        doc['routes']['gateway'] = {**doc['routes']['direct'], 'provider': 'gateway',
            'endpoint': 'https://ai-gateway.vercel.sh/v1', 'secretAlias': 'KEY_TWO',
            'scopeId': 'separate-gateway-funding', 'verifiedEquivalent': 'observed exact resolved model'}
        doc['variants']['arm-one']['routes'].append('gateway')
        config = Config(doc, self.secret)
        run = self.store.create(manifest(1), ['arm-one'], config.active, 'smoke')
        self.run = run
        self.store.control(run['id'], 'start', run['revision'])
        asyncio.run(self.finish(self.scheduler(Fake(failures=[DomainError('CREDIT_EXHAUSTED')]), config=config)))
        self.assertEqual(self.store.snapshot(run['id'])['state'], 'completed')
        routes = self.store.rows('SELECT a.route_id FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=? ORDER BY a.started_at', (run['id'],))
        self.assertEqual(routes[0]['route_id'], 'direct')
        self.assertTrue(any(r['route_id'] == 'gateway' for r in routes[1:]))

    def test_usage_reconciliation_is_immutable_and_deduplicated(self):
        self.start()
        task = self.store.ready()[0]
        route = self.config.active.config['routes']['direct']
        attempt = self.store.lease(task, self.config.active, 'direct', route, 'test')
        receipt = {'providerEventId': 'receipt-one', 'actual': None, 'estimated': '0.2'}
        self.store.usage(attempt['id'], receipt)
        self.store.usage(attempt['id'], receipt)
        records = self.store.rows('SELECT * FROM usage_events')
        self.assertEqual(len(records), 1)
        self.assertIsNone(self.store.cost(self.run['id'])['actual'])
        reconciliation = {'usageEventId': records[0]['id'], 'actualUsd': '0.13', 'provenance': 'provider invoice line'}
        self.store.reconcile_usage([reconciliation, reconciliation])
        self.assertEqual(self.store.cost(self.run['id'])['actual'], '0.13')
        with self.assertRaises(DomainError):
            self.store.reconcile_usage([{**reconciliation, 'actualUsd': '0.14'}])
        self.assertIsNone(json.loads(self.store.rows('SELECT document FROM usage_events')[0]['document'])['actual'])

    def test_export_preserves_nested_runtime_receipt_identity(self):
        self.start()
        task = self.store.ready()[0]
        attempt = self.store.lease(task, self.config.active, 'direct', self.config.active.config['routes']['direct'], 'test')
        self.store.usage(attempt['id'], {'providerEventId': 'runtime-receipt', 'attemptId': attempt['id'],
                                       'recordedAt': '2026-01-01T00:00:00Z', 'actual': '0.01', 'provider': 'gateway'})
        export(self.store, self.run['id'], self.root / 'report')
        self.assertIn('runtime-receipt', (self.root / 'report/data/usage.csv').read_text())

    def test_secret_provider_binding_and_reserved_infrastructure_keys(self):
        atomic(self.secret, self.secret.read_text() + 'RUNPOD_APIKEY=infrastructure-only-value\nGEMINI_APIKEY2=google-only-value\n', raw=True)
        for alias, provider, endpoint in [('RUNPOD_APIKEY', 'gemini', 'https://generativelanguage.googleapis.com/v1beta'),
                                          ('GEMINI_APIKEY2', 'gateway', 'https://ai-gateway.vercel.sh/v1')]:
            doc = profile()
            doc['routes']['direct'].update(secretAlias=alias, provider=provider, endpoint=endpoint)
            with self.assertRaises(DomainError):
                Config(doc, self.secret)

    def test_cancel_and_readonly_backup_never_dispatch(self):
        self.store.control(self.run['id'], 'cancel', self.run['revision'])
        self.assertEqual(self.store.snapshot(self.run['id'])['state'], 'cancelled')
        self.assertFalse(self.store.ready())
        target = self.root / 'saved.sqlite3'
        self.store.backup(target)
        readonly = Store(target, readonly=True)
        try:
            self.assertEqual(readonly.snapshot(self.run['id'])['state'], 'cancelled')
            with self.assertRaises(DomainError):
                with readonly.transaction():
                    pass
        finally:
            readonly.close()

    def test_streamed_response_requires_finished_valid_events(self):
        from harness.transport import Response
        body = b'data: {"model":"exact-model","choices":[{"delta":{"content":"C"},"finish_reason":null}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3}}\n\ndata: [DONE]\n'
        value = Response(200, {'content-type': 'text/event-stream'}, body, 1).json()
        self.assertEqual(value['choices'][0]['message']['content'], 'C')
        self.assertEqual(value['usage']['prompt_tokens'], 3)
        for invalid in [b'data: {bad}\n', b'data: {"choices":[]}\n']:
            with self.assertRaises(DomainError):
                Response(200, {'content-type': 'text/event-stream'}, invalid, 1).json()

    def test_api_auth_origin_idempotency_revisions_and_event_reconnect(self):
        controller = Controller(self.store, self.config, self.root, 'controller-private', origin='http://127.0.0.1:3000')
        server = controller.server(0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}/api/v1'
        def request(path, doc=None, *, auth=True, origin='http://127.0.0.1:3000', key='control-one'):
            headers = {'Content-Type': 'application/json', 'Origin': origin, 'Idempotency-Key': key}
            if auth:
                headers['Authorization'] = 'Bearer controller-private'
            req = urllib.request.Request(base + path, headers=headers, data=canonical(doc).encode() if doc is not None else None)
            try:
                with urllib.request.urlopen(req) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as e:
                return e.code, json.load(e)
        try:
            self.assertEqual(request('/runs', auth=False)[0], 401)
            path = '/runs/' + self.run['id'] + '/start'
            doc = {'expectedRevision': self.run['revision']}
            self.assertEqual(request(path, doc, origin='https://hostile.invalid')[0], 403)
            status, first = request(path, doc)
            self.assertEqual(status, 202)
            self.assertEqual(request(path, doc)[1], first)
            self.assertEqual(request(path, {'expectedRevision': '999'})[0], 409)
            self.assertEqual(request('/runs/' + self.run['id'] + '/pause', doc, key='stale')[0], 409)
            status, events = request('/runs/' + self.run['id'] + '/events?after=0&limit=1')
            self.assertEqual(status, 200)
            _, later = request('/runs/' + self.run['id'] + '/events?after=' + events['nextCursor'])
            self.assertFalse({e['id'] for e in events['events']} & {e['id'] for e in later['events']})
            self.assertEqual(request('/runs/' + self.run['id'] + '/results')[1]['items'][0]['correct'], None)
            controller.readonly = True
            snap = self.store.snapshot(self.run['id'])
            self.assertEqual(request('/runs/' + self.run['id'] + '/pause', {'expectedRevision': snap['revision']}, key='offline')[0], 409)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
