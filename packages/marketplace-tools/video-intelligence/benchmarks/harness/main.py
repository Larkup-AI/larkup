from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import secrets
import signal
import subprocess
import sys
import threading
from pathlib import Path

from .api import Controller
from .common import DomainError, Secrets, atomic, canonical
from .config import Config
from .scheduler import Scheduler
from .scoring import export
from .store import Store

BENCHMARK = Path(__file__).resolve().parent.parent


def default_profile(revision: str) -> dict:
    def route(provider, model, alias, scope, endpoint, **kwargs):
        return dict(provider=provider, model=model, logicalModel=model.split('/')[-1],
                    secretAlias=alias, scopeId=scope, endpoint=endpoint, tier='unverified',
                    capabilities=['video', 'audio', 'text'] if provider in {'gemini', 'twelvelabs'} or model.startswith('google/gemini') else ['image', 'text'],
                    concurrency=1, rpm=10, balance=None, **kwargs)
    routes = {
        'gemini-direct': route('gemini', 'gemini-3.8-flash', 'GEMINI_APIKEY2', 'gemini-unverified-shared-project',
                               'https://generativelanguage.googleapis.com/v1beta'),
        'qwen-gateway': route('gateway', 'alibaba/qwen3.6-plus', 'VERCEL_GATEWAY_API_KEY', 'gateway-qwen3.6-plus',
                              'https://ai-gateway.vercel.sh/v1', inputPerMillion='0.5', outputPerMillion='3'),
        'twelvelabs-direct': route('twelvelabs', 'pegasus1.5', 'TWELEVE_LABS_KEY1', 'twelvelabs-unverified-shared-account',
                                   'https://api.twelvelabs.io/v1.3'),
        'gemini-gateway': route('gateway', 'google/gemini-3.8-flash', 'VERCEL_GATEWAY_API_KEY', 'gateway-gemini3.8-flash',
                                'https://ai-gateway.vercel.sh/v1', inputPerMillion='0.75', outputPerMillion='3.75'),
    }
    roles = dict(audio=dict(provider='deepgram', model='nova-3', secretAlias='DEEPGRAM_APIKEY1'),
                 brain=dict(provider='vercel_ai_gateway', model='google/gemini-3.6-flash', secretAlias='VERCEL_GATEWAY_API_KEY'),
                 vision=dict(provider='vercel_ai_gateway', model='google/gemini-3.6-flash', secretAlias='VERCEL_GATEWAY_API_KEY'))
    variants = {}
    for vid, adapter, rid in [('gemini-native-gateway-v1', 'gemini', 'gemini-gateway'), ('qwen-frames', 'qwen', 'qwen-gateway'),
                               ('twelvelabs-native', 'twelvelabs', 'twelvelabs-direct'),
                               ('larkup-gateway-brain-v2', 'larkup', 'gemini-gateway'), ('same-backbone-retrieval-gateway-brain-v2', 'retrieval', 'gemini-gateway')]:
        variants[vid] = dict(adapter=adapter, logicalModel=routes[rid]['logicalModel'], routes=[rid],
                             maxSteps=4, maxOutputTokens=2048, temperature=0,
                             inputProtocol=dict(maxFrames=128, maxToolSteps=4, subtitles='official-when-supplied',
                                                modality='native-video-audio' if adapter in {'gemini', 'twelvelabs'} else
                                                'timestamped-frames-subtitles' if adapter == 'qwen' else 'canonical-tool-evidence'),
                             canonicalRevision=revision)
        if adapter in {'larkup', 'retrieval'}:
            variants[vid]['roles'] = roles
            variants[vid]['extraction'] = dict(mode='balanced', embeddings='disabled', heavyOperators='enabled')
        if adapter == 'gemini':
            variants[vid]['inputProtocol']['api'] = 'gateway-ai-sdk-v4'
    from .profiles import requested_models_profile
    return requested_models_profile(dict(routes=routes, variants=variants, limits={'global': 8, 'gpu': 1, 'cpu': 2, 'upload': 2, 'qa': 6,
                                                          'judge': 1, 'attempts': 3, 'deadlineSeconds': 3600},
                runtime=dict(endpoint='http://127.0.0.1:8787', indexingConcurrency=1, profileVariantId='larkup-gateway-brain-v2'),
                protocol=dict(revision='accuracy-first-pilot-v3', variantIds=list(variants))))


