"""Portable command-line entry point for the Video Intelligence API."""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    uvicorn.run(
        "app.main:app",
        host=os.getenv("LARKUP_VIDEO_HOST", "0.0.0.0"),
        port=int(os.getenv("LARKUP_VIDEO_PORT", "8787")),
    )


if __name__ == "__main__":
    main()
