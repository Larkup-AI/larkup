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
import urllib.error
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
        except urllib.error.HTTPError as error:
            if error.code in {401,403}:raise DomainError('RUNPOD_AUTH_INVALID') from None
            raise DomainError('RUNPOD_API_UNAVAILABLE') from None
        except Exception:
            raise DomainError('RUNPOD_API_UNAVAILABLE') from None
        if result.get('errors'):
            messages = ' '.join(str(e.get('message', '')).lower() for e in result['errors'])
            if any(value in messages for value in ('not enough free gpu', 'zero gpu', 'no longer any instances available')):
                raise DomainError('RUNPOD_GPU_UNAVAILABLE')
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

    def resume(self, *, on_progress=None, check_cancelled=None, sleep=None, clock=None, require_choice=False):
        """Retry saved-host capacity, then restore a bounded alternative when needed."""
        from datetime import datetime,timedelta,timezone
        pause=sleep or time.sleep;now=clock or time.monotonic
        check=check_cancelled or (lambda:None)
        from .gpu_capacity import load_policy
        policy=load_policy(self)
        attempt=0;boot_deadline=None;last=None
        def report(phase,**fields):
            nonlocal last
            value={'phase':phase,'attempt':attempt,'nextRetryAt':None,**fields}
            if value==last:return
            last=value
            if on_progress:on_progress(value)
            else:print(canonical({'startup':value}),flush=True)
        def wait(seconds):
            deadline=now()+seconds
            while now()<deadline:
                check();pause(min(1,deadline-now()))
            check()
        if require_choice:
            pod=self.gql('query { pod(input:{podId:'+json.dumps(self.state['podId'])+'}) { desiredStatus } }')['pod']
            if pod and pod['desiredStatus']=='EXITED':
                while True:
                    check()
                    report('waiting_capacity',stage='Checking GPU types and prices now. No rental is submitted until you choose an offer.')
                    if self.capacity_fallback(attempt=policy.afterFailures,check=check,report=report):
                        report('ready',stage='Selected GPU restored. Preparing benchmark services.');return
                    report('waiting_capacity',stage='Waiting for your next GPU offer check in 60 seconds.',retrySeconds=60)
                    wait(60)
        journal=self.deployment/'gpu-relocation.json'
        if journal.exists() and json.loads(journal.read_text()).get('status') in {'allocating','allocated','restoring','cleanup_required'}:
            if self.capacity_fallback(attempt=policy.afterFailures,check=check,report=report):
                report('ready',stage='Alternative GPU restored. Preparing benchmark services.');check();return
        while True:
            check()
            if boot_deadline is not None and now()>=boot_deadline:
                raise DomainError('RUNPOD_STARTUP_INCOMPLETE')
            if boot_deadline is None and self.account()['clientBalance']<1:
                raise DomainError('CREDIT_EXHAUSTED')
            check()
            pod=self.gql('query { pod(input:{podId:'+json.dumps(self.state['podId'])+'}) { id desiredStatus runtime { ports { ip isIpPublic privatePort publicPort } } } }')['pod']
            check()
            if not pod:raise DomainError('RUNPOD_POD_NOT_FOUND')
            ports=(pod.get('runtime') or {}).get('ports',[])
            port=next((p for p in ports if p['privatePort']==22 and p['isIpPublic']),None)
            if pod['desiredStatus']=='RUNNING' and port:
                self.state.update(sshHost=port['ip'],sshPort=port['publicPort'])
                atomic(self.deployment/'remote.json',self.state)
                if boot_deadline is None:boot_deadline=now()+900
                probe=self.ssh('true',check=False)
                check()
                if probe.returncode==0:
                    report('ready',stage='GPU and SSH are ready. Preparing benchmark services.')
                    check();return
                reason=probe.stderr.lower()
                if b'permission denied' in reason:raise DomainError('SSH_AUTH_INVALID')
                if b'host key verification failed' in reason or b'remote host identification has changed' in reason:
                    raise DomainError('SSH_HOST_KEY_CHANGED')
                report('starting_gpu',stage='GPU is awake. Waiting for its SSH service to accept connections.')
                wait(min(5,max(0,boot_deadline-now())));continue
            if pod['desiredStatus']!='RUNNING' and boot_deadline is None:
                attempt+=1;check()
                try:
                    self.gql('mutation { podResume(input:{podId:'+json.dumps(self.state['podId'])+',gpuCount:1}) {id desiredStatus} }')
                except DomainError as error:
                    if error.code!='RUNPOD_GPU_UNAVAILABLE':raise
                    if attempt>=policy.afterFailures and self.capacity_fallback(attempt=attempt,check=check,report=report):
                        report('ready',stage='Alternative GPU restored. Preparing benchmark services.');check();return
                    delay=min(120,policy.retrySeconds*(1 if attempt==1 else 2))
                    report('waiting_capacity',retrySeconds=delay,
                           nextRetryAt=(datetime.now(timezone.utc)+timedelta(seconds=delay)).isoformat(),
                           stage='Waiting for GPU capacity. Retrying the saved host and bounded alternatives in '+str(delay)+' seconds automatically.')
                    wait(delay);continue
                boot_deadline=now()+900
                report('starting_gpu',stage='RunPod accepted start. Waiting for the GPU and SSH service.')
                check();continue
            if boot_deadline is None:boot_deadline=now()+900
            report('starting_gpu',stage='RunPod is waking up. Waiting for the GPU and SSH service.')
            wait(min(5,max(0,boot_deadline-now())))

    def capacity_fallback(self, **kwargs):
        from .gpu_capacity import relocate
        return relocate(self, **kwargs)

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
        init = """import json,sys
from pathlib import Path
from harness.container_credentials import install
from harness.main import initialize
b=Path(sys.argv[1]);document=json.load(sys.stdin)
r=install(b,document['aliases'],document['relayCapability'],document['controllerToken'],document['runtimeToken'])
initialize(b)
print(json.dumps(r))
"""
        import shlex
        command = 'cd ' + REMOTE_BENCH + ' && python3 -c ' + shlex.quote(init) + ' ' + REMOTE_BENCH
        credentials=json.loads((self.deployment/'relay.json').read_text())
        response = self.ssh(command, data=canonical(dict(aliases=aliases,relayCapability=credentials['relayCapability'],controllerToken=credentials['controllerToken'],runtimeToken=secrets.token_urlsafe(40))).encode())
        try:
            credentials = json.loads(response.stdout)
        except ValueError:
            raise DomainError('REMOTE_BOOTSTRAP_FAILED') from None
        atomic(self.deployment / 'relay.json', credentials)
        self.ssh('cd '+REMOTE_BENCH+' && python3 -m harness.main reload data/configs/active.json')
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
# Recover an earlier supervisor whose PID file was overwritten by an overlapping startup.
# Only this benchmark's exact working directory and module qualify as owned processes.
for proc in pathlib.Path('/proc').glob('[0-9]*'):
 try:
  if (proc/'cwd').resolve()==b and b'harness.remote_runtime' in (proc/'cmdline').read_bytes():
   processes['supervisorPid_'+proc.name]=int(proc.name)
 except (OSError,RuntimeError):pass
