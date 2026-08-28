"""FastAPI app entry point: creates the app, wires CORS and exception
handlers, and mounts the v1 API. Run with `uv run larkup-video-runtime`.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import settings
from app.api.v1 import register_exception_handlers, router

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
register_exception_handlers(app)
app.include_router(router)
