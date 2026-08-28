from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

import numpy as np

from app.services.embedding import (
    DisabledVideoEmbeddingProvider,
    GatewayGeminiMultimodalEmbeddingProvider,
    HuggingFaceQwenVLEmbeddingProvider,
    QwenVLEmbeddingProvider,
    RunpodQwenVLEmbeddingProvider,
    VideoClipInput,
    VideoEmbeddingProviderError,
    available_video_embedding_providers,
    get_video_embedding_provider,
)


def _clip(clip_id: str = "clip_0", frame_count: int = 3) -> VideoClipInput:
    frames = [(i * 100, np.zeros((16, 16, 3), dtype=np.uint8)) for i in range(frame_count)]
    return VideoClipInput(clip_id=clip_id, start_ms=0, end_ms=frame_count * 100, frames=frames)


class _RecordingHandler(BaseHTTPRequestHandler):
    received: list[dict] = []
    response_body: dict = {}
    response_status: int = 200

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        type(self).received.append({"body": json.loads(body), "headers": dict(self.headers)})
        self.send_response(type(self).response_status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(type(self).response_body).encode("utf-8"))

    def log_message(self, *args) -> None:  # silence test output
        pass


class _LocalServer:
    def __enter__(self):
        _RecordingHandler.received = []
        self.server = HTTPServer(("127.0.0.1", 0), _RecordingHandler)
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return f"http://127.0.0.1:{self.port}"

    def __exit__(self, *exc):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()


