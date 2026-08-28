from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from gpu_providers.base import GPUProviderError, InstanceState
from gpu_providers.gpuai import GpuAiProvider


def _response(status_code: int, json_body: dict | None = None, text: str = "") -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.ok = status_code < 400
    response.json.return_value = json_body or {}
    response.text = text
    return response


class GpuAiProviderTests(unittest.TestCase):
    def test_from_env_raises_when_api_key_missing(self) -> None:
        with patch("gpu_providers.gpuai.os.getenv", return_value=None):
            with self.assertRaises(GPUProviderError):
                GpuAiProvider.from_env()

    def test_from_env_builds_provider_from_api_key(self) -> None:
        with patch("gpu_providers.gpuai.os.getenv", return_value="gpuai_live_test"):
            provider = GpuAiProvider.from_env()
        self.assertEqual(provider.api_key, "gpuai_live_test")

    def test_launch_raises_because_arbitrary_docker_images_are_not_supported(self) -> None:
        provider = GpuAiProvider(api_key="key")
        with self.assertRaises(GPUProviderError) as ctx:
            provider.launch(
                job_id="job-1",
                image="ghcr.io/larkup/video-worker:latest",
                env={"LARKUP_VIDEO_JOB_ID": "job-1"},
                gpu_type="A100",
            )
        message = str(ctx.exception)
        self.assertIn("arbitrary Docker image", message)
        self.assertIn("job-1", message)

    def test_get_status_maps_running_state(self) -> None:
        provider = GpuAiProvider(api_key="key")
        with patch("gpu_providers.gpuai.requests.get") as mock_get:
            mock_get.return_value = _response(200, {"status": "running"})
            status = provider.get_status("inst-1")
        self.assertEqual(status.state, InstanceState.RUNNING)
        self.assertEqual(status.detail, "running")
        mock_get.assert_called_once()
        self.assertIn("inst-1", mock_get.call_args.args[0])
        self.assertEqual(
            mock_get.call_args.kwargs["headers"]["Authorization"], "Bearer key"
        )

    def test_get_status_maps_terminated_state(self) -> None:
        provider = GpuAiProvider(api_key="key")
        with patch("gpu_providers.gpuai.requests.get") as mock_get:
            mock_get.return_value = _response(200, {"status": "terminated"})
            status = provider.get_status("inst-1")
        self.assertEqual(status.state, InstanceState.EXITED)
        self.assertEqual(status.detail, "terminated")

    def test_get_status_maps_unknown_raw_status_conservatively(self) -> None:
        provider = GpuAiProvider(api_key="key")
        with patch("gpu_providers.gpuai.requests.get") as mock_get:
            mock_get.return_value = _response(200, {"status": "some_new_status"})
            status = provider.get_status("inst-1")
        self.assertEqual(status.state, InstanceState.UNKNOWN)
        self.assertEqual(status.detail, "some_new_status")

    def test_get_status_raises_on_error_response(self) -> None:
        provider = GpuAiProvider(api_key="key")
        with patch("gpu_providers.gpuai.requests.get") as mock_get:
            mock_get.return_value = _response(500, text="internal error")
            with self.assertRaises(GPUProviderError):
                provider.get_status("inst-1")

    def test_terminate_succeeds(self) -> None:
        provider = GpuAiProvider(api_key="key")
        with patch("gpu_providers.gpuai.requests.delete") as mock_delete:
            mock_delete.return_value = _response(202, {"state": "in_progress"})
            provider.terminate("inst-1")
        mock_delete.assert_called_once()
        self.assertIn("inst-1", mock_delete.call_args.args[0])

    def test_terminate_is_a_noop_when_instance_already_gone(self) -> None:
        provider = GpuAiProvider(api_key="key")
        with patch("gpu_providers.gpuai.requests.delete") as mock_delete:
            mock_delete.return_value = _response(404, text="not found")
            provider.terminate("inst-1")  # must not raise


if __name__ == "__main__":
    unittest.main()
