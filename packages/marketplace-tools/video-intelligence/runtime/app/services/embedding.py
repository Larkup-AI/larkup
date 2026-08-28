"""Video-clip embeddings for cross-modal search -- "find the clip where this
happens" from a free-text query. Distinct from vision.py's captions: a
caption describes a clip in words, which can miss an action a viewer would
recognize but a VLM never put into text. An embedding catches that by
comparing meaning directly, not words.

Qwen3-VL-Embedding can use DashScope's multimodal API or dedicated RunPod
and Hugging Face Inference Endpoint deployments.
`disabled` (the default) turns this off with zero cost;
`get_video_embedding_provider()` swaps providers by env var alone.
"""

from __future__ import annotations

import base64
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import ClassVar

import cv2
import numpy as np
import requests


@dataclass(frozen=True)
class VideoClipInput:
    clip_id: str
    start_ms: int
    end_ms: int
    frames: list[tuple[int, np.ndarray]]


@dataclass(frozen=True)
class VideoClipEmbedding:
    clip_id: str
    start_ms: int
    end_ms: int
    vector: list[float]


class VideoEmbeddingProviderError(RuntimeError):
    pass


class VideoEmbeddingProvider(ABC):
    name: ClassVar[str]
    dimensions: ClassVar[int]

    @abstractmethod
    def embed_clips(self, clips: list[VideoClipInput]) -> list[VideoClipEmbedding]:
        """One embedding per clip that had at least one frame."""

    @abstractmethod
    def embed_query(self, text: str) -> list[float]:
        """Embeds free text into the same vector space as embed_clips, for cross-modal search."""


class DisabledVideoEmbeddingProvider(VideoEmbeddingProvider):
    name = "disabled"
    dimensions = 0

    def embed_clips(self, clips: list[VideoClipInput]) -> list[VideoClipEmbedding]:
        return []

    def embed_query(self, text: str) -> list[float]:
        raise VideoEmbeddingProviderError(
            "Video embedding is disabled (set LARKUP_VIDEO_EMBEDDING_PROVIDER=qwen3-vl-embedding to enable it)."
        )


