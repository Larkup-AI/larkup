from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


DEFAULT_LOCAL_ENTITLEMENT = {
    "sourceMinutesPerMonth": None,
    "maxConcurrentJobs": 4,
    "plan": "local",
}


class StoreError(RuntimeError):
    pass


class AuthenticationError(StoreError):
    pass


class QuotaExceededError(StoreError):
    pass


@dataclass(frozen=True)
class Principal:
    id: str
    entitlement: dict[str, Any]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _period() -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start.isoformat(), end.isoformat()


class Store:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS principals (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    entitlement_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS api_keys (
                    key_hash TEXT PRIMARY KEY,
                    principal_id TEXT NOT NULL REFERENCES principals(id),
                    created_at TEXT NOT NULL,
                    revoked_at TEXT
                );
                CREATE TABLE IF NOT EXISTS access_codes (
                    code_hash TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    entitlement_json TEXT NOT NULL,
                    max_uses INTEGER NOT NULL,
                    uses INTEGER NOT NULL DEFAULT 0,
                    expires_at TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS uploads (
                    id TEXT PRIMARY KEY,
                    principal_id TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    path TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    principal_id TEXT NOT NULL,
                    upload_id TEXT NOT NULL REFERENCES uploads(id),
                    request_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress_json TEXT NOT NULL,
                    estimated_minutes REAL NOT NULL,
                    result_json TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS jobs_principal_status
                    ON jobs(principal_id, status);
                CREATE TABLE IF NOT EXISTS usage_events (
                    id TEXT PRIMARY KEY,
                    principal_id TEXT NOT NULL,
                    job_id TEXT NOT NULL UNIQUE,
                    metric TEXT NOT NULL,
                    amount REAL NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )

    def resolve_principal(
        self, api_key: str | None, require_auth: bool, shared_api_key: str | None = None
    ) -> Principal:
        if shared_api_key and api_key and secrets.compare_digest(api_key, shared_api_key):
            return Principal("local", DEFAULT_LOCAL_ENTITLEMENT.copy())
        if not require_auth and not shared_api_key:
            return Principal("local", DEFAULT_LOCAL_ENTITLEMENT.copy())
        if not api_key:
            raise AuthenticationError("missing API key")
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT p.id, p.entitlement_json
                FROM api_keys k JOIN principals p ON p.id = k.principal_id
                WHERE k.key_hash = ? AND k.revoked_at IS NULL
                """,
                (_digest(api_key),),
            ).fetchone()
        if row is None:
            raise AuthenticationError("invalid API key")
        return Principal(row["id"], json.loads(row["entitlement_json"]))

    def create_access_code(
        self,
        *,
        label: str,
        entitlement: dict[str, Any],
        max_uses: int,
        expires_at: str | None,
    ) -> str:
        code = "lvi_code_" + secrets.token_urlsafe(18)
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO access_codes
                    (code_hash, label, entitlement_json, max_uses, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (_digest(code), label, json.dumps(entitlement), max_uses, expires_at, utc_now()),
            )
        return code

    def redeem_access_code(self, code: str, label: str | None) -> tuple[str, dict[str, Any]]:
        now = utc_now()
        api_key = "lvi_" + secrets.token_urlsafe(30)
        principal_id = "usr_" + secrets.token_hex(12)
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM access_codes WHERE code_hash = ?", (_digest(code),)
            ).fetchone()
            if row is None or row["uses"] >= row["max_uses"]:
                raise AuthenticationError("invalid or exhausted access code")
            if row["expires_at"] and row["expires_at"] <= now:
                raise AuthenticationError("expired access code")
            entitlement = json.loads(row["entitlement_json"])
            connection.execute(
                "UPDATE access_codes SET uses = uses + 1 WHERE code_hash = ?",
                (_digest(code),),
            )
            connection.execute(
                "INSERT INTO principals VALUES (?, ?, ?, ?)",
                (principal_id, label or row["label"], json.dumps(entitlement), now),
            )
            connection.execute(
                "INSERT INTO api_keys VALUES (?, ?, ?, NULL)",
                (_digest(api_key), principal_id, now),
            )
        return api_key, entitlement

    def create_upload(
        self, principal_id: str, upload_id: str, file_name: str, path: Path, size_bytes: int
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO uploads VALUES (?, ?, ?, ?, ?, ?)",
                (upload_id, principal_id, file_name, str(path), size_bytes, utc_now()),
            )

    def get_upload(self, principal_id: str, upload_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM uploads WHERE id = ? AND principal_id = ?",
                (upload_id, principal_id),
            ).fetchone()
        if row is None:
            raise StoreError("upload not found")
        return dict(row)

    def create_job(
        self,
        principal: Principal,
        job_id: str,
        upload_id: str,
        request: dict[str, Any],
        estimated_minutes: float,
    ) -> None:
        entitlement = principal.entitlement
        period_start, period_end = _period()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            upload = connection.execute(
                "SELECT 1 FROM uploads WHERE id = ? AND principal_id = ?",
                (upload_id, principal.id),
            ).fetchone()
            if upload is None:
                raise StoreError("upload not found")
            active = connection.execute(
                "SELECT COUNT(*) FROM jobs WHERE principal_id = ? AND status IN ('queued', 'running')",
                (principal.id,),
            ).fetchone()[0]
            if active >= int(entitlement.get("maxConcurrentJobs", 1)):
                raise QuotaExceededError("concurrent job limit reached")
            used = connection.execute(
                """
                SELECT COALESCE(SUM(amount), 0) FROM usage_events
                WHERE principal_id = ? AND metric = 'source-minute'
                    AND created_at >= ? AND created_at < ?
                """,
                (principal.id, period_start, period_end),
            ).fetchone()[0]
            reserved = connection.execute(
                """
                SELECT COALESCE(SUM(estimated_minutes), 0) FROM jobs
                WHERE principal_id = ? AND status IN ('queued', 'running')
                """,
                (principal.id,),
            ).fetchone()[0]
            limit = entitlement.get("sourceMinutesPerMonth")
            if limit is not None and used + reserved + estimated_minutes > float(limit):
                raise QuotaExceededError("monthly source-minute limit reached")
            now = utc_now()
            progress = {"stage": "queued", "percent": 0, "message": "Waiting for a worker"}
            connection.execute(
                """
                INSERT INTO jobs
                    (id, principal_id, upload_id, request_json, status, progress_json,
                     estimated_minutes, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)
                """,
                (
                    job_id,
                    principal.id,
                    upload_id,
                    json.dumps(request),
                    json.dumps(progress),
                    estimated_minutes,
                    now,
                    now,
                ),
            )

    def get_job(self, principal_id: str, job_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM jobs WHERE id = ? AND principal_id = ?", (job_id, principal_id)
            ).fetchone()
        if row is None:
            raise StoreError("job not found")
        return self._job_dict(row)

    def get_job_for_worker(self, job_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise StoreError("job not found")
        result = self._job_dict(row)
        result["request"] = json.loads(row["request_json"])
        result["principal_id"] = row["principal_id"]
        result["upload_id"] = row["upload_id"]
        return result

    @staticmethod
    def _job_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "progress": json.loads(row["progress_json"]),
            "estimatedSourceMinutes": row["estimated_minutes"],
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "error": row["error"],
        }

    def update_job(
        self,
        job_id: str,
        stage: str,
        percent: int,
        message: str,
        stage_percent: int | None = None,
        details: dict[str, int | float | str] | None = None,
    ) -> None:
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT progress_json FROM jobs WHERE id = ? AND status IN ('queued', 'running')",
                (job_id,),
            ).fetchone()
            if row is None:
                return
            try:
                previous_percent = int(json.loads(row["progress_json"]).get("percent", 0))
            except (TypeError, ValueError, json.JSONDecodeError):
                previous_percent = 0
            # Decode and transcription can overlap. Their independently
            # measured callbacks are valid, but a poller has only one overall
            # progress value; never make that value move backwards when the
            # later callback belongs to work already running in parallel.
            percent = max(previous_percent, min(99, max(0, int(percent))))
            connection.execute(
                """
                UPDATE jobs SET status = 'running', progress_json = ?, updated_at = ?
                WHERE id = ? AND status IN ('queued', 'running')
                """,
                (
                    json.dumps(
                        {
                            "stage": stage,
                            "percent": percent,
                            "message": message,
                            # A host drawing one bar per step reads this
                            # instead of re-deriving the stage's band.
                            **({"stagePercent": stage_percent} if stage_percent is not None else {}),
                            **(details or {}),
                        }
                    ),
                    utc_now(),
                    job_id,
                ),
            )

    def finish_job(self, job_id: str, result: dict[str, Any], actual_minutes: float) -> None:
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT principal_id, status FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if row is None or row["status"] == "cancelled":
                return
            now = utc_now()
            connection.execute(
                """
                UPDATE jobs SET status = 'completed', progress_json = ?, result_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    json.dumps({"stage": "complete", "percent": 100, "message": "Index ready"}),
                    json.dumps(result),
                    now,
                    job_id,
                ),
            )
            connection.execute(
                "INSERT OR IGNORE INTO usage_events VALUES (?, ?, ?, 'source-minute', ?, ?)",
                ("evt_" + secrets.token_hex(12), row["principal_id"], job_id, actual_minutes, now),
            )

    def fail_job(self, job_id: str, error: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE jobs SET status = 'failed', error = ?, updated_at = ?
                WHERE id = ? AND status != 'cancelled'
                """,
                (error[:2_000], utc_now(), job_id),
            )

    def cancel_job(self, principal_id: str, job_id: str) -> None:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs SET status = 'cancelled', updated_at = ?
                WHERE id = ? AND principal_id = ? AND status IN ('queued', 'running')
                """,
                (utc_now(), job_id, principal_id),
            )
        if cursor.rowcount == 0:
            raise StoreError("job cannot be cancelled")

    def purge_job_data(self, principal_id: str, job_id: str) -> None:
        """Irreversibly remove one local job's result and uploaded source.

        This is intentionally separate from cancellation: a running worker is
        first cancelled by the caller, then this method removes the durable
        cache only once the job is terminal.  A deleted Larkup media asset
        must not remain readable through an old local-runtime job id.
        """
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT j.status, j.upload_id, u.path
                FROM jobs j JOIN uploads u ON u.id = j.upload_id
                WHERE j.id = ? AND j.principal_id = ?
                """,
                (job_id, principal_id),
            ).fetchone()
            if row is None:
                raise StoreError("job not found")
            if row["status"] in {"queued", "running"}:
                raise StoreError("job must be cancelled before its data can be removed")
            connection.execute("DELETE FROM jobs WHERE id = ? AND principal_id = ?", (job_id, principal_id))
            connection.execute("DELETE FROM uploads WHERE id = ? AND principal_id = ?", (row["upload_id"], principal_id))
        Path(row["path"]).unlink(missing_ok=True)

    def usage(self, principal: Principal) -> dict[str, Any]:
        period_start, period_end = _period()
        with self.connect() as connection:
            used = connection.execute(
                """
                SELECT COALESCE(SUM(amount), 0) FROM usage_events
                WHERE principal_id = ? AND metric = 'source-minute'
                    AND created_at >= ? AND created_at < ?
                """,
                (principal.id, period_start, period_end),
            ).fetchone()[0]
            active = connection.execute(
                "SELECT COUNT(*) FROM jobs WHERE principal_id = ? AND status IN ('queued', 'running')",
                (principal.id,),
            ).fetchone()[0]
        entitlement = principal.entitlement
        return {
            "periodStart": period_start,
            "periodEnd": period_end,
            "sourceMinutesUsed": round(float(used), 3),
            "sourceMinutesLimit": entitlement.get("sourceMinutesPerMonth"),
            "activeJobs": active,
            "concurrentJobsLimit": entitlement.get("maxConcurrentJobs", 1),
        }