def initialize(benchmark: Path):
    data = benchmark / 'data'
    tokens = data / 'deployment/tokens.env'
    if not tokens.exists():
        atomic(tokens, '\n'.join(f'{name}={secrets.token_urlsafe(40)}' for name in
                                ('BENCHMARK_CONTROLLER_TOKEN', 'BENCHMARK_RUNTIME_TOKEN')) + '\n', raw=True)
    config = data / 'configs/active.json'
    if not config.exists():
        revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=benchmark, capture_output=True, text=True).stdout.strip() or 'unversioned'
        atomic(config, default_profile(revision))
    return data


def smoke_source(data: Path):
    source = data / 'sources/smoke.mp4'
    source.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not source.exists():
        audio = source.with_suffix('.aiff' if sys.platform == 'darwin' else '.wav')
        text = 'The secret number spoken in this clip is seven.'
        speech = ['say', '-o', str(audio), text] if sys.platform == 'darwin' else ['espeak', '-w', str(audio), text]
        subprocess.run(speech, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=4:r=25',
                        '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=4:r=25', '-i', str(audio),
                        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a]apad[a]',
                        '-map', '[v]', '-map', '[a]', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(source)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        audio.unlink()
    manifest = dict(id='smoke-v1', sources=[dict(id='development-smoke', dataset='development-CC0', path='sources/smoke.mp4',
                                                 sha256=hashlib.sha256(source.read_bytes()).hexdigest(), durationMs=8000, durationGroup='short',
                                                 license='CC0: generated development fixture',
                                                 subtitles=[dict(startMs=0, endMs=4000, text='The secret number spoken in this clip is seven.')])],
                    questions=[dict(id='smoke-visual', sourceId='development-smoke', question='What color fills the first part of the video?',
                                    options=['Red', 'Green', 'Yellow', 'Purple'], correctOption='A', capability='visual'),
                               dict(id='smoke-audio', sourceId='development-smoke', question='Which number is spoken in the audio?',
                                    options=['Three', 'Five', 'Seven', 'Nine'], correctOption='C', capability='audio')],
                    protocol=dict(revision='engineering-smoke-v1', minimumSources=8, minimumNetWins=2,
                                  modalityDisclosure='Qwen receives the supplied development transcript; native services also receive audio.'))
    atomic(data / 'datasets/smoke-v1.json', manifest)
    return manifest