class QwenVLEmbeddingProvider(VideoEmbeddingProvider):
    """DashScope's multimodal-embedding API.

    qwen3-vl-embedding is not served on DashScope's shared endpoint
    (dashscope[-intl].aliyuncs.com) -- it only responds on a workspace-
    dedicated domain, `https://{workspace_id}.{region}.maas.aliyuncs.com`,
    with the workspace ID and region both taken from the Model Studio
    console (Workspace Details page). `LARKUP_VIDEO_DASHSCOPE_BASE_URL` can
    override the computed URL entirely, e.g. to point at a different API
    path or a non-production workspace.
    """

    name = "qwen3-vl-embedding"
    dimensions = 1024

    API_PATH = "/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding"
    DEFAULT_MODEL = "qwen3-vl-embedding"

    def __init__(self) -> None:
        self.api_key = os.getenv("DASHSCOPE_API_KEY", "")
        self.workspace_id = os.getenv("DASHSCOPE_WORKSPACE_ID", "")
        self.region = os.getenv("DASHSCOPE_REGION", "")
        override_url = os.getenv("LARKUP_VIDEO_DASHSCOPE_BASE_URL", "")
        if override_url:
            self.base_url = override_url
        elif self.workspace_id and self.region:
            self.base_url = f"https://{self.workspace_id}.{self.region}.maas.aliyuncs.com{self.API_PATH}"
        else:
            self.base_url = ""
        self.model = os.getenv("LARKUP_VIDEO_EMBEDDING_MODEL", self.DEFAULT_MODEL)
        self.dimensions = int(os.getenv("LARKUP_VIDEO_EMBEDDING_DIMENSION", str(self.dimensions)))
        self.frames_per_clip = int(os.getenv("LARKUP_VIDEO_EMBEDDING_FRAMES_PER_CLIP", "4"))
        self._session = requests.Session()

    def _frame_content(self, frame: np.ndarray) -> dict:
        ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            raise ValueError("could not encode frame as JPEG")
        return {"image": "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")}

    def _embed(self, contents: list[dict]) -> list[float]:
        if not self.api_key:
            raise VideoEmbeddingProviderError("DASHSCOPE_API_KEY is not configured")
        if not self.base_url:
            raise VideoEmbeddingProviderError(
                "DASHSCOPE_WORKSPACE_ID and DASHSCOPE_REGION are not configured "
                "(or set LARKUP_VIDEO_DASHSCOPE_BASE_URL directly)"
            )
        payload = {
            "model": self.model,
            "input": {"contents": contents},
            "parameters": {"enable_fusion": len(contents) > 1, "dimension": self.dimensions},
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        response = self._session.post(self.base_url, json=payload, headers=headers, timeout=60)
        if not response.ok:
            raise VideoEmbeddingProviderError(
                f"DashScope embedding request failed {response.status_code}: {response.text[:300]}"
            )
        body = response.json()
        try:
            return list(body["output"]["embeddings"][0]["embedding"])
        except (KeyError, IndexError, TypeError) as error:
            raise VideoEmbeddingProviderError(
                f"unexpected DashScope response shape: {str(body)[:500]}"
            ) from error

    def embed_clips(self, clips: list[VideoClipInput]) -> list[VideoClipEmbedding]:
        embeddings: list[VideoClipEmbedding] = []
        for clip in clips:
            frames = clip.frames[: self.frames_per_clip]
            if not frames:
                continue
            contents = [self._frame_content(frame) for _, frame in frames]
            vector = self._embed(contents)
            embeddings.append(
                VideoClipEmbedding(clip_id=clip.clip_id, start_ms=clip.start_ms, end_ms=clip.end_ms, vector=vector)
            )
        return embeddings

    def embed_query(self, text: str) -> list[float]:
        return self._embed([{"text": text}])


class RunpodQwenVLEmbeddingProvider(VideoEmbeddingProvider):
    """Dedicated Qwen/Qwen3-VL-Embedding-8B RunPod Serverless worker."""

    name = "runpod-qwen3-vl-embedding"
    dimensions = 1024

    def __init__(self) -> None:
        self.api_key = os.getenv("LARKUP_VIDEO_RUNPOD_EMBEDDING_API_KEY", os.getenv("RUNPOD_API_KEY", ""))
        self.endpoint_id = os.getenv("LARKUP_VIDEO_RUNPOD_EMBEDDING_ENDPOINT_ID", "")
        self.base_url = os.getenv("LARKUP_VIDEO_RUNPOD_EMBEDDING_BASE_URL", "")
        if not self.base_url and self.endpoint_id:
            self.base_url = f"https://api.runpod.ai/v2/{self.endpoint_id}/runsync"
        self.dimensions = int(os.getenv("LARKUP_VIDEO_EMBEDDING_DIMENSION", str(self.dimensions)))
        self.instruction = os.getenv("LARKUP_VIDEO_EMBEDDING_INSTRUCTION", "")
        self._session = requests.Session()

    def _embed(self, inputs: list[dict]) -> list[list[float]]:
        if not self.api_key:
            raise VideoEmbeddingProviderError("RUNPOD_API_KEY is not configured")
        if not self.base_url:
            raise VideoEmbeddingProviderError("LARKUP_VIDEO_RUNPOD_EMBEDDING_ENDPOINT_ID is not configured")
        payload = {"input": {"inputs": inputs, "dimensions": self.dimensions}}
        if self.instruction:
            payload["input"]["instruction"] = self.instruction
        response = self._session.post(
            self.base_url,
            json=payload,
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            timeout=300,
        )
        if not response.ok:
            raise VideoEmbeddingProviderError(
                f"RunPod embedding request failed {response.status_code}: {response.text[:300]}"
            )
        body = response.json()
        output = body.get("output", body)
        try:
            embeddings = output["embeddings"]
            if not isinstance(embeddings, list) or not all(isinstance(vector, list) for vector in embeddings):
                raise TypeError("embeddings is not a list of vectors")
            return [[float(value) for value in vector] for vector in embeddings]
        except (KeyError, TypeError, ValueError) as error:
            raise VideoEmbeddingProviderError(
                f"unexpected RunPod embedding response shape: {str(body)[:500]}"
            ) from error

    def _frame_content(self, frame: np.ndarray) -> str:
        ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            raise ValueError("could not encode frame as JPEG")
        return "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")

    def embed_clips(self, clips: list[VideoClipInput]) -> list[VideoClipEmbedding]:
        usable = [clip for clip in clips if clip.frames]
        if not usable:
            return []
        # The deployment API represents one embedding input as text and/or one
        # image. A midpoint frame keeps clip embeddings and query embeddings in
        # the same model space without multiplying requests by frame count.
        vectors = self._embed(
            [{"image": self._frame_content(clip.frames[len(clip.frames) // 2][1])} for clip in usable]
        )
        if len(vectors) != len(usable):
            raise VideoEmbeddingProviderError("RunPod returned a different number of embeddings than inputs")
        return [
            VideoClipEmbedding(clip_id=clip.clip_id, start_ms=clip.start_ms, end_ms=clip.end_ms, vector=vector)
            for clip, vector in zip(usable, vectors, strict=True)
        ]

    def embed_query(self, text: str) -> list[float]:
        return self._embed([{"text": text}])[0]


class HuggingFaceQwenVLEmbeddingProvider(VideoEmbeddingProvider):
    """Dedicated Qwen3-VL custom Hugging Face Inference Endpoint."""

    name = "huggingface-qwen3-vl-embedding"
    dimensions = 1024

    def __init__(self) -> None:
        self.base_url = os.getenv("LARKUP_VIDEO_HF_EMBEDDING_URL", "").rstrip("/")
        self.api_key = os.getenv("LARKUP_VIDEO_HF_EMBEDDING_API_KEY", os.getenv("HF_TOKEN", ""))
        self.dimensions = int(os.getenv("LARKUP_VIDEO_EMBEDDING_DIMENSION", str(self.dimensions)))
        self.instruction = os.getenv("LARKUP_VIDEO_EMBEDDING_INSTRUCTION", "")
        self._session = requests.Session()

    def _embed(self, inputs: list[dict]) -> list[list[float]]:
        if not self.base_url:
            raise VideoEmbeddingProviderError("LARKUP_VIDEO_HF_EMBEDDING_URL is not configured")
        if not self.api_key:
            raise VideoEmbeddingProviderError("HF_TOKEN is not configured")
        payload = {"inputs": inputs, "dimensions": self.dimensions}
        if self.instruction:
            payload["instruction"] = self.instruction
        response = self._session.post(
            self.base_url,
            json=payload,
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=300,
        )
        if not response.ok:
            raise VideoEmbeddingProviderError(
                f"Hugging Face embedding request failed {response.status_code}: {response.text[:300]}"
            )
        body = response.json()
        try:
            embeddings = body["embeddings"]
            if not isinstance(embeddings, list) or not all(isinstance(vector, list) for vector in embeddings):
                raise TypeError("embeddings is not a list of vectors")
            return [[float(value) for value in vector] for vector in embeddings]
        except (KeyError, TypeError, ValueError) as error:
            raise VideoEmbeddingProviderError(
                f"unexpected Hugging Face embedding response shape: {str(body)[:500]}"
            ) from error

    def _frame_content(self, frame: np.ndarray) -> str:
        ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            raise ValueError("could not encode frame as JPEG")
        return "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")

    def embed_clips(self, clips: list[VideoClipInput]) -> list[VideoClipEmbedding]:
        usable = [clip for clip in clips if clip.frames]
        if not usable:
            return []
        vectors = self._embed(
            [{"image": self._frame_content(clip.frames[len(clip.frames) // 2][1])} for clip in usable]
        )
        if len(vectors) != len(usable):
            raise VideoEmbeddingProviderError("Hugging Face returned a different number of embeddings than inputs")
        return [
            VideoClipEmbedding(clip_id=clip.clip_id, start_ms=clip.start_ms, end_ms=clip.end_ms, vector=vector)
            for clip, vector in zip(usable, vectors, strict=True)
        ]

    def embed_query(self, text: str) -> list[float]:
        return self._embed([{"text": text}])[0]


class GatewayGeminiMultimodalEmbeddingProvider(VideoEmbeddingProvider):
    """Gemini Embedding 2 through Vercel AI Gateway's model-native API.

    Unlike text-only embedding endpoints, this keeps a text query and JPEG
    frame in one multimodal vector space. It replaces the dedicated Qwen
    embedding endpoint for source indexing without introducing a GPU cold
    start. The Gateway API differs from its OpenAI-compatible `/v1/embeddings`
    route: model-native embedding calls use `/v4/ai/embedding-model`.
    """

    name = "gateway-gemini-embedding-2"
    dimensions = 3072

    def __init__(self) -> None:
        self.api_key = os.getenv("AI_GATEWAY_APIKEY") or os.getenv("AI_GATEWAY_API_KEY") or ""
        self.base_url = os.getenv(
            "LARKUP_VIDEO_GATEWAY_EMBEDDING_BASE_URL", "https://ai-gateway.vercel.sh/v4/ai"
        ).rstrip("/")
        self.model = os.getenv("LARKUP_VIDEO_GATEWAY_EMBEDDING_MODEL", "google/gemini-embedding-2")
        self.dimensions = int(os.getenv("LARKUP_VIDEO_EMBEDDING_DIMENSION", str(self.dimensions)))
        self.batch_size = max(1, min(6, int(os.getenv("LARKUP_VIDEO_GATEWAY_EMBEDDING_BATCH_SIZE", "6"))))
        self._session = requests.Session()

    def _embed(
        self,
        values: list[str],
        *,
        content: list[list[dict] | None] | None = None,
        task_type: str,
    ) -> list[list[float]]:
        if not self.api_key:
            raise VideoEmbeddingProviderError("AI_GATEWAY_API_KEY is not configured")
        payload: dict = {"values": values}
        google_options: dict = {"taskType": task_type}
        if content is not None:
            google_options["content"] = content
        payload["providerOptions"] = {"google": google_options}
        response = self._session.post(
            f"{self.base_url}/embedding-model",
            json=payload,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "ai-gateway-protocol-version": "0.0.1",
                "ai-gateway-auth-method": "api-key",
                "ai-embedding-model-specification-version": "4",
                "ai-model-id": self.model,
            },
            timeout=60,
        )
        if not response.ok:
            raise VideoEmbeddingProviderError(
                f"AI Gateway embedding request failed {response.status_code}: {response.text[:300]}"
            )
        body = response.json()
        try:
            vectors = body["embeddings"]
            if not isinstance(vectors, list) or not all(isinstance(vector, list) for vector in vectors):
                raise TypeError("embeddings is not a list of vectors")
            return [[float(value) for value in vector] for vector in vectors]
        except (KeyError, TypeError, ValueError) as error:
            raise VideoEmbeddingProviderError(
                f"unexpected AI Gateway embedding response shape: {str(body)[:500]}"
            ) from error

    @staticmethod
    def _frame_content(frame: np.ndarray) -> dict:
        ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            raise ValueError("could not encode frame as JPEG")
        return {
            "inlineData": {
                "mimeType": "image/jpeg",
                "data": base64.b64encode(buffer.tobytes()).decode("ascii"),
            }
        }

    def embed_clips(self, clips: list[VideoClipInput]) -> list[VideoClipEmbedding]:
        usable = [clip for clip in clips if clip.frames]
        embeddings: list[VideoClipEmbedding] = []
        for offset in range(0, len(usable), self.batch_size):
            batch = usable[offset : offset + self.batch_size]
            vectors = self._embed(
                ["timestamped video clip" for _ in batch],
                content=[
                    [self._frame_content(clip.frames[len(clip.frames) // 2][1])]
                    for clip in batch
                ],
                task_type="RETRIEVAL_DOCUMENT",
            )
            if len(vectors) != len(batch):
                raise VideoEmbeddingProviderError("AI Gateway returned a different number of embeddings than inputs")
            embeddings.extend(
                VideoClipEmbedding(clip_id=clip.clip_id, start_ms=clip.start_ms, end_ms=clip.end_ms, vector=vector)
                for clip, vector in zip(batch, vectors, strict=True)
            )
        return embeddings

    def embed_query(self, text: str) -> list[float]:
        return self._embed([text], task_type="RETRIEVAL_QUERY")[0]


_PROVIDERS: dict[str, type[VideoEmbeddingProvider]] = {
    "disabled": DisabledVideoEmbeddingProvider,
    "gateway-gemini-embedding-2": GatewayGeminiMultimodalEmbeddingProvider,
    "huggingface-qwen3-vl-embedding": HuggingFaceQwenVLEmbeddingProvider,
    "qwen3-vl-embedding": QwenVLEmbeddingProvider,
    "runpod-qwen3-vl-embedding": RunpodQwenVLEmbeddingProvider,
}


def available_video_embedding_providers() -> tuple[str, ...]:
    return tuple(sorted(_PROVIDERS))


def get_video_embedding_provider(name: str | None = None) -> VideoEmbeddingProvider:
    key = (name or os.getenv("LARKUP_VIDEO_EMBEDDING_PROVIDER", "disabled")).strip().lower()
    provider_cls = _PROVIDERS.get(key)
    if provider_cls is None:
        raise VideoEmbeddingProviderError(
            f"Unknown video embedding provider {key!r}; available: {available_video_embedding_providers()}"
        )
    return provider_cls()
