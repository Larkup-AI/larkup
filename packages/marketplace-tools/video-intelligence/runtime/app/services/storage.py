"""Uploads a frame so a remote model (the AI Gateway) can fetch it by URL.

Needed because the gateway calls out over HTTP and cannot reach a local
file -- when a bucket is configured it needs a real URL, not a path. This
stays pluggable by provider name (only `s3` today) so a future non-AWS
deploy target can add its own without the vision service that calls it
knowing or caring which one is active.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import Any


class FrameUploader(ABC):
    @abstractmethod
    def upload(self, payload: bytes, key: str, content_type: str) -> str:
        """Stores `payload` at `key` and returns a URL a remote HTTP caller can fetch it from."""


class S3FrameUploader(FrameUploader):
    def __init__(self, bucket: str, region: str) -> None:
        import boto3

        self.bucket = bucket
        self._client: Any = boto3.client("s3", region_name=region)

    def upload(self, payload: bytes, key: str, content_type: str) -> str:
        self._client.put_object(Bucket=self.bucket, Key=key, Body=payload, ContentType=content_type)
        return self._client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=900
        )


def get_frame_uploader(bucket: str | None) -> FrameUploader | None:
    """None when no bucket is configured (local Docker: frames go inline as base64 instead)."""
    if not bucket:
        return None
    provider = os.getenv("LARKUP_VIDEO_FRAME_STORAGE", "s3")
    if provider == "s3":
        return S3FrameUploader(bucket, os.getenv("AWS_REGION", "eu-central-1"))
    raise ValueError(f"unknown frame storage provider: {provider!r}")