class RegistryTests(unittest.TestCase):
    def test_available_providers_lists_supported_backends(self) -> None:
        self.assertEqual(
            available_video_embedding_providers(),
            (
                "disabled",
                "gateway-gemini-embedding-2",
                "huggingface-qwen3-vl-embedding",
                "qwen3-vl-embedding",
                "runpod-qwen3-vl-embedding",
            ),
        )

    def test_default_provider_is_disabled_without_env_configuration(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            provider = get_video_embedding_provider()
        self.assertIsInstance(provider, DisabledVideoEmbeddingProvider)

    def test_get_provider_selects_qwen_by_name(self) -> None:
        provider = get_video_embedding_provider("qwen3-vl-embedding")
        self.assertIsInstance(provider, QwenVLEmbeddingProvider)

    def test_get_provider_selects_dedicated_runpod_by_name(self) -> None:
        provider = get_video_embedding_provider("runpod-qwen3-vl-embedding")
        self.assertIsInstance(provider, RunpodQwenVLEmbeddingProvider)

    def test_get_provider_selects_gateway_gemini_by_name(self) -> None:
        provider = get_video_embedding_provider("gateway-gemini-embedding-2")
        self.assertIsInstance(provider, GatewayGeminiMultimodalEmbeddingProvider)

    def test_get_provider_rejects_an_unknown_name(self) -> None:
        with self.assertRaises(VideoEmbeddingProviderError):
            get_video_embedding_provider("does-not-exist")


class DisabledProviderTests(unittest.TestCase):
    def test_embed_clips_returns_empty_without_raising(self) -> None:
        self.assertEqual(DisabledVideoEmbeddingProvider().embed_clips([_clip()]), [])

    def test_embed_query_raises_a_clear_error(self) -> None:
        with self.assertRaises(VideoEmbeddingProviderError):
            DisabledVideoEmbeddingProvider().embed_query("anything")


class QwenVLEmbeddingProviderTests(unittest.TestCase):
    def test_embed_query_without_an_api_key_raises_a_clear_error(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            provider = QwenVLEmbeddingProvider()
        with self.assertRaises(VideoEmbeddingProviderError) as ctx:
            provider.embed_query("what happened at the end")
        self.assertIn("DASHSCOPE_API_KEY", str(ctx.exception))

    def test_embed_clips_with_no_usable_clips_returns_empty_without_a_network_call(self) -> None:
        with patch.dict("os.environ", {"DASHSCOPE_API_KEY": "k"}, clear=True):
            provider = QwenVLEmbeddingProvider()
        empty_clip = VideoClipInput(clip_id="c", start_ms=0, end_ms=0, frames=[])
        self.assertEqual(provider.embed_clips([empty_clip]), [])

    def test_base_url_is_built_from_workspace_id_and_region(self) -> None:
        with patch.dict(
            "os.environ",
            {"DASHSCOPE_API_KEY": "k", "DASHSCOPE_WORKSPACE_ID": "ws123", "DASHSCOPE_REGION": "eu-central-1"},
            clear=True,
        ):
            provider = QwenVLEmbeddingProvider()
        self.assertEqual(
            provider.base_url,
            "https://ws123.eu-central-1.maas.aliyuncs.com/api/v1/services/embeddings/"
            "multimodal-embedding/multimodal-embedding",
        )

    def test_embed_query_without_workspace_config_raises_a_clear_error(self) -> None:
        with patch.dict("os.environ", {"DASHSCOPE_API_KEY": "k"}, clear=True):
            provider = QwenVLEmbeddingProvider()
        with self.assertRaises(VideoEmbeddingProviderError) as ctx:
            provider.embed_query("anything")
        self.assertIn("DASHSCOPE_WORKSPACE_ID", str(ctx.exception))

    def test_override_base_url_wins_over_workspace_id_and_region(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "DASHSCOPE_API_KEY": "k",
                "DASHSCOPE_WORKSPACE_ID": "ws123",
                "DASHSCOPE_REGION": "eu-central-1",
                "LARKUP_VIDEO_DASHSCOPE_BASE_URL": "https://example.test/override",
            },
            clear=True,
        ):
            provider = QwenVLEmbeddingProvider()
        self.assertEqual(provider.base_url, "https://example.test/override")

    def test_embed_query_sends_the_documented_request_shape_and_parses_the_response(self) -> None:
        with _LocalServer() as url:
            _RecordingHandler.response_body = {"output": {"embeddings": [{"embedding": [0.1, 0.2, 0.3]}]}}
            with patch.dict(
                "os.environ",
                {"DASHSCOPE_API_KEY": "test-key", "LARKUP_VIDEO_DASHSCOPE_BASE_URL": url},
                clear=True,
            ):
                provider = QwenVLEmbeddingProvider()
                vector = provider.embed_query("a person raises their hand")
            self.assertEqual(vector, [0.1, 0.2, 0.3])
            self.assertEqual(len(_RecordingHandler.received), 1)
            sent = _RecordingHandler.received[0]
            self.assertEqual(sent["headers"]["Authorization"], "Bearer test-key")
            self.assertEqual(sent["body"]["input"]["contents"], [{"text": "a person raises their hand"}])
            self.assertEqual(sent["body"]["model"], "qwen3-vl-embedding")

    def test_embed_clips_sends_one_request_per_clip_with_fused_frame_images(self) -> None:
        with _LocalServer() as url:
            _RecordingHandler.response_body = {"output": {"embeddings": [{"embedding": [1.0, 2.0]}]}}
            with patch.dict(
                "os.environ",
                {
                    "DASHSCOPE_API_KEY": "test-key",
                    "LARKUP_VIDEO_DASHSCOPE_BASE_URL": url,
                    "LARKUP_VIDEO_EMBEDDING_FRAMES_PER_CLIP": "2",
                },
                clear=True,
            ):
                provider = QwenVLEmbeddingProvider()
                embeddings = provider.embed_clips([_clip("clip_0", frame_count=3)])
            self.assertEqual(len(embeddings), 1)
            self.assertEqual(embeddings[0].clip_id, "clip_0")
            self.assertEqual(embeddings[0].vector, [1.0, 2.0])
            sent = _RecordingHandler.received[0]
            # frames_per_clip=2 caps a 3-frame clip down to 2 image contents.
            self.assertEqual(len(sent["body"]["input"]["contents"]), 2)
            self.assertTrue(all("image" in item for item in sent["body"]["input"]["contents"]))
            self.assertTrue(sent["body"]["parameters"]["enable_fusion"])

    def test_embed_query_raises_a_clear_error_on_an_http_failure(self) -> None:
        with _LocalServer() as url:
            _RecordingHandler.response_status = 403
            _RecordingHandler.response_body = {"code": "AccessDenied.Unpurchased", "message": "denied"}
            with patch.dict(
                "os.environ",
                {"DASHSCOPE_API_KEY": "test-key", "LARKUP_VIDEO_DASHSCOPE_BASE_URL": url},
                clear=True,
            ):
                provider = QwenVLEmbeddingProvider()
                with self.assertRaises(VideoEmbeddingProviderError) as ctx:
                    provider.embed_query("anything")
            self.assertIn("403", str(ctx.exception))
            _RecordingHandler.response_status = 200

    def test_embed_query_raises_a_clear_error_on_an_unexpected_response_shape(self) -> None:
        with _LocalServer() as url:
            _RecordingHandler.response_body = {"unexpected": "shape"}
            with patch.dict(
                "os.environ",
                {"DASHSCOPE_API_KEY": "test-key", "LARKUP_VIDEO_DASHSCOPE_BASE_URL": url},
                clear=True,
            ):
                provider = QwenVLEmbeddingProvider()
                with self.assertRaises(VideoEmbeddingProviderError):
                    provider.embed_query("anything")


class GatewayGeminiMultimodalEmbeddingProviderTests(unittest.TestCase):
    def test_embeds_a_jpeg_frame_and_query_with_model_native_gateway_shape(self) -> None:
        with _LocalServer() as url:
            _RecordingHandler.response_body = {"embeddings": [[0.1, 0.2]]}
            with patch.dict(
                "os.environ",
                {
                    "AI_GATEWAY_API_KEY": "test-key",
                    "LARKUP_VIDEO_GATEWAY_EMBEDDING_BASE_URL": url,
                    "LARKUP_VIDEO_GATEWAY_EMBEDDING_BATCH_SIZE": "6",
                },
                clear=True,
            ):
                provider = GatewayGeminiMultimodalEmbeddingProvider()
                embeddings = provider.embed_clips([_clip("clip_0")])
                _RecordingHandler.response_body = {"embeddings": [[0.3, 0.4]]}
                query = provider.embed_query("who won the match")
            self.assertEqual(embeddings[0].vector, [0.1, 0.2])
            self.assertEqual(query, [0.3, 0.4])
            clip_request, query_request = _RecordingHandler.received
            headers = {key.lower(): value for key, value in clip_request["headers"].items()}
            self.assertEqual(headers["ai-model-id"], "google/gemini-embedding-2")
            self.assertEqual(clip_request["body"]["providerOptions"]["google"]["taskType"], "RETRIEVAL_DOCUMENT")
            image = clip_request["body"]["providerOptions"]["google"]["content"][0][0]["inlineData"]
            self.assertEqual(image["mimeType"], "image/jpeg")
            self.assertTrue(image["data"])
            self.assertEqual(query_request["body"]["values"], ["who won the match"])
            self.assertEqual(query_request["body"]["providerOptions"]["google"]["taskType"], "RETRIEVAL_QUERY")


class RunpodQwenVLEmbeddingProviderTests(unittest.TestCase):
    def test_embed_query_sends_runsync_payload_and_parses_output(self) -> None:
        with _LocalServer() as url:
            _RecordingHandler.response_body = {"output": {"embeddings": [[0.1, 0.2, 0.3]]}}
            with patch.dict(
                "os.environ",
                {
                    "RUNPOD_API_KEY": "test-key",
                    "LARKUP_VIDEO_RUNPOD_EMBEDDING_BASE_URL": url,
                    "LARKUP_VIDEO_EMBEDDING_DIMENSION": "1024",
                },
                clear=True,
            ):
                provider = RunpodQwenVLEmbeddingProvider()
                self.assertEqual(provider.embed_query("a person raises their hand"), [0.1, 0.2, 0.3])
            sent = _RecordingHandler.received[0]
            self.assertEqual(sent["headers"]["Authorization"], "Bearer test-key")
            self.assertEqual(sent["body"], {"input": {"inputs": [{"text": "a person raises their hand"}], "dimensions": 1024}})

    def test_embed_query_requires_endpoint_configuration(self) -> None:
        with patch.dict("os.environ", {"RUNPOD_API_KEY": "test-key"}, clear=True):
            provider = RunpodQwenVLEmbeddingProvider()
        with self.assertRaises(VideoEmbeddingProviderError) as ctx:
            provider.embed_query("anything")
        self.assertIn("ENDPOINT_ID", str(ctx.exception))


class HuggingFaceQwenVLEmbeddingProviderTests(unittest.TestCase):
    def test_embed_query_sends_bearer_payload_and_parses_output(self) -> None:
        with _LocalServer() as url:
            _RecordingHandler.response_body = {"embeddings": [[0.1, 0.2, 0.3]]}
            with patch.dict(
                "os.environ",
                {
                    "HF_TOKEN": "test-key",
                    "LARKUP_VIDEO_HF_EMBEDDING_URL": url,
                    "LARKUP_VIDEO_EMBEDDING_DIMENSION": "1024",
                },
                clear=True,
            ):
                provider = HuggingFaceQwenVLEmbeddingProvider()
                self.assertEqual(provider.embed_query("a person raises their hand"), [0.1, 0.2, 0.3])
            sent = _RecordingHandler.received[0]
            self.assertEqual(sent["headers"]["Authorization"], "Bearer test-key")
            self.assertEqual(sent["body"], {"inputs": [{"text": "a person raises their hand"}], "dimensions": 1024})

    def test_embed_query_requires_endpoint_url_and_token(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            provider = HuggingFaceQwenVLEmbeddingProvider()
        with self.assertRaises(VideoEmbeddingProviderError) as ctx:
            provider.embed_query("anything")
        self.assertIn("LARKUP_VIDEO_HF_EMBEDDING_URL", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
