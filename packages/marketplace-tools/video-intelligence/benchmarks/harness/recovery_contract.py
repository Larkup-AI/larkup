"""Offline checks for benchmark recovery; never submit or replay paid work."""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path
from .common import DomainError


def completed_evidence(job):
    result = job.get('result') or {}
    # Canonical completion already enforces semantic coverage. Keep its nonfatal
    # diagnostics rather than converting an accepted index into a paid retry.
    if job.get('status') != 'completed' or not result.get('semanticObservations'):
        raise DomainError('CANONICAL_VISION_INCOMPLETE')
    return result


def runtime_command(executable, env):
    try:
        base = int(env.get('BENCHMARK_VISION_TIMEOUT_BASE', '240'))
        ceiling = int(env.get('BENCHMARK_VISION_TIMEOUT_CEILING', '540'))
        if not 60 <= base <= ceiling <= 600:
            raise ValueError('invalid deadline')
    except (TypeError, ValueError):
        raise DomainError('BENCHMARK_VISION_TIMEOUT_INVALID')
    # The override is confined to this benchmark child process, not production.
    code = ("import runpy; from app.services import vision; "
            f"vision.REQUEST_TIMEOUT_BASE_SECS={base}; "
            f"vision.REQUEST_TIMEOUT_CEILING_SECS={ceiling}; "
            "runpy.run_module('app',run_name='__main__')")
    return [executable, '-c', code]


def evidence_closure(database, root):
    root = Path(root).resolve()
    missing, checked = [], 0
    with sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro&immutable=1', uri=True) as cx:
        rows = cx.execute("SELECT id, output FROM tasks WHERE kind='prepare' AND state='completed' ORDER BY id")
        for task_id, output in rows:
            path = json.loads(output or '{}').get('evidencePath')
            if not path:
                continue  # Native providers may retain remote handles instead.
            checked += 1
            target = (root / path).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                missing.append(task_id)
    return {'checked': checked, 'missingTaskIds': missing,
            'status': 'partial' if missing else 'verified'}


async def settle_inspections(checkpoint, get_job, *, timeout=600, interval=2):
    """Drain saved paid jobs before a serial worker changes relay role ownership."""
    import asyncio
    import time
    checkpoint = Path(checkpoint)
    if not checkpoint.exists():
        return
    try:
        saved = json.loads(checkpoint.read_text())
        if not isinstance(saved, dict) or any(not isinstance(x, dict) for x in saved.values()):
            raise ValueError('invalid checkpoint')
    except (ValueError, OSError):
        raise DomainError('REMOTE_OUTCOME_UNKNOWN', unknown=True) from None
    jobs = set()
    for handle in saved.values():
        if handle.get('submitted') and not handle.get('jobId'):
            raise DomainError('REMOTE_OUTCOME_UNKNOWN', unknown=True)
        if handle.get('jobId'):
            jobs.add(handle['jobId'])
    deadline = time.monotonic() + timeout
    while jobs:
        for job_id in list(jobs):
            job = (await get_job(job_id)).json()
            if job.get('status') == 'completed':
                jobs.remove(job_id)
            elif job.get('status') in {'failed', 'cancelled'}:
                raise DomainError('CANONICAL_INDEX_FAILED')
        if not jobs:
            return
        if time.monotonic() >= deadline:
            raise DomainError('REMOTE_OUTCOME_UNKNOWN', unknown=True)
        await asyncio.sleep(interval)
