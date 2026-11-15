"""Bounded RunPod capacity search and checkpoint-based benchmark relocation."""
from __future__ import annotations

import copy
import fcntl
import hashlib
import json
import math
import re
import secrets
import shlex
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath

from .common import DomainError, atomic, canonical, identifier, utc


@dataclass(frozen=True)
class Policy:
    enabled: bool = True
    retrySeconds: int = 60
    afterFailures: int = 2
    maxHourlyUsd: float = .75
    minMemoryGb: int = 24
    minCudaVersion: str = '12.8'
    maxCandidatesPerPass: int = 3
    templateId: str | None = None

    @classmethod
    def from_document(cls, document):
        try:
            if set(document) - set(asdict(cls())):
                raise ValueError()
            policy = cls(**document)
            if type(policy.enabled) is not bool:
                raise ValueError()
            for key, low, high in [('retrySeconds', 60, 120), ('afterFailures', 1, 5),
                                   ('minMemoryGb', 16, 192), ('maxCandidatesPerPass', 1, 5)]:
                value = getattr(policy, key)
                if type(value) is not int or not low <= value <= high:
                    raise ValueError()
            if type(policy.maxHourlyUsd) not in {float, int} or not math.isfinite(policy.maxHourlyUsd) or not 0 < policy.maxHourlyUsd <= 5:
                raise ValueError()
            if not isinstance(policy.minCudaVersion, str) or not re.fullmatch(r'\d+\.\d+', policy.minCudaVersion):
                raise ValueError()
            if policy.templateId is not None and (not isinstance(policy.templateId, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', policy.templateId)):
                raise ValueError()
            return policy
        except (TypeError, ValueError):
            raise DomainError('GPU_CAPACITY_POLICY_INVALID') from None

    def budget(self, original, round_number):
        original = float(original or self.maxHourlyUsd)
        return min(self.maxHourlyUsd, original * (1 + .15 * min(max(0, round_number), 20)))


def load_policy(remote):
    path = remote.deployment / 'gpu-policy.json'
    return Policy.from_document(json.loads(path.read_text()) if path.exists() else {})


def candidates(rows, cloud, budget, policy):
    result = []
    for item in rows:
        price = (item.get('lowestPrice') or {}).get('uninterruptablePrice')
        if not item.get('id', '').startswith('NVIDIA ') or item.get('memoryInGb', 0) < policy.minMemoryGb:
            continue
        if not isinstance(price, (int, float)) or not math.isfinite(price) or not 0 < price <= budget:
            continue
        result.append({'gpuTypeId': item['id'], 'cloudType': cloud, 'quotedHourlyUsd': price})
    return sorted(result, key=lambda item: (item['quotedHourlyUsd'], item['gpuTypeId']))


def ranked_candidates(available, history, now):
    # Rejected cheap quotes must not starve the next compatible price tier.
    return sorted(available, key=lambda item: (
        now - history.get(item['cloudType'] + ':' + item['gpuTypeId'], 0) < 600,
        history.get(item['cloudType'] + ':' + item['gpuTypeId'], 0) if now - history.get(item['cloudType'] + ':' + item['gpuTypeId'], 0) < 600 else 0,
        item['quotedHourlyUsd'], item['gpuTypeId'], item['cloudType']))


def file_hash(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block := stream.read(1024 * 1024):
            value.update(block)
    return value.hexdigest()


@contextmanager
def checkpoint_lock(remote):
    directory = remote.deployment / 'recovery-checkpoint'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / 'checkpoint.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield directory


def idle_database(path):
    try:
        with sqlite3.connect('file:' + str(path) + '?mode=ro&immutable=1', uri=True) as db:
            return (db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
                    and not db.execute("SELECT 1 FROM runs WHERE state IN ('running','pausing','cancelling') LIMIT 1").fetchone()
                    and not db.execute("SELECT 1 FROM tasks WHERE state IN ('leased','running','submitted') LIMIT 1").fetchone())
    except sqlite3.Error:
        return False


def capture_checkpoint(remote):
    database = remote.data / 'state/remote-backup.sqlite3'
    evidence = remote.deployment / 'remote-evidence.tar'
    if not database.exists() or not evidence.exists() or not idle_database(database):
        raise DomainError('RECOVERY_CHECKPOINT_UNSAFE')
    with checkpoint_lock(remote) as directory:
        generation = identifier('checkpoint')
        db_copy = directory / (generation + '.sqlite3')
        evidence_copy = directory / (generation + '.tar')
        shutil.copyfile(database, db_copy); db_copy.chmod(0o600)
        shutil.copyfile(evidence, evidence_copy); evidence_copy.chmod(0o600)
        result = dict(generation=generation, sourcePodId=remote.state['podId'], createdAt=utc(),
                      database=str(db_copy), evidence=str(evidence_copy),
                      databaseSha256=file_hash(db_copy), evidenceSha256=file_hash(evidence_copy))
        atomic(directory / 'manifest.json', result)
        # Only generated checkpoint copies are eligible for cleanup; retain the preceding copy.
        manifests = sorted(directory.glob('checkpoint-*.sqlite3'), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in manifests[2:]:
            old.unlink(missing_ok=True); old.with_suffix('.tar').unlink(missing_ok=True)
        return result


def invalidate_checkpoint(remote):
    with checkpoint_lock(remote) as directory:
        path = directory / 'manifest.json'
        if path.exists():
            document = json.loads(path.read_text()); document['dirtySince'] = utc(); atomic(path, document)


def checkpoint(remote):
    with checkpoint_lock(remote) as directory:
        path = directory / 'manifest.json'
        if not path.exists():
            raise DomainError('RECOVERY_CHECKPOINT_REQUIRED')
        result = json.loads(path.read_text())
        if result.get('dirtySince') or result.get('sourcePodId') != remote.state['podId']:
            raise DomainError('RECOVERY_CHECKPOINT_UNSAFE')
        for key in ['database', 'evidence']:
            target = Path(result[key])
            if target.parent.resolve() != directory.resolve() or not target.is_file() or file_hash(target) != result[key + 'Sha256']:
                raise DomainError('RECOVERY_CHECKPOINT_INVALID')
        if not idle_database(result['database']):
            raise DomainError('RECOVERY_CHECKPOINT_UNSAFE')
        return result


def validate_evidence(path):
    allowed = ['data/artifacts', 'data/runtime', 'results', 'data/deployment/remote-logs']
    with tempfile.TemporaryDirectory() as temporary, tarfile.open(path) as archive:
        databases = []
        for member in archive:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not (member.isfile() or member.isdir()) or not any(str(name) == prefix or str(name).startswith(prefix + '/') for prefix in allowed):
                raise DomainError('RECOVERY_CHECKPOINT_INVALID')
            # Validate canonical SQLite state together with any WAL before a worker can resume.
            if member.isfile() and str(name).startswith('data/runtime/') and any(str(name).endswith(suffix) for suffix in ('.db','.db-wal','.sqlite','.sqlite-wal','.sqlite3','.sqlite3-wal')):
                destination = Path(temporary) / str(name)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, destination.open('wb') as target:
                    shutil.copyfileobj(source, target)
                if str(name).endswith(('.db','.sqlite','.sqlite3')):
                    databases.append(destination)
        for database in databases:
            try:
                with sqlite3.connect(str(database)) as db:
                    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                        raise DomainError('RECOVERY_CHECKPOINT_INVALID')
                    has_jobs = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").fetchone()
                    if has_jobs and db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running') LIMIT 1").fetchone():
                        raise DomainError('RECOVERY_RUNTIME_BUSY')
            except sqlite3.Error:
                raise DomainError('RECOVERY_CHECKPOINT_INVALID') from None


def cancellable_ssh(target, command, *, data=None, check_result=True, check):
    arguments = target.connection() + [command]
    process = subprocess.Popen(arguments, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    first = True; deadline = time.monotonic() + 900
    try:
        while time.monotonic() < deadline:
            check()
            try:
                stdout, stderr = process.communicate(input=data if first else None, timeout=1)
                result = subprocess.CompletedProcess(arguments, process.returncode, stdout, stderr)
                if check_result and result.returncode:
                    raise DomainError('SSH_OPERATION_FAILED')
                return result
            except subprocess.TimeoutExpired:
                first = False
        raise DomainError('SSH_OPERATION_TIMEOUT')
    except BaseException:
        if process.poll() is None:
            process.kill(); process.communicate()
        raise


def wait_ssh(target, check, report):
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        check()
        pod = target.gql('query { pod(input:{podId:' + json.dumps(target.state['podId']) + '}) { desiredStatus runtime { ports { ip isIpPublic privatePort publicPort } } } }')['pod']
        if not pod:
            raise DomainError('RUNPOD_POD_NOT_FOUND')
        port = next((p for p in (pod.get('runtime') or {}).get('ports', []) if p['privatePort'] == 22 and p['isIpPublic']), None)
        if port:
            target.state.update(sshHost=port['ip'], sshPort=port['publicPort'])
            probe = target.ssh('true', check=False)
            if probe.returncode == 0:
                return
            if b'permission denied' in probe.stderr.lower():
                raise DomainError('SSH_AUTH_INVALID')
        report('starting_gpu', stage='Alternative GPU allocated. Waiting for its SSH service; no benchmark has started.')
        for _ in range(5):
            check(); time.sleep(1)
    raise DomainError('RUNPOD_STARTUP_INCOMPLETE')


def restore_target(remote, target, saved, check, report):
    from .remote import REMOTE_BENCH
    validate_evidence(saved['evidence'])
    check(); target.ssh('mkdir -p ' + REMOTE_BENCH + '/data/state ' + REMOTE_BENCH + '/data/deployment')
    report('starting_gpu', stage='Restoring the verified benchmark checkpoint onto the alternative GPU. Saved answers are preserved.')
    check(); target.ssh('cat > ' + REMOTE_BENCH + '/data/state/benchmark.sqlite3', data=Path(saved['database']).read_bytes())
    check(); target.ssh('tar --no-same-owner -xf - -C ' + REMOTE_BENCH, data=Path(saved['evidence']).read_bytes())
    proof = target.ssh("python3 -c " + shlex.quote("import hashlib,pathlib;print(hashlib.sha256(pathlib.Path('" + REMOTE_BENCH + "/data/state/benchmark.sqlite3').read_bytes()).hexdigest())"))
    if proof.stdout.decode().strip() != saved['databaseSha256']:
        raise DomainError('RECOVERY_CHECKPOINT_INVALID')
    credentials = json.loads((remote.deployment / 'relay.json').read_text())
    tokens = 'BENCHMARK_CONTROLLER_TOKEN=' + credentials['controllerToken'] + '\nBENCHMARK_RUNTIME_TOKEN=' + secrets.token_urlsafe(40) + '\n'
    target.ssh('umask 077; cat > ' + REMOTE_BENCH + '/data/deployment/tokens.env', data=tokens.encode())
    target.ssh('umask 077; cat > ' + REMOTE_BENCH + '/data/deployment/relay.json', data=canonical(credentials).encode())
    check(); report('starting_gpu', stage='Installing benchmark services on the restored GPU. No model inference is being submitted.')
    target.install(); check()


def allocation_input(remote, candidate, policy, name):
    public = subprocess.run(['ssh-keygen', '-y', '-f', remote.state['keyPath']], capture_output=True, text=True, check=True).stdout.strip()
    values = {'gpuCount': 1, 'gpuTypeId': candidate['gpuTypeId'], 'name': name,
              'imageName': remote.state['image'], 'volumeInGb': 30, 'containerDiskInGb': 30,
              'minVcpuCount': 2, 'minMemoryInGb': 16, 'minCudaVersion': policy.minCudaVersion,
              'supportPublicIp': True, 'startSsh': True, 'ports': '22/tcp', 'volumeMountPath': '/workspace'}
    if policy.templateId:
        values['templateId'] = policy.templateId
    fields = ['cloudType:' + candidate['cloudType']] + [key + ':' + json.dumps(value) for key, value in values.items()]
    fields.append('env:[{key:"PUBLIC_KEY",value:' + json.dumps(public) + '}]')
    return 'mutation { podFindAndDeployOnDemand(input:{' + ','.join(fields) + '}) { id desiredStatus costPerHr } }'


def relocate(remote, *, attempt, check, report):
    policy = load_policy(remote)
    if not policy.enabled or attempt < policy.afterFailures:
        path = remote.deployment / 'gpu-relocation.json'
        if path.exists() and json.loads(path.read_text()).get('status') in {'allocating','allocated','restoring','cleanup_required'}:
            raise DomainError('RUNPOD_RELOCATION_REVIEW_REQUIRED')
        return False
    # A name journal makes an ambiguous allocation recoverable without renting a second Pod.
    with (remote.deployment / 'gpu-relocation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        journal_path = remote.deployment / 'gpu-relocation.json'
        journal = json.loads(journal_path.read_text()) if journal_path.exists() else {}
        if journal.get('status') == 'cleanup_required':
            raise DomainError('RUNPOD_RELOCATION_REVIEW_REQUIRED')
        if journal.get('status') in {'allocated', 'restoring'} and journal.get('targetPodId') == remote.state['podId']:
            journal['status'] = 'promoted'; atomic(journal_path, journal)
            return True
        source = remote.gql('query { pod(input:{podId:' + json.dumps(remote.state['podId']) + '}) { desiredStatus } }')['pod']
        if not source or source['desiredStatus'] != 'EXITED':
            if journal.get('status') in {'allocating','allocated','restoring'}:
                raise DomainError('RUNPOD_RELOCATION_REVIEW_REQUIRED')
            return False
        saved = checkpoint(remote)
        validate_evidence(saved['evidence'])
        budget = policy.budget(remote.state.get('actualGpuHourlyUsd'), attempt - policy.afterFailures)
        pending = None
        if journal.get('status') in {'allocating','allocated','restoring'}:
            budget = min(policy.maxHourlyUsd, max(budget, float(journal.get('hourlyBudgetUsd', budget))))
        if journal.get('status') == 'allocating':
            pods = remote.gql('query { myself { pods { id name desiredStatus costPerHr } } }')['myself']['pods']
            matches = [p for p in pods if p['name'] == journal['name']]
            if len(matches) != 1:
                raise DomainError('RUNPOD_ALLOCATION_OUTCOME_UNKNOWN')
            pending = matches[0]
        elif journal.get('status') in {'allocated', 'restoring'}:
            pending = remote.gql('query { pod(input:{podId:' + json.dumps(journal['targetPodId']) + '}) {id desiredStatus costPerHr} }')['pod']
        if pending and pending['desiredStatus'] != 'RUNNING':
            raise DomainError('RUNPOD_RELOCATION_REVIEW_REQUIRED')
        if not pending:
            available = []
            for cloud, secure in [('COMMUNITY', 'false'), ('SECURE', 'true')]:
                check()
                rows = remote.gql('query { gpuTypes { id memoryInGb lowestPrice(input:{gpuCount:1,secureCloud:' + secure + ',supportPublicIp:true,minVcpuCount:2,minMemoryInGb:16,minCudaVersion:' + json.dumps(policy.minCudaVersion) + '}) { uninterruptablePrice stockStatus } } }')['gpuTypes']
                available.extend(candidates(rows, cloud, budget, policy))
            history_path = remote.deployment / 'gpu-candidate-attempts.json'
            history = json.loads(history_path.read_text()) if history_path.exists() else {}
            available = ranked_candidates(available, history, time.time())
            for candidate in available[:policy.maxCandidatesPerPass]:
                check(); name = identifier('benchmark-capacity')
                query = allocation_input(remote, candidate, policy, name)
                history[candidate['cloudType'] + ':' + candidate['gpuTypeId']] = time.time()
                atomic(history_path, history)
                journal = dict(status='allocating', name=name, sourcePodId=remote.state['podId'],
                               generation=saved['generation'], candidate=candidate, hourlyBudgetUsd=budget, createdAt=utc())
                atomic(journal_path, journal)
                report('waiting_capacity', hourlyCapUsd=budget, stage='Trying an alternative ' + candidate['gpuTypeId'] + ' in ' + candidate['cloudType'] + '; current price cap USD ' + format(budget, '.2f') + '/hour.')
                try:
                    pending = remote.gql(query)['podFindAndDeployOnDemand']
                except DomainError as error:
                    if error.code != 'RUNPOD_API_UNAVAILABLE':
                        journal['status'] = 'rejected'; atomic(journal_path, journal)
                    if error.code == 'RUNPOD_GPU_UNAVAILABLE':
                        continue
                    raise
                journal.update(status='allocated', targetPodId=pending['id']); atomic(journal_path, journal)
                if not isinstance(pending.get('costPerHr'), (int, float)) or not 0 < pending['costPerHr'] <= budget:
                    remote.gql('mutation { podTerminate(input:{podId:' + json.dumps(pending['id']) + '}) }')
                    journal['status'] = 'price_rejected'; atomic(journal_path, journal); pending = None
                    continue
                break
        if not pending:
            return False
        if not isinstance(pending.get('costPerHr'), (int, float)) or not 0 < pending['costPerHr'] <= budget:
            remote.gql('mutation { podTerminate(input:{podId:' + json.dumps(pending['id']) + '}) }')
            journal['status'] = 'price_rejected'; atomic(journal_path, journal)
            return False
        if journal.get('generation') != saved['generation']:
            raise DomainError('RECOVERY_CHECKPOINT_CHANGED')
        original_state = dict(remote.state)
        promoted = False
        target = copy.copy(remote); target.children = []
        target.state = {**remote.state, 'podId': pending['id'], 'gpu': journal['candidate']['gpuTypeId'],
                        'actualGpuHourlyUsd': pending['costPerHr'], 'quotedGpuHourlyUsd': journal['candidate']['quotedHourlyUsd']}
        target.ssh = lambda command, data=None, check=True: cancellable_ssh(target, command, data=data, check_result=check, check=check_cancelled)
        check_cancelled = check
        try:
            check(); wait_ssh(target, check, report)
            journal['status'] = 'restoring'; atomic(journal_path, journal)
            restore_target(remote, target, saved, check, report)
            source = remote.gql('query { pod(input:{podId:' + json.dumps(original_state['podId']) + '}) { desiredStatus } }')['pod']
            if not source or source['desiredStatus'] != 'EXITED':
                raise DomainError('SAVED_GPU_RESTARTED_DURING_RELOCATION')
            atomic(remote.deployment / 'retired-capacity-pod.json', original_state)
            with checkpoint_lock(remote) as directory:
                saved['sourcePodId'] = target.state['podId']; atomic(directory / 'manifest.json', saved)
            atomic(remote.deployment / 'remote.json', target.state)
            remote.state = target.state
            promoted = True
            journal['status'] = 'promoted'; atomic(journal_path, journal)
            return True
        except BaseException:
            # Original storage and the checkpoint remain available on every failure path.
            if promoted:
                remote.gql('mutation { podStop(input:{podId:' + json.dumps(pending['id']) + '}) {id} }')
                journal['status'] = 'promoted'; atomic(journal_path, journal)
                raise
            with checkpoint_lock(remote) as directory:
                saved['sourcePodId'] = original_state['podId']; atomic(directory / 'manifest.json', saved)
            try:
                remote.gql('mutation { podTerminate(input:{podId:' + json.dumps(pending['id']) + '}) }')
                journal['status'] = 'aborted'; atomic(journal_path, journal)
            except Exception:
                journal['status'] = 'cleanup_required'; atomic(journal_path, journal)
            raise
