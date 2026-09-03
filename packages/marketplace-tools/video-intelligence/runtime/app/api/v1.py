"""Every /v1 route: health, uploads, jobs, usage, and access codes.

The local-Docker runtime's whole HTTP surface is small enough (eight
endpoints) that splitting it across more files would cost more to navigate
than it would save -- see api/deps.py for the auth/rate-limit dependencies
these handlers use.
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response

from app.db.schemas import (
    CreateAccessCodeRequest,
    CreateAccessCodeResponse,
    CreateJobRequest,
    JobResponse,
    RedeemAccessCodeRequest,
    RedeemAccessCodeResponse,
    UsageSummary,
)
from app.db.store import AuthenticationError, Principal, QuotaExceededError, StoreError
from app.services.pipeline import probe_video
from app.api.deps import jobs, limiter, principal, require_admin, settings, store

router = APIRouter()


@router.get("/v1/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "version": "0.1.0",
        "runtime": os.getenv("LARKUP_VIDEO_RUNTIME_KIND", "local-docker"),
        "authRequired": settings.require_auth,
        "device": settings.device,
        "operators": {
            "transcription": os.getenv("LARKUP_VIDEO_TRANSCRIPTION_PROVIDER", "whisper"),
            "ocr": os.getenv("LARKUP_VIDEO_OCR_ENGINE", "PaddleOCR"),
            "detection": "YOLOX",
            "tracking": "anonymous-iou",
            "semanticVision": settings.semantic_vision_model if settings.semantic_vision_enabled else None,
            "agentBrain": settings.agent_model if settings.agent_enabled else None,
            "agentProvider": settings.agent_provider if settings.agent_enabled else None,
        },
        "capabilities": ["agent-planning", "transcription", "ocr", "object-detection", "semantic-vision"],
    }


@router.post("/v1/uploads", status_code=201)
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


@router.post("/v1/jobs", response_model=JobResponse, status_code=202)
def create_job(
    request: CreateJobRequest,
    user: Annotated[Principal, Depends(principal)],
    background_tasks: BackgroundTasks,
) -> dict[str, object]:
    upload = store.get_upload(user.id, request.source.upload_id)
    probe = probe_video(Path(upload["path"]))
    job_id = "job_" + secrets.token_hex(12)
    payload = request.model_dump(by_alias=True)
    model_configuration = payload.pop("modelConfiguration", None)
    store.create_job(user, job_id, request.source.upload_id, payload, probe.duration_seconds / 60)
    # Dispatch after the response commits. This avoids losing a local job
    # during a container restart before the thread-pool worker starts.
    background_tasks.add_task(jobs.run, job_id, model_configuration)
    return store.get_job(user.id, job_id)


@router.get("/v1/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str, user: Annotated[Principal, Depends(principal)]) -> dict[str, object]:
    return store.get_job(user.id, job_id)


@router.delete("/v1/jobs/{job_id}", response_model=JobResponse)
def cancel_job(job_id: str, user: Annotated[Principal, Depends(principal)]) -> dict[str, object]:
    store.cancel_job(user.id, job_id)
    return store.get_job(user.id, job_id)


@router.delete("/v1/jobs/{job_id}/data", response_class=Response)
def purge_job_data(job_id: str, user: Annotated[Principal, Depends(principal)]) -> Response:
    """Delete the local source/result cache after the host removes its media asset."""
    store.purge_job_data(user.id, job_id)
    return Response(status_code=204)


@router.get("/v1/usage", response_model=UsageSummary)
def usage(user: Annotated[Principal, Depends(principal)]) -> dict[str, object]:
    return store.usage(user)


@router.post("/v1/access-codes/redeem", response_model=RedeemAccessCodeResponse)
def redeem_access_code(request: RedeemAccessCodeRequest) -> dict[str, object]:
    limiter.check("redeem")
    try:
        api_key, entitlement = store.redeem_access_code(request.code, request.label)
    except AuthenticationError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    return {"apiKey": api_key, "entitlement": entitlement}


@router.post("/v1/admin/access-codes", response_model=CreateAccessCodeResponse)
def create_access_code(
    request: CreateAccessCodeRequest,
    admin_token: Annotated[str | None, Header(alias="X-Larkup-Admin-Token")] = None,
) -> dict[str, object]:
    require_admin(admin_token)
    entitlement = {
        "sourceMinutesPerMonth": request.source_minutes_per_month,
        "maxConcurrentJobs": request.max_concurrent_jobs,
        "plan": "access-code",
    }
    code = store.create_access_code(
        label=request.label,
        entitlement=entitlement,
        max_uses=request.max_uses,
        expires_at=request.expires_at,
    )
    return {"code": code, "label": request.label, "maxUses": request.max_uses, "expiresAt": request.expires_at}


def register_exception_handlers(app) -> None:
    @app.exception_handler(QuotaExceededError)
    async def _quota_error(_: object, error: QuotaExceededError) -> JSONResponse:
        return JSONResponse(status_code=429, content={"detail": str(error)}, headers={"Retry-After": "60"})

    @app.exception_handler(StoreError)
    async def _store_error(_: object, error: StoreError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(error)})
