from __future__ import annotations

import hmac
import os
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings
from .pipeline import probe_video
from .schemas import (
    CreateAccessCodeRequest,
    CreateAccessCodeResponse,
    CreateJobRequest,
    JobResponse,
    RedeemAccessCodeRequest,
    RedeemAccessCodeResponse,
    UsageSummary,
)
from .service import JobService
from .store import (
    AuthenticationError,
    Principal,
    QuotaExceededError,
    Store,
    StoreError,
)


settings = Settings.from_env()
store = Store(settings.data_dir / "video-intelligence.sqlite3")
jobs = JobService(settings, store)
app = FastAPI(
    title="Larkup Video Intelligence Runtime",
    version="0.1.0",
    docs_url="/docs" if not settings.require_auth else None,
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Larkup-Admin-Token"],
)


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


limiter = SlidingWindowLimiter(
    max(1, int(os.getenv("LARKUP_VIDEO_REQUESTS_PER_MINUTE", "120")))
)


def _bearer(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def principal(request: Request) -> Principal:
    token = _bearer(request)
    forwarded = request.headers.get("x-forwarded-for", "").partition(",")[0].strip()
    limiter.check(token or forwarded or request.client.host if request.client else "local")
    try:
        return store.resolve_principal(token, settings.require_auth)
    except AuthenticationError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error)) from error


def _require_admin(token: str | None) -> None:
    if not settings.admin_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="admin access-code management is not configured",
        )
    if not token or not hmac.compare_digest(token, settings.admin_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid admin token")


@app.exception_handler(QuotaExceededError)
async def quota_error(_: Request, error: QuotaExceededError) -> JSONResponse:
    return JSONResponse(status_code=429, content={"detail": str(error)}, headers={"Retry-After": "60"})


@app.exception_handler(StoreError)
async def store_error(_: Request, error: StoreError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(error)})


@app.get("/v1/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "version": "0.1.0",
        "runtime": "local-docker",
        "authRequired": settings.require_auth,
        "device": settings.device,
        "operators": {
            "transcription": "faster-whisper",
            "ocr": os.getenv("LARKUP_VIDEO_OCR_ENGINE", "PaddleOCR"),
            "detection": "YOLOX",
            "tracking": "anonymous-iou",
        },
        "capabilities": ["transcription", "ocr", "object-detection", "full-frame"],
    }


@app.post("/v1/uploads", status_code=201)
def upload_video(
    user: Annotated[Principal, Depends(principal)],
    file: Annotated[UploadFile, File()],
) -> dict[str, object]:
    upload_id = "upl_" + secrets.token_hex(12)
    original_name = Path(file.filename or "video.bin").name
    destination = settings.data_dir / "uploads" / user.id / f"{upload_id}{Path(original_name).suffix}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with destination.open("wb") as output:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(status_code=413, detail="video exceeds the configured upload limit")
                output.write(chunk)
        probe = probe_video(destination)
        store.create_upload(user.id, upload_id, original_name, destination, size)
        return {
            "uploadId": upload_id,
            "fileName": original_name,
            "sizeBytes": size,
            "durationMs": round(probe.duration_seconds * 1_000),
        }
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        file.file.close()


@app.post("/v1/jobs", response_model=JobResponse, status_code=202)
def create_job(
    request: CreateJobRequest,
    user: Annotated[Principal, Depends(principal)],
) -> dict[str, object]:
    upload = store.get_upload(user.id, request.source.upload_id)
    probe = probe_video(Path(upload["path"]))
    job_id = "job_" + secrets.token_hex(12)
    payload = request.model_dump(by_alias=True)
    store.create_job(user, job_id, request.source.upload_id, payload, probe.duration_seconds / 60)
    jobs.submit(job_id)
    return store.get_job(user.id, job_id)


@app.get("/v1/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str, user: Annotated[Principal, Depends(principal)]) -> dict[str, object]:
    return store.get_job(user.id, job_id)


@app.delete("/v1/jobs/{job_id}", response_model=JobResponse)
def cancel_job(
    job_id: str, user: Annotated[Principal, Depends(principal)]
) -> dict[str, object]:
    store.cancel_job(user.id, job_id)
    return store.get_job(user.id, job_id)


@app.get("/v1/usage", response_model=UsageSummary)
def usage(user: Annotated[Principal, Depends(principal)]) -> dict[str, object]:
    return store.usage(user)


@app.post("/v1/access-codes/redeem", response_model=RedeemAccessCodeResponse)
def redeem_access_code(request: RedeemAccessCodeRequest) -> dict[str, object]:
    limiter.check("redeem")
    try:
        api_key, entitlement = store.redeem_access_code(request.code, request.label)
    except AuthenticationError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    return {"apiKey": api_key, "entitlement": entitlement}


@app.post("/v1/admin/access-codes", response_model=CreateAccessCodeResponse)
def create_access_code(
    request: CreateAccessCodeRequest,
    admin_token: Annotated[str | None, Header(alias="X-Larkup-Admin-Token")] = None,
) -> dict[str, object]:
    _require_admin(admin_token)
    entitlement = {
        "sourceMinutesPerMonth": request.source_minutes_per_month,
        "maxConcurrentJobs": request.max_concurrent_jobs,
        "allowFullCoverage": request.allow_full_coverage,
        "plan": "access-code",
    }
    code = store.create_access_code(
        label=request.label,
        entitlement=entitlement,
        max_uses=request.max_uses,
        expires_at=request.expires_at,
    )
    return {
        "code": code,
        "label": request.label,
        "maxUses": request.max_uses,
        "expiresAt": request.expires_at,
    }
