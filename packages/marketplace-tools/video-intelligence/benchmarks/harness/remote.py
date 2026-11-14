from __future__ import annotations

import argparse
import hashlib
import io
import ipaddress
import json
import os
import secrets
import signal
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
from pathlib import Path

from .common import DomainError, Secrets, atomic, canonical, utc, identifier
from .main import BENCHMARK, initialize

REPO = BENCHMARK.parents[3]
REMOTE_REPO = '/workspace/larkup-benchmark'
RELATIVE = 'packages/marketplace-tools/video-intelligence/benchmarks'
REMOTE_BENCH = REMOTE_REPO + '/' + RELATIVE


class Remote:
    def __init__(self):
        self.data = BENCHMARK / 'data'
        self.deployment = self.data / 'deployment'
        self.private = Secrets(BENCHMARK / 'benchmark.env')
        self.state = json.loads((self.deployment / 'remote.json').read_text())
        self.children = []

    def gql(self, query):
        req = urllib.request.Request('https://api.runpod.io/graphql', data=canonical({'query': query}).encode(),
                                     headers={'Authorization': 'Bearer ' + self.private.get('RUNPOD_APIKEY'), 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                result = json.load(response)
        except Exception:
            raise DomainError('RUNPOD_API_UNAVAILABLE') from None
        if result.get('errors'):
            raise DomainError('RUNPOD_REQUEST_REJECTED')
        return result['data']

    def account(self):
        data = self.gql('query { myself { clientBalance currentSpendPerHr } }')['myself']
        with (self.deployment / 'rental-observations.jsonl').open('a') as f:
            f.write(canonical({'at': utc(), **data}) + '\n')
        return data

    def connection(self):
        ipaddress.ip_address(self.state['sshHost'])
        return ['ssh', '-i', self.state['keyPath'], '-p', str(self.state['sshPort']), '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'UserKnownHostsFile=' + str(self.deployment / 'known_hosts'), '-o', 'ConnectTimeout=20',
                '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', 'root@' + self.state['sshHost']]

    def ssh(self, command, *, data=None, check=True):
        result = subprocess.run(self.connection() + [command], input=data, capture_output=True, check=False)
        if check and result.returncode:
            raise DomainError('SSH_OPERATION_FAILED')
        return result

    def resume(self):
        if self.account()['clientBalance'] < 1:
            raise DomainError('CREDIT_EXHAUSTED')
        pod = self.gql('query { pod(input:{podId:' + json.dumps(self.state['podId']) + '}) { id desiredStatus runtime { ports { ip isIpPublic privatePort publicPort } } } }')['pod']
        if pod['desiredStatus'] != 'RUNNING':
            self.gql('mutation { podResume(input:{podId:' + json.dumps(self.state['podId']) + ',gpuCount:1}) {id desiredStatus} }')
        for _ in range(60):
            pod = self.gql('query { pod(input:{podId:' + json.dumps(self.state['podId']) + '}) { id desiredStatus runtime { ports { ip isIpPublic privatePort publicPort } } } }')['pod']
            ports = (pod.get('runtime') or {}).get('ports', [])
            port = next((p for p in ports if p['privatePort'] == 22 and p['isIpPublic']), None)
            if port:
                self.state.update(sshHost=port['ip'], sshPort=port['publicPort'])
                atomic(self.deployment / 'remote.json', self.state)
                return
            time.sleep(5)
        raise DomainError('RUNPOD_STARTUP_INCOMPLETE')

    def bundle(self, remote_hashes=None):
        paths = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'patches', 'packages/core', 'packages/marketplace',
                 'packages/vector-stores', 'packages/runtime-kit', 'packages/marketplace-tools/video-intelligence',
                 'packages/workspace-server/src/lib/media/video-intelligence-adapter.ts']
        base = subprocess.run(['git', 'archive', 'HEAD', *paths], cwd=REPO, capture_output=True, check=True).stdout
        # Keep the remote snapshot independent of any tracked local dashboard or reports.
        filtered = io.BytesIO()
        with tarfile.open(fileobj=io.BytesIO(base)) as original, tarfile.open(fileobj=filtered, mode='w') as target:
            for member in original:
                if member.name == RELATIVE or member.name.startswith(RELATIVE + '/'):
                    continue
                target.addfile(member, original.extractfile(member) if member.isfile() else None)
        base = filtered.getvalue()
        # Benchmark source is the only uncommitted overlay. Concurrent dashboard work is excluded.
        overlay = io.BytesIO()
        with tarfile.open(fileobj=overlay, mode='w') as archive:
            for path in (BENCHMARK / 'harness').rglob('*'):
                if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                    archive.add(path, arcname=RELATIVE + '/' + str(path.relative_to(BENCHMARK)), recursive=False)
            for folder in ('datasets', 'configs', 'sources'):
                for path in (self.data / folder).glob('*'):
                    if path.is_file():
                        if folder == 'sources':
                            if path.suffix == '.partial':
                                continue
                            hasher = hashlib.sha256()
                            with path.open('rb') as source:
                                while chunk := source.read(1024 * 1024):
                                    hasher.update(chunk)
                            if (remote_hashes or {}).get(path.name) == hasher.hexdigest():
                                continue
                        archive.add(path, arcname=RELATIVE + '/data/' + folder + '/' + path.name, recursive=False)
        content = overlay.getvalue()
        for value in self.private.values.values():
            if value and (value.encode() in base or value.encode() in content):
                raise DomainError('SECRET_IN_SOURCE_BUNDLE')
        return base, content

    def install(self):
        # Code/dependency updates are a drained release, not hot configuration reload.
        self.stop_owned_processes()
        inventory = """import pathlib,hashlib,json
p=pathlib.Path('""" + REMOTE_BENCH + """/data/sources'); result={}
if p.exists():
 for f in p.iterdir():
  if f.is_file() and f.suffix!='.partial':
   h=hashlib.sha256()
   with f.open('rb') as r:
    while block:=r.read(1024*1024):h.update(block)
   result[f.name]=h.hexdigest()
print(json.dumps(result))
"""
        import shlex
        hashes = self.ssh('python3 -c ' + shlex.quote(inventory))
        base, overlay = self.bundle(json.loads(hashes.stdout))
        self.ssh('mkdir -p ' + REMOTE_REPO + ' && tar --no-same-owner -xf - -C ' + REMOTE_REPO, data=base)
        self.ssh('tar --no-same-owner -xf - -C ' + REMOTE_REPO, data=overlay)
        config = json.loads((self.data / 'configs/active.json').read_text())
        aliases = sorted({r['secretAlias'] for r in config['routes'].values()} |
                         {s['secretAlias'] for v in config['variants'].values() for s in v.get('roles', {}).values()})
        # Generate scoped credentials on the Pod; no existing provider/account key is transferred.
        init = """import json,secrets,sys
from pathlib import Path
b=Path(sys.argv[1]);aliases=json.load(sys.stdin);p=b/'data/deployment';p.mkdir(parents=True,exist_ok=True,mode=0o700)
existing=p/'relay.json';cap=json.loads(existing.read_text())['relayCapability'] if existing.exists() else secrets.token_urlsafe(40)
f=b/'benchmark.env';f.write_text(''.join(a+'='+cap+'\\n' for a in aliases));f.chmod(0o600)
from harness.main import initialize
initialize(b)
r={'relayCapability':cap};f=p/'relay.json';f.write_text(json.dumps(r));f.chmod(0o600)
from harness.common import Secrets
r['controllerToken']=Secrets(b/'benchmark.env').get('BENCHMARK_CONTROLLER_TOKEN')
print(json.dumps(r))
"""
        import shlex
        command = 'cd ' + REMOTE_BENCH + ' && python3 -c ' + shlex.quote(init) + ' ' + REMOTE_BENCH
        response = self.ssh(command, data=canonical(aliases).encode())
        try:
            credentials = json.loads(response.stdout)
        except ValueError:
            raise DomainError('REMOTE_BOOTSTRAP_FAILED') from None
        atomic(self.deployment / 'relay.json', credentials)
        revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()
        atomic(self.deployment / 'source-revision.json', dict(canonicalRevision=revision,
               baseArchiveSha256=hashlib.sha256(base).hexdigest(), harnessArchiveSha256=hashlib.sha256(overlay).hexdigest()))
        self.ssh('nohup bash ' + REMOTE_BENCH + '/harness/bootstrap-remote.sh ' + REMOTE_REPO + ' >' + REMOTE_BENCH + '/data/deployment/bootstrap.log 2>&1 </dev/null &')

    def stop_owned_processes(self):
        code = """import pathlib,json,sqlite3,os,signal,time
b=pathlib.Path('""" + REMOTE_BENCH + """'); p=b/'data/deployment/processes.json'
if not p.exists():raise SystemExit(0)
db=b/'data/state/benchmark.sqlite3'
if db.exists():
 c=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True)
 active=c.execute("SELECT count(*) FROM tasks WHERE state IN ('leased','submitted','running')").fetchone()[0]
 c.close()
 if active:raise SystemExit(9)
processes=json.loads(p.read_text())
for field,needle in [('controllerPid',b'harness.main'),('runtimePid',b'app'),('supervisorPid',b'harness.remote_runtime')]:
 pid=processes.get(field); f=pathlib.Path('/proc/'+str(pid)+'/cmdline'); cwd=pathlib.Path('/proc/'+str(pid)+'/cwd')
 if f.exists() and needle in f.read_bytes() and str(cwd.resolve()).startswith(str(b.parent)):
  os.kill(pid,signal.SIGTERM)
time.sleep(2)
"""
        import shlex
        result = self.ssh('python3 -c ' + shlex.quote(code), check=False)
        if result.returncode:
            raise DomainError('RUNTIME_DRAIN_REQUIRED')

    def child(self, command, logfile, **kwargs):
        log = (self.deployment / logfile).open('ab')
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, **kwargs)
        log.close()
        self.children.append(process)
        self.save_local_processes()
        return process

    def save_local_processes(self):
        records = []
        for process in self.children:
            observed = subprocess.run(['ps', '-p', str(process.pid), '-o', 'lstart='], capture_output=True, text=True)
            records.append({'pid': process.pid, 'started': observed.stdout.strip()})
        atomic(self.deployment / 'local-processes.json', {'processes': records})

    def local_ports(self, dashboard):
        # A repeated launch only stops verified children of this benchmark launcher.
        path = self.deployment / 'local-processes.json'
        if path.exists():
            for record in json.loads(path.read_text()).get('processes', []):
                pid = record['pid']
                observed = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], capture_output=True, text=True)
                if record.get('started') and observed.stdout.strip() == record['started']:
                    try:
                        os.killpg(pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            time.sleep(.5)
        import socket
        for port in ([28891, 3100] if dashboard else []) + [28890, 8891]:
            with socket.socket() as sock:
                try:
                    sock.bind(('127.0.0.1', port))
                except OSError:
                    raise DomainError('LOCAL_PORT_OCCUPIED_' + str(port)) from None

    def tunnel(self):
        command = self.connection()
        destination = command.pop()
        command += ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', '127.0.0.1:28890:127.0.0.1:8890',
                    '-R', '127.0.0.1:18891:127.0.0.1:8891', destination]
        self.child(command, 'tunnel.log')

    def relay(self):
        return self.child([sys.executable, '-m', 'harness.provider_relay', '--capability-file',
                           str(self.deployment / 'relay.json')], 'relay.log', cwd=BENCHMARK)

    def ensure_started(self):
        code = """import json,pathlib,hashlib,sqlite3
b=pathlib.Path('""" + REMOTE_BENCH + """'); h=b/'harness'
files={str(p.relative_to(h)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(h.rglob('*')) if p.is_file() and p.suffix in {'.py','.mjs','.sql','.sh'}}
revision=hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
p=b/'data/deployment/processes.json';d=json.loads(p.read_text()) if p.exists() else {};c=pathlib.Path('/proc/'+str(d.get('supervisorPid',0))+'/cmdline')
running=bool(c.exists() and b'harness.remote_runtime' in c.read_bytes());active=0;db=b/'data/state/benchmark.sqlite3'
if db.exists():
 conn=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True)
 active=conn.execute("SELECT count(*) FROM runs WHERE state IN ('running','pausing','cancelling')").fetchone()[0];conn.close()
print(json.dumps(dict(revision=revision,running=running,active=active)))
"""
        import shlex
        from .common import digest
        probe = json.loads(self.ssh('python3 -c ' + shlex.quote(code)).stdout)
        directory = BENCHMARK / 'harness'
        local = digest({str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in sorted(directory.rglob('*')) if p.is_file() and p.suffix in {'.py', '.mjs', '.sql', '.sh'}})
        if probe['revision'] != local and not probe['active']:
            self.install()
            return
        if not probe['running']:
            self.ssh('nohup bash ' + REMOTE_BENCH + '/harness/bootstrap-remote.sh ' + REMOTE_REPO + ' >' + REMOTE_BENCH + '/data/deployment/bootstrap.log 2>&1 </dev/null &')

    def api(self, suffix, doc=None, *, key=None, timeout=30):
        credentials = json.loads((self.deployment / 'relay.json').read_text())
        headers = {'Authorization': 'Bearer ' + credentials['controllerToken'], 'Content-Type': 'application/json',
                   'Origin': 'http://127.0.0.1:3100', 'Idempotency-Key': key or 'cli-' + secrets.token_hex(12)}
        req = urllib.request.Request('http://127.0.0.1:28890/api/v1' + suffix, headers=headers,
                                     data=canonical(doc).encode() if doc is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.load(response)
        except Exception:
            raise DomainError('CONTROLLER_UNAVAILABLE') from None

    def backup(self):
        self.ssh('cd ' + REMOTE_BENCH + ' && data/deployment/venv/bin/python -m harness.main backup data/state/pc-backup.sqlite3')
        # The consistent backup includes WAL transactions. No live main-file-only copy.
        result = self.ssh('cat ' + REMOTE_BENCH + '/data/state/pc-backup.sqlite3')
        destination = self.data / 'state/remote-backup.sqlite3'
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix('.partial')
        temporary.write_bytes(result.stdout)
        temporary.chmod(0o600)
        import sqlite3
        db = sqlite3.connect(temporary)
        try:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise DomainError('BACKUP_INVALID')
        finally:
            db.close()
        temporary.replace(destination)
        # Reviewer exports, not licensed media, are mirrored incrementally.
        for r in self.api('/runs')['items']:
            for name, suffix in [('snapshot', ''), ('metrics', '/metrics'), ('results', '/results'), ('tasks', '/tasks')]:
                atomic(self.data / 'exports' / r['id'] / (name + '.json'), self.api('/runs/' + r['id'] + suffix))
        # Preserve completed evidence and canonical job state, including retained source upload handles.
        # No provider credentials or runtime process environment are included.
        import shlex
        code = """import pathlib,tarfile,sys
b=pathlib.Path(sys.argv[1])
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|') as a:
 for name in ['data/artifacts','data/runtime','results']:
  p=b/name
  if p.exists():a.add(p,arcname=name,recursive=True)
"""
        # Incremental source files stay on both disks; a complete evidence checkpoint is taken at
        # stage boundaries, not every polling tick.
        if getattr(self, 'checkpoint_evidence', False):
            captured = self.ssh('python3 -c ' + shlex.quote(code) + ' ' + REMOTE_BENCH)
            target = self.data / 'deployment/remote-evidence.tar'
            temporary = target.with_suffix('.partial')
            temporary.write_bytes(captured.stdout)
            temporary.chmod(0o600)
            temporary.replace(target)
            with tarfile.open(target) as archive:
                for member in archive:
                    dest = (BENCHMARK / member.name).resolve()
                    if not dest.is_relative_to(BENCHMARK.resolve()) or member.issym() or member.islnk():
                        raise DomainError('BACKUP_INVALID')
                for member in archive.getmembers():
                    if member.isfile():
                        source = archive.extractfile(member)
                        destination = BENCHMARK / member.name
                        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                        temporary = destination.with_suffix(destination.suffix + '.partial')
                        with source, temporary.open('wb') as target_file:
                            __import__('shutil').copyfileobj(source, target_file)
                        temporary.chmod(0o600)
                        temporary.replace(destination)
        return {'backup': 'verified', 'at': utc()}

    def wait_ready(self):
        for _ in range(60):
            try:
                if self.api('/health', timeout=3)['availability'] == 'available':
                    return
            except DomainError:
                pass
            time.sleep(2)
        raise DomainError('REMOTE_STARTUP_INCOMPLETE')

    def workflow(self):
        """Exactly one smoke and one frozen pilot; never opens publication expansion."""
        path = self.deployment / 'workflow.json'
        state = json.loads(path.read_text()) if path.exists() else {}
        state.setdefault('slot', identifier('workflow'))
        atomic(path, state)
        profile = json.loads((self.data / 'configs/active.json').read_text())
        variants = profile['protocol']['variantIds']
        for phase, manifest in [('smoke', 'smoke-v1'), ('pilot', 'pilot-v1')]:
            run_id = state.get(phase)
            if not run_id:
                if phase == 'pilot':
                    rows = []
                    for certificate in {state['smoke'], state.get('nativeSmoke', state['smoke'])}:
                        rows += self.api('/runs/' + certificate + '/results?limit=200')['items']
                    smoke_doc = json.loads((self.data / 'datasets/smoke-v1.json').read_text())
                    expected = {(v, q['id']) for v in variants for q in smoke_doc['questions']}
                    passed = {(x['variantId'], x['questionId']) for x in rows if x['state'] == 'completed' and x['correct'] is True}
                    if not expected <= passed:
                        return {'state': 'smoke_requires_review', 'runId': state['smoke']}
                doc = json.loads((self.data / 'datasets' / (manifest + '.json')).read_text())
                requests = state.setdefault('requests', {})
                requests.setdefault(phase, dict(datasetManifestId=manifest, phase=phase, variantIds=variants,
                                                protocolRevision=doc['protocol']['revision']))
                atomic(path, state)
                run = self.api('/runs', requests[phase], key=state['slot'] + '-' + phase)
                state[phase] = run['id']
                atomic(path, state)
                run_id = run['id']
            run = self.api('/runs/' + run_id)
            if run['state'] in {'draft', 'paused'}:
                run = self.api('/runs/' + run_id + ('/start' if run['state'] == 'draft' else '/resume'),
                               {'expectedRevision': run['revision']})
            if run['state'] != 'completed':
                return {'state': run['state'], 'phase': phase, 'runId': run_id}
        return {'state': 'finished', 'runId': state['pilot'], 'decision': run['decision']}

    def stop(self):
        return self.gql('mutation { podStop(input:{podId:' + json.dumps(self.state['podId']) + '}) {id desiredStatus} }')


def launch_session(remote, args):
    stopping = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopping.set())
    idle_checkpointed = args.view_only
    rental_active = False
    connected = False
    detached = False
    dashboard_children = []
    try:
        remote.local_ports(not args.no_dashboard)
        if args.command == 'launch' and not args.view_only:
            rental_active = True  # Also clean up if startup fails after resume was accepted.
            remote.resume()
            remote.ensure_started()
        if not args.view_only:
            remote.tunnel()
            remote.relay()
            remote.wait_ready()
            connected = True
        if not args.no_dashboard:
            candidates = [BENCHMARK / 'dashboard', BENCHMARK / 'dashboard-ui', BENCHMARK / 'apps/video-dashboard']
            dashboard = next((p for p in candidates if (p / 'package.json').exists()), None)
            if dashboard is None:
                raise DomainError('DASHBOARD_NOT_INSTALLED')
            credentials = json.loads((remote.deployment / 'relay.json').read_text())
            dashboard_children.append(remote.child([sys.executable, '-m', 'harness.dashboard_relay'], 'dashboard-relay.log', cwd=BENCHMARK))
            if not (dashboard / 'node_modules/next').exists():
                manager = ['npm', 'ci'] if (dashboard / 'package-lock.json').exists() else ['npm', 'install']
                subprocess.run(manager, cwd=dashboard, check=True, stdout=subprocess.DEVNULL)
            env = {**os.environ, 'BENCHMARK_CONTROLLER_URL': 'http://127.0.0.1:28891',
                   'BENCHMARK_CONTROLLER_TOKEN': credentials['controllerToken'], 'DASHBOARD_MODE': 'proxy', 'PORT': '3100'}
            dashboard_children.append(remote.child(['pnpm', 'run', 'dev'], 'dashboard.log', cwd=dashboard, env=env))
        print(canonical({'controller': None if args.view_only else 'http://127.0.0.1:28890',
                         'dashboard': None if args.no_dashboard else 'http://127.0.0.1:3100',
                         'mode': 'saved-results' if args.view_only else 'remote',
                         'providerKeys': 'PC only; PC and SSH tunnel must remain on during inference'}), flush=True)
        if args.detach:
            detached = True
            return
        ticks = 0
        while not stopping.wait(5):
            if any(p.poll() is not None for p in (dashboard_children if idle_checkpointed else remote.children)):
                raise DomainError('LOCAL_RELAY_OR_DASHBOARD_EXITED')
            if idle_checkpointed:
                continue
            ticks += 1
            progress = remote.workflow() if args.command == 'launch' else {'state': 'connected'}
            if ticks % 12 == 1:
                remote.backup()
                if remote.account()['clientBalance'] < .5:
                    stopping.set()
            if progress['state'] in {'finished', 'blocked', 'smoke_requires_review', 'cancelled', 'failed'}:
                remote.checkpoint_evidence = True
                remote.backup()
                remote.stop()
                rental_active = False
                idle_checkpointed = True
                print(canonical({**progress, 'gpu': 'stopped; dashboard shows verified local snapshot'}), flush=True)
                if args.no_dashboard:
                    break
    finally:
        if not detached:
            try:
                if connected and not idle_checkpointed:
                    for run in remote.api('/runs')['items']:
                        if run['state'] == 'running':
                            remote.api('/runs/' + run['id'] + '/pause', {'expectedRevision': run['revision']})
                    for _ in range(120):
                        if not any(r['state'] == 'pausing' for r in remote.api('/runs')['items']):
                            break
                        time.sleep(2)
                    remote.checkpoint_evidence = True
                    remote.backup()
            finally:
                if rental_active or (connected and not idle_checkpointed):
                    try:
                        remote.stop()
                    except DomainError:
                        print(canonical({'error': 'POD_STOP_FAILED', 'action': 'Run ./launch.sh stop or stop the saved benchmark Pod in RunPod'}), file=sys.stderr)
                for child in remote.children:
                    if child.poll() is None:
                        try:
                            os.killpg(child.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass


def main():
    parser = argparse.ArgumentParser(description='Launch the isolated remote video benchmark and local dashboard')
    parser.add_argument('command', choices=['resume', 'install', 'connect', 'launch', 'backup', 'stop', 'account'])
    parser.add_argument('--no-dashboard', action='store_true')
    parser.add_argument('--detach', action='store_true', help='Connect only; leave private transports running')
    parser.add_argument('--view-only', action='store_true', help='Show saved results without starting or renting GPU compute')
    args = parser.parse_args()
    if args.detach and args.command == 'launch':
        parser.error('Use connect --detach for transports only; launch stays attached to supervise budgets and backups.')
    remote = Remote()
    if args.command == 'resume':
        remote.resume()
        print(canonical({'resumed': remote.state['podId']}))
    elif args.command == 'install':
        remote.install()
        print(canonical({'installed': True, 'providerKeysTransferred': False}))
    elif args.command == 'backup':
        remote.checkpoint_evidence = True
        print(canonical(remote.backup()))
    elif args.command == 'stop':
        print(canonical(remote.stop()))
    elif args.command == 'account':
        print(canonical(remote.account()))
    else:
        launch_session(remote, args)


if __name__ == '__main__':
    try:
        main()
    except DomainError as e:
        print(canonical({'error': e.issue()}), file=sys.stderr)
        raise SystemExit(2)
    except (OSError, ValueError, subprocess.SubprocessError):
        print(canonical({'error': {'code': 'LAUNCH_SETUP_FAILED', 'message': 'Check local dependencies and private deployment files.'}}), file=sys.stderr)
        raise SystemExit(2)