async def serve(args, store, config, data, benchmark):
    controller = Controller(store, config, data, config.active.secrets.get('BENCHMARK_CONTROLLER_TOKEN'),
                            origin=args.origin, readonly=args.readonly)
    server = controller.server(args.port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    scheduler = Scheduler(store, config, data, benchmark.parent)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: setattr(scheduler, 'stopping', True))
    print(canonical({'controller': f'http://127.0.0.1:{server.server_port}/api/v1', 'readonly': args.readonly}), flush=True)
    try:
        if args.readonly:
            while not scheduler.stopping:
                await asyncio.sleep(.2)
        else:
            await scheduler.run()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def main():
    parser = argparse.ArgumentParser(description='Standalone canonical Video Intelligence benchmark')
    parser.add_argument('--benchmark-dir', type=Path, default=BENCHMARK)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('init')
    sub.add_parser('smoke-source')
    create = sub.add_parser('create')
    create.add_argument('--manifest', required=True)
    create.add_argument('--phase', choices=['smoke', 'pilot', 'publication', 'ablation'], default='pilot')
    create.add_argument('--variants', nargs='+')
    run = sub.add_parser('work')
    run.add_argument('--until-idle', action='store_true')
    for op in ('start', 'pause', 'resume', 'cancel', 'status', 'export', 'reconcile'):
        p = sub.add_parser(op)
        p.add_argument('run_id')
    sub.add_parser('list')
    p = sub.add_parser('backup')
    p.add_argument('target', type=Path)
    p = sub.add_parser('reload')
    p.add_argument('candidate', type=Path)
    p = sub.add_parser('reconcile-usage')
    p.add_argument('receipts', type=Path)
    p = sub.add_parser('audit')
    p.add_argument('run_id')
    p.add_argument('review', type=Path)
    p = sub.add_parser('serve')
    p.add_argument('--port', type=int, default=8890)
    p.add_argument('--origin', default='http://127.0.0.1:3100')
    p.add_argument('--readonly', action='store_true')
    args = parser.parse_args()
    benchmark = args.benchmark_dir.resolve()
    data = initialize(benchmark)
    if args.command == 'init':
        print(canonical({'initialized': True, 'config': 'data/configs/active.json'}))
        return
    if args.command == 'smoke-source':
        m = smoke_source(data)
        print(canonical({'manifest': m['id'], 'questions': len(m['questions'])}))
        return
    store = Store(data / 'state/benchmark.sqlite3')
    saved = store.rows("SELECT value FROM settings WHERE key='active_config'")
    config = Config(json.loads(saved[0]['value']) if saved else json.loads((data / 'configs/active.json').read_text()), benchmark / 'benchmark.env')
    try:
        if args.command == 'create':
            if not all(c.isalnum() or c in '-_' for c in args.manifest):
                raise DomainError('MANIFEST_INVALID')
            manifest = json.loads((data / 'datasets' / (args.manifest + '.json')).read_text())
            result = store.create(manifest, args.variants or config.active.config.get('protocol',{}).get('variantIds') or list(config.active.config['variants']), config.active,
                                  args.phase, manifest['protocol'].get('revision', 'pilot-v1'))
        elif args.command == 'work':
            asyncio.run(Scheduler(store, config, data, benchmark.parent).run(until_idle=args.until_idle))
            result = {'checkpointed': True}
        elif args.command == 'serve':
            asyncio.run(serve(args, store, config, data, benchmark))
            return
        elif args.command == 'list':
            result = [store.snapshot(r['id']) for r in store.rows('SELECT id FROM runs ORDER BY updated_at DESC')]
        elif args.command == 'backup':
            store.backup(args.target)
            result = {'backup': 'verified'}
        elif args.command == 'reconcile-usage':
            records = json.loads(args.receipts.read_text())
            if config.active.secrets.clean(records) != records:
                raise DomainError('RECEIPT_CONTAINS_SECRET')
            store.reconcile_usage(records)
            result = {'reconciledRecords': len(records)}
        elif args.command == 'audit':
            from .scoring import decision
            review = json.loads(args.review.read_text())
            if review.get('status') not in {'passed', 'failed', 'inconclusive'} or review.get('reviewer', {}).get('kind') not in {'human', 'independent-model'}:
                raise DomainError('AUDIT_INVALID')
            system_models = {r['model'].split('/')[-1] for r in config.active.config['routes'].values()} | {s['model'].split('/')[-1] for v in config.active.config['variants'].values() for s in v.get('roles', {}).values()}
            if review['reviewer'].get('model', '').split('/')[-1] in system_models:
                raise DomainError('AUDIT_REQUIRES_INDEPENDENT_REVIEWER')
            document = json.loads(store.one('SELECT document FROM runs WHERE id=?', (args.run_id,))['document'])
            expected = set(document['protocol'].get('groundingAuditSampleQuestionIds', []))
            reviewed = {r['questionId'] for r in review.get('items', [])}
            if not expected or not expected <= reviewed:
                raise DomainError('AUDIT_SAMPLE_INCOMPLETE')
            if config.active.secrets.clean(review) != review:
                raise DomainError('AUDIT_CONTAINS_SECRET')
            with store.transaction() as cx:
                cx.execute('INSERT OR REPLACE INTO audits VALUES(?,?,?)', (args.run_id, canonical(review), __import__('harness.common', fromlist=['utc']).utc()))
                d, reason = decision(store, args.run_id)
                cx.execute('UPDATE runs SET decision=? WHERE id=?', (d, args.run_id))
                store.event(cx, 'evaluation.updated', args.run_id, {'decision': d})
            result = {'decision': d, 'reason': reason}
        elif args.command == 'reload':
            candidate = config.validate(json.loads(args.candidate.read_text()), config.active.revision)
            snapshot = config.activate(candidate['candidateId'], config.active.revision)
            store.save_config(snapshot)
            with store.transaction() as cx:
                cx.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', ('active_config', snapshot.document))
            atomic(data / 'configs/active.json', snapshot.config)
            result = config.public()
        elif args.command in {'start', 'pause', 'resume', 'cancel'}:
            snapshot = store.snapshot(args.run_id)
            result = store.control(args.run_id, args.command, snapshot['revision'])
        elif args.command == 'status':
            result = store.snapshot(args.run_id)
        elif args.command == 'reconcile':
            import fcntl
            lock = (data / 'state/controller.lock').open('a')
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise DomainError('CONTROLLER_ALREADY_RUNNING') from None
            async def reconcile():
                from .adapters import Context
                from .config import Snapshot
                from .transport import HTTP
                scheduler = Scheduler(store, config, data, benchmark.parent)
                attempts = store.rows("SELECT a.* FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=? AND a.state IN ('unknown','submitted','running') AND a.id=t.current_attempt", (args.run_id,))
                reconciled = []
                for attempt in attempts:
                    task = store.one('SELECT * FROM tasks WHERE id=?', (attempt['task_id'],))
                    document = store.one('SELECT document FROM config_revisions WHERE id=?', (attempt['config_revision'],))['document']
                    snapshot = Snapshot(attempt['config_revision'], document, config.active.secrets)
                    handles = store.rows('SELECT document FROM remote_handles WHERE attempt_id=?', (attempt['id'],))
                    handle = json.loads(handles[0]['document']) if handles else None
                    context = Context(store, task, attempt, snapshot, data, HTTP())
                    adapter = scheduler.adapters[context.variant['adapter']]
                    if not handle and hasattr(adapter, 'reconcile'):
                        handle = await adapter.reconcile(context)
                        if handle:
                            store.handle(attempt['id'], context.route['provider'], handle)
                    if handle:
                        with store.transaction() as cx:
                            cx.execute("UPDATE tasks SET state='submitted' WHERE id=?", (task['id'],))
                            cx.execute("UPDATE attempts SET state='submitted' WHERE id=?", (attempt['id'],))
                        await scheduler.perform(task, attempt, snapshot, resume=handle)
                        reconciled.append(attempt['id'])
                store.settle(args.run_id)
                return dict(reconciledAttemptIds=reconciled, run=store.snapshot(args.run_id))
            try:
                result = asyncio.run(reconcile())
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)
                lock.close()
        else:
            target = benchmark / 'results/multimodal/video-understanding'
            result = export(store, args.run_id, target)
        print(canonical(config.active.secrets.clean(result)), flush=True)
    finally:
        store.close()


if __name__ == '__main__':
    try:
        main()
    except DomainError as e:
        print(canonical({'error': e.issue()}), file=sys.stderr)
        sys.exit(2)
    except (OSError, ValueError, subprocess.SubprocessError):
        print(canonical({'error': {'code': 'LOCAL_SETUP_FAILED', 'message': 'Inspect required local dependencies and private configuration.'}}), file=sys.stderr)
        sys.exit(2)