for field,pid in processes.items():
 if field.startswith('supervisorPid_'):
  try:os.kill(pid,signal.SIGTERM)
  except ProcessLookupError:pass
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
        import fcntl
        with (self.deployment / 'processes.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            path = self.deployment / 'local-processes.json'
            old = json.loads(path.read_text()).get('processes', []) if path.exists() else []
            own = {p.pid for p in self.children}
            records = [r for r in old if r['pid'] not in own]
            for process in self.children:
                observed = subprocess.run(['ps', '-p', str(process.pid), '-o', 'lstart='], capture_output=True, text=True)
                args = ' '.join(map(str, process.args))
                service = ('credential relay' if 'harness.provider_relay' in args else 'dashboard bridge' if 'harness.dashboard_relay' in args
                           else 'ssh tunnel' if process.args[0] == 'ssh' else 'dashboard')
                records.append({'pid': process.pid, 'started': observed.stdout.strip(), 'service': service})
            atomic(path, {'processes': records})

    def stop_local_services(self, services):
        path = self.deployment / 'local-processes.json'
        if not path.exists():
            return
        for record in json.loads(path.read_text()).get('processes', []):
            service = record.get('service')
            if service is None:
                command = subprocess.run(['ps', '-p', str(record['pid']), '-o', 'command='], capture_output=True, text=True).stdout
                service = 'credential relay' if 'harness.provider_relay' in command else 'ssh tunnel' if command.strip().startswith('ssh ') and self.state['keyPath'] in command else None
            if service not in services:
                continue
            observed = subprocess.run(['ps', '-p', str(record['pid']), '-o', 'lstart='], capture_output=True, text=True).stdout.strip()
            if record.get('started') and observed == record['started']:
                try:
                    os.killpg(record['pid'], signal.SIGTERM)
                except ProcessLookupError:
                    pass
        time.sleep(.3)

    def local_ports(self, dashboard, *, preserve_transports=False):
        # A repeated launch only stops verified children of this benchmark launcher.
        path = self.deployment / 'local-processes.json'
        if path.exists():
            for record in json.loads(path.read_text()).get('processes', []):
                if preserve_transports:
                    command = subprocess.run(['ps', '-p', str(record['pid']), '-o', 'command='], capture_output=True, text=True).stdout
                    if record.get('service') in {'ssh tunnel','credential relay'} or command.strip().startswith('ssh ') or 'harness.provider_relay' in command:
                        continue
                pid = record['pid']
                observed = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], capture_output=True, text=True)
                if record.get('started') and observed.stdout.strip() == record['started']:
                    try:
                        os.killpg(pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            time.sleep(.5)
        import socket
        for port in ([28891, 3100] if dashboard else []) + ([] if preserve_transports else [28890, 8891]):
            with socket.socket() as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
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
print(json.dumps(dict(revision=revision,running=running,active=active,privateReady=(b/'benchmark.env').is_file() and (b/'data/deployment/tokens.env').is_file())))
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
        if not probe.get('privateReady',True):
            self.install()
            return
        if not probe['running']:
            self.ssh('nohup bash ' + REMOTE_BENCH + '/harness/bootstrap-remote.sh ' + REMOTE_REPO + ' >' + REMOTE_BENCH + '/data/deployment/bootstrap.log 2>&1 </dev/null &')

    def api(self, suffix, doc=None, *, key=None, timeout=30):
        credentials = json.loads((self.deployment / 'relay.json').read_text())
        headers = {'Authorization': 'Bearer ' + credentials['controllerToken'], 'Content-Type': 'application/json',
                   'Origin': 'http://127.0.0.1:3100', 'Idempotency-Key': key or 'cli-' + secrets.token_hex(12)}
        if doc is not None and suffix.startswith('/runs/') and suffix.rsplit('/',1)[-1] in {'start','resume'}:
            from .gpu_capacity import invalidate_checkpoint
            invalidate_checkpoint(self)
        req = urllib.request.Request('http://127.0.0.1:28890/api/v1' + suffix, headers=headers,
                                     data=canonical(doc).encode() if doc is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.load(response)
        except Exception:
            raise DomainError('CONTROLLER_UNAVAILABLE') from None

    def backup(self):
        import fcntl
        with (self.deployment / 'backup.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            return self._backup()

    def _backup(self):
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
        # Fetch every page; larger cohorts must not silently truncate saved progress.
        for r in self.api_items('/runs'):
            for name, suffix in [('snapshot', ''), ('metrics', '/metrics'), ('results', '/results'), ('tasks', '/tasks')]:
                endpoint = '/runs/' + r['id'] + suffix
                value = {'items': self.api_items(endpoint), 'hasMore': False, 'nextCursor': None} if suffix in {'/results', '/tasks'} else self.api(endpoint)
                atomic(self.data / 'exports' / r['id'] / (name + '.json'), value)
        # Preserve completed evidence and canonical job state, including retained source upload handles.
        # No provider credentials or runtime process environment are included.
        import shlex
        code = """import pathlib,tarfile,sys
b=pathlib.Path(sys.argv[1])
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|') as a:
 for name in ['data/artifacts','data/runtime','results']:
  p=b/name
  if p.exists():a.add(p,arcname=name,recursive=True)
 for name in ['controller.log','runtime.log','bootstrap.log']:
  p=b/'data/deployment'/name
  if p.exists():a.add(p,arcname='data/deployment/remote-logs/'+name,recursive=False)
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
        if getattr(self, 'checkpoint_evidence', False):
            from .gpu_capacity import capture_checkpoint
            try:capture_checkpoint(self)
            except DomainError as error:
                if error.code!='RECOVERY_CHECKPOINT_UNSAFE':raise
        return {'backup': 'verified', 'at': utc()}

    def api_items(self, path):
        from urllib.parse import urlencode
        items, cursor = [], None
        while True:
            page = self.api(path + ('&' if '?' in path else '?') + urlencode({'limit': 200, **({'cursor': cursor} if cursor else {})}))
            items.extend(page['items'])
            if not page.get('hasMore'):
                return items
            next_cursor = page.get('nextCursor')
            if not next_cursor or next_cursor == cursor:
                raise DomainError('CONTROLLER_PAGINATION_INVALID')
            cursor = next_cursor

    def wait_ready(self, *, check_cancelled=None, sleep=None, clock=None):
        pause=sleep or time.sleep;now=clock or time.monotonic
        check=check_cancelled or (lambda:None);deadline=now()+900
        while now()<deadline:
            check()
            try:
                if self.api('/health',timeout=3)['availability']=='available':
                    services=self.api('/services',timeout=5)['items']
                    if any(s['name']=='canonical video runtime' and s['state']=='running' for s in services):
                        ready=True
                    else:ready=False
                else:ready=False
            except DomainError:
                ready=False
            check()
            if ready:return
            for _ in range(2):check();pause(1)
        raise DomainError('REMOTE_STARTUP_INCOMPLETE')

    def workflow(self):
        import fcntl
        with (self.deployment / 'workflow.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            return self._workflow()

    def _workflow(self):
        """Monitor an explicit selection or the saved smoke/pilot; never expand to publication."""
        from .run_selection import status
        current = status(self)
        if current:
            return current
        if not hasattr(self, 'workflow_admitted'):
            self.workflow_admitted = set()
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
                    from .run_selection import service_check_completed
                    passed = {(x['variantId'], x['questionId']) for x in rows if service_check_completed(x)}
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
            if run['state'] == 'draft' or (run['state'] == 'paused' and run_id not in self.workflow_admitted):
                run = self.api('/runs/' + run_id + ('/start' if run['state'] == 'draft' else '/resume'),
                               {'expectedRevision': run['revision']})
            self.workflow_admitted.add(run_id)
            if run['state'] != 'completed':
                return {'state': run['state'], 'phase': phase, 'runId': run_id}
        return {'state': 'finished', 'runId': state['pilot'], 'decision': run['decision']}

    def stop(self):
        try:
            result = self.gql('mutation { podStop(input:{podId:' + json.dumps(self.state['podId']) + '}) {id desiredStatus} }')
        except DomainError:
            pod = self.gql('query { pod(input:{podId:' + json.dumps(self.state['podId']) + '}) { id desiredStatus } }')['pod']
            if not pod or pod['desiredStatus'] != 'EXITED':
                raise
            result = {'podStop': pod}
        atomic(self.deployment / 'pod-observation.json', {'state': result['podStop']['desiredStatus'], 'observedAt': utc()})
        return result


def launch_session(remote, args):
    stopping = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopping.set())
    from .operations import intent, control_lock
    def check_startup_cancelled():
        if stopping.is_set():raise DomainError('START_CANCELLED')
    manual = args.command == 'dashboard'
    idle_checkpointed = args.view_only or manual
    rental_active = False
    connected = False
    detached = False
    dashboard_children = []
    try:
        if args.command in {'new','resume-run'} and not args.view_only:
            try:
                live=remote.api('/health',timeout=1).get('availability')=='available'
            except DomainError:live=False
            if live:
                from .run_selection import assert_available
                assert_available(remote,args.run_id if args.command=='resume-run' else None)
        remote.local_ports(not args.no_dashboard, preserve_transports=args.view_only or manual)
        if args.command in {'launch','new','resume-run'} and not args.view_only:
            rental_active = True  # Also clean up if startup fails after resume was accepted.
            print('Starting RunPod GPU; compatible alternatives are bounded by the configured hourly cap.', flush=True)
            remote.resume(check_cancelled=check_startup_cancelled)
            print('Checking the canonical runtime and controller version…', flush=True)
            remote.ensure_started()
        if not args.view_only and not manual:
            print('Opening private SSH forwarding and the PC credential relay…', flush=True)
            remote.tunnel()
            remote.relay()
            remote.wait_ready(check_cancelled=check_startup_cancelled)
            connected = True
            if args.command in {'new','resume-run'}:
                from .run_selection import create,activate
                chosen = create(remote,identifier('cli')) if args.command=='new' else activate(remote,args.run_id)
                print('Tracking run: '+chosen['runId'],flush=True)
                print('Dashboard: http://127.0.0.1:3100/?run='+chosen['runId'],flush=True)
            intent(remote.deployment, 'active')
        elif manual:
            intent(remote.deployment, 'observe')
        if not args.no_dashboard:
            candidates = [BENCHMARK / 'dashboard', BENCHMARK / 'dashboard-ui', BENCHMARK / 'apps/video-dashboard']
            dashboard = next((p for p in candidates if (p / 'package.json').exists()), None)
            if dashboard is None:
                raise DomainError('DASHBOARD_NOT_INSTALLED')
            credentials = json.loads((remote.deployment / 'relay.json').read_text())
            dashboard_children.append(remote.child([sys.executable, '-m', 'harness.dashboard_relay'], 'dashboard-relay.log', cwd=BENCHMARK,
                env={**os.environ, 'BENCHMARK_VIEW_ONLY': '1' if args.view_only else '0'}))
            if not (dashboard / 'node_modules/next').exists():
                manager = ['npm', 'ci'] if (dashboard / 'package-lock.json').exists() else ['npm', 'install']
                subprocess.run(manager, cwd=dashboard, check=True, stdout=subprocess.DEVNULL)
            env = {**os.environ, 'BENCHMARK_CONTROLLER_URL': 'http://127.0.0.1:28891',
                   'BENCHMARK_CONTROLLER_TOKEN': credentials['controllerToken'], 'DASHBOARD_MODE': 'proxy', 'BENCHMARK_READ_ONLY': '1' if args.view_only else '0', 'PORT': '3100'}
            dashboard_children.append(remote.child(['pnpm', 'run', 'dev'], 'dashboard.log', cwd=dashboard, env=env))
        print(canonical({'controller': None if args.view_only else 'http://127.0.0.1:28890',
                         'dashboard': None if args.no_dashboard else 'http://127.0.0.1:3100',
                         'mode': 'saved-results' if args.view_only else 'dashboard-control' if manual else 'remote',
                         'providerKeys': 'PC only; PC and SSH tunnel must remain on during inference'}), flush=True)
        if args.detach:
            detached = True
            return
        ticks = 0
        previous_progress = None
        while not stopping.wait(5):
            mode = intent(remote.deployment)['mode'] if not args.view_only else 'observe'
            if mode in {'observe', 'stopped', 'starting', 'waiting_gpu'}:
                idle_checkpointed = True
            elif mode == 'active':
                idle_checkpointed = False
                connected = True
                path = remote.deployment / 'remote.json'
                if path.exists():
                    remote.state = json.loads(path.read_text())
            if any(p.poll() is not None for p in (dashboard_children if idle_checkpointed or manual else remote.children)):
                raise DomainError('LOCAL_RELAY_OR_DASHBOARD_EXITED')
            if idle_checkpointed:
                continue
            ticks += 1
            progress = remote.workflow() if args.command in {'launch','dashboard','new','resume-run'} and mode == 'active' else {'state': 'paused' if mode == 'paused' else 'connected'}
            if mode == 'paused':
                if ticks % 12 == 1:
                    from .idle_monitor import checkpoint
                    checkpoint(remote)
                    if remote.account()['clientBalance'] < .5:
                        stopping.set()
                continue
            signature = canonical(progress)
            if signature != previous_progress or ticks % 6 == 0:
                print('Benchmark ' + progress.get('runId', '') + ': ' + progress['state'], flush=True)
                print(canonical({'benchmark': progress}), flush=True)
                if progress.get('runId'):
                    current = remote.api('/runs/' + progress['runId'])
                    print(canonical({'runId':current['id'],'tasks':current['taskCounts'],'coverage':current['coverage'],'cost':current['cost'],'providers':remote.api('/runs/'+current['id']+'/metrics').get('summary',[])}), flush=True)
                previous_progress = signature
            if ticks % 12 == 1:
                remote.backup()
                if remote.account()['clientBalance'] < .5:
                    stopping.set()
            if progress['state'] in {'finished', 'blocked', 'smoke_requires_review', 'cancelled', 'failed'}:
                with control_lock(remote.deployment):
                    if progress.get('runId'):
                        observed = remote.api('/runs/' + progress['runId'])
                        if observed['state'] in {'running', 'pausing', 'paused'}:
                            continue
                    intent(remote.deployment, 'stopping')
                    remote.checkpoint_evidence = True
                    remote.backup()
                    remote.stop()
                    rental_active = False
                    intent(remote.deployment, 'stopped')
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
                if rental_active or connected or (manual and intent(remote.deployment)['mode'] != 'observe'):
                    try:
                        remote.stop()
                    except DomainError:
                        print(canonical({'error': 'POD_STOP_FAILED', 'action': 'Run ./launch.sh stop or stop the saved benchmark Pod in RunPod'}), file=sys.stderr)
                if not args.view_only and (rental_active or connected or (manual and intent(remote.deployment)['mode'] != 'observe')):
                    remote.stop_local_services({'ssh tunnel', 'credential relay'})
                for child in remote.children:
                    if child.poll() is None:
                        try:
                            os.killpg(child.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass


def main():
    parser = argparse.ArgumentParser(description='Launch the isolated remote video benchmark and local dashboard')
    parser.add_argument('command', choices=['resume', 'install', 'connect', 'launch', 'backup', 'stop', 'account', 'status', 'dashboard', 'new', 'resume-run'])
    parser.add_argument('run_id', nargs='?')
    parser.add_argument('--no-dashboard', action='store_true')
    parser.add_argument('--detach', action='store_true', help='Connect only; leave private transports running')
    parser.add_argument('--view-only', action='store_true', help='Show saved results without starting or renting GPU compute')
    args = parser.parse_args()
    if args.detach and args.command in {'launch','new','resume-run'}:
        parser.error('Use connect --detach for transports only; launch stays attached to supervise budgets and backups.')
    if args.command == 'resume-run' and not args.run_id:
        parser.error('resume-run requires the selected RUN_ID')
    if args.view_only and args.command in {'new','resume-run'}:
        parser.error('new/resume-run cannot be combined with --view-only')
    remote = Remote()
    if args.command == 'status':
        from .store import Store
        from .scoring import metrics
        database = remote.data / 'state/remote-backup.sqlite3'
        if not database.exists():
            raise DomainError('NO_OFFLINE_SNAPSHOT')
        store = Store(database, readonly=True)
        try:
            print('Saved local checkpoint (may be stale): ' + __import__('datetime').datetime.fromtimestamp(database.stat().st_mtime, __import__('datetime').timezone.utc).isoformat())
            for row in store.rows('SELECT id FROM runs ORDER BY updated_at DESC'):
                run = store.snapshot(row['id'])
                print('\n' + run['id'] + ' | ' + run['phase'] + ' | ' + run['state'] + ' | decision: ' + run['decision'])
                print('System | Correct | Incorrect | Completed/planned | Known cash USD | Estimated USD | Unknown attempts')
                for item in metrics(store, row['id'])['summary']:
                    cost = item['cost']
                    print(' | '.join(map(str, [item['variantId'], item['correctCount'], item['incorrectCount'],
                                               str(item['completedCount']) + '/' + str(item['plannedCount']),
                                               cost['actual'] if cost['actual'] is not None else 'unknown',
                                               cost['estimated'] if cost['estimated'] is not None else 'unknown', cost['unknownAttemptCount']])))
            print('\nKnown cash may be partial. Estimates are a separate view; do not add them to cash. Rental/storage is separate.')
        finally:
            store.close()
    elif args.command == 'resume':
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
        import fcntl
        with (remote.deployment / 'launcher.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                if args.command=='dashboard':
                    credentials=json.loads((remote.deployment/'relay.json').read_text())
                    request=urllib.request.Request('http://127.0.0.1:28891/api/v1/system',headers={'Authorization':'Bearer '+credentials['controllerToken']})
                    try:
                        with urllib.request.urlopen(request,timeout=5) as response:json.load(response)
                    except (OSError,ValueError):raise DomainError('EXISTING_DASHBOARD_UNREACHABLE') from None
                    print('Dashboard is already running: http://127.0.0.1:3100 — existing startup and GPU reservation preserved.',flush=True)
                    return
                if args.command in {'new','resume-run'}:
                    from .run_selection import request_existing
                    request_existing(remote,args);return
                raise DomainError('LAUNCHER_ALREADY_RUNNING') from None
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
