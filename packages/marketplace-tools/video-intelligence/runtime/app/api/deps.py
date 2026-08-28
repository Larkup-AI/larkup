"""Shared app state and FastAPI dependencies: settings, the store, the job
runner, request-rate limiting, and principal/admin authentication. Built
once here so main.py and v1.py both import the same instances.
"""

from __future__ import annotations

import hmac
import os
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.config import Settings
from app.db.store import AuthenticationError, Principal, Store
from app.services.jobs import JobService

settings = Settings.from_env()
store = Store(settings.data_dir / "video-intelligence.sqlite3")
jobs = JobService(settings, store)


class SlidingWindowLimiter:
    def __init__(self, requests_per_minute: int):
        self.limit = requests_per_minute
        self.windows: defaultdict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        window = self.windows[key]
        while window and window[0] <= now - 60:
            window.popleft()
        if len(window) >= self.limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="request rate limit reached; retry in one minute",
                headers={"Retry-After": "60"},
            )
        window.append(now)


limiter = SlidingWindowLimiter(max(1, int(os.getenv("LARKUP_VIDEO_REQUESTS_PER_MINUTE", "120"))))


def _bearer(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def principal(request: Request) -> Principal:
    token = _bearer(request)
    forwarded = request.headers.get("x-forwarded-for", "").partition(",")[0].strip()
    limiter.check(token or forwarded or request.client.host if request.client else "local")
    try:
        return store.resolve_principal(token, settings.require_auth, settings.shared_api_key)
    except AuthenticationError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error)) from error


def require_admin(token: str | None) -> None:
    if not settings.admin_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="admin access-code management is not configured",
        )
    if not token or not hmac.compare_digest(token, settings.admin_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid admin token")
