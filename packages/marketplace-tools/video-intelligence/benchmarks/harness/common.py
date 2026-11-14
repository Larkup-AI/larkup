from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shlex
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def identifier(prefix: str) -> str:
    return prefix + '-' + secrets.token_hex(10)


def atomic(path: Path, value: Any, *, raw: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(str(value) if raw else canonical(value))
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class DomainError(Exception):
    def __init__(self, code: str, *, retryable: bool = False, wait: float | None = None,
                 status: int = 422, unknown: bool = False):
        super().__init__(code)
        self.code, self.retryable, self.wait = code, retryable, wait
        self.status, self.unknown = status, unknown

    def issue(self, scope: str | None = None) -> dict:
        reset = None
        if self.wait is not None:
            import time
            reset = datetime.fromtimestamp(time.time() + self.wait, timezone.utc).isoformat()
        return dict(code=self.code, scopeId=scope, message=self.code.replace('_', ' ').capitalize(),
                    retryable=self.retryable, nextEligibleAt=reset)


class Secrets:
    """Dotenv is data. No expansion, shell execution, or exported process environment."""
    def __init__(self, path: Path):
        self.path = path
        self.values = self.parse(path)
        tokens = path.parent / 'data' / 'deployment' / 'tokens.env'
        if tokens.exists():
            self.values.update(self.parse(tokens))

    @staticmethod
    def parse(path: Path) -> dict[str, str]:
        if path.stat().st_mode & 0o077:
            raise DomainError('SECRET_FILE_PERMISSIONS')
        values = {}
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            match = re.fullmatch(r'(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)', line)
            if not match:
                raise DomainError('SECRET_FILE_INVALID')
            try:
                parts = shlex.split(match[2], comments=True, posix=True)
            except ValueError:
                raise DomainError('SECRET_FILE_INVALID') from None
            if len(parts) > 1:
                raise DomainError('SECRET_FILE_INVALID')
            values[match[1]] = parts[0] if parts else ''
        return values

    def get(self, alias: str) -> str:
        value = self.values.get(alias)
        if not value:
            raise DomainError('AUTH_INVALID')
        return value

    def clean(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {k: self.clean(v) for k, v in value.items()
                    if k.lower() not in {'apikey', 'api_key', 'authorization', 'token', 'secret', 'headers'}}
        if isinstance(value, list):
            return [self.clean(v) for v in value]
        if isinstance(value, str):
            for secret in sorted(self.values.values(), key=len, reverse=True):
                if secret:
                    value = value.replace(secret, '[redacted]')
            value = re.sub(r'https?://[^\s"<>]+[?][^\s"<>]+', '[private URL]', value)
        return value
