from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from gpu_providers.base import GPUProviderError, InstanceState
from gpu_providers.shadeform import ShadeformProvider


def _response(status_code: int = 200, json_body: dict | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.ok = 200 <= status_code < 300
    response.json.return_value = json_body or {}
    response.text = str(json_body or {})
    return response


class FromEnvTests(unittest.TestCase):
    @patch.dict("os.environ", {}, clear=True)
    def test_raises_when_api_key_is_unset(self) -> None:
        with self.assertRaises(GPUProviderError):
            ShadeformProvider.from_env()

    @patch.dict("os.environ", {"SHADE_FORM_API_KEY": "secret-key"}, clear=True)
    def test_builds_client_from_env(self) -> None:
        provider = ShadeformProvider.from_env()
        self.assertEqual(provider.api_key, "secret-key")


_TYPES_RESPONSE = {
    "instance_types": [
        {
            "cloud": "hyperstack",
            "shade_instance_type": "A6000",
            "hourly_price": 210,
            "availability": [{"region": "canada-1", "available": True}],
        }
    ]
}

_TYPES_RESPONSE_NO_CAPACITY = {
    "instance_types": [
        {
            "cloud": "hyperstack",
            "shade_instance_type": "A6000",
            "hourly_price": 210,
            "availability": [{"region": "canada-1", "available": False}],
        }
    ]
}


class LaunchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = ShadeformProvider(api_key="secret-key")

    @patch("gpu_providers.shadeform.requests.post")
    @patch("gpu_providers.shadeform.requests.get")
    def test_launch_builds_request_and_returns_instance_id(
        self, mock_get: MagicMock, mock_post: MagicMock
    ) -> None:
        mock_get.return_value = _response(200, _TYPES_RESPONSE)
        mock_post.return_value = _response(200, {"id": "inst-123"})

        instance_id = self.provider.launch(
            job_id="job-1",
            image="ghcr.io/larkup/video-worker:latest",
            env={"LARKUP_VIDEO_JOB_ID": "job-1"},
            gpu_type="A6000",
        )

        self.assertEqual(instance_id, "inst-123")

        get_kwargs = mock_get.call_args.kwargs
        self.assertEqual(mock_get.call_args.args[0], "https://api.shadeform.ai/v1/instances/types")
        self.assertEqual(get_kwargs["headers"]["X-API-KEY"], "secret-key")
        self.assertEqual(get_kwargs["params"]["shade_instance_type"], "A6000")

        post_args, post_kwargs = mock_post.call_args
        self.assertEqual(post_args[0], "https://api.shadeform.ai/v1/instances/create")
        self.assertEqual(post_kwargs["headers"]["X-API-KEY"], "secret-key")
        payload = post_kwargs["json"]
        self.assertEqual(payload["cloud"], "hyperstack")
        self.assertEqual(payload["region"], "canada-1")
        self.assertEqual(payload["shade_instance_type"], "A6000")
        self.assertIs(payload["shade_cloud"], True)
        self.assertEqual(payload["launch_configuration"]["type"], "docker")
        docker_config = payload["launch_configuration"]["docker_configuration"]
        self.assertEqual(docker_config["image"], "ghcr.io/larkup/video-worker:latest")
        self.assertIn({"name": "LARKUP_VIDEO_JOB_ID", "value": "job-1"}, docker_config["envs"])

    @patch("gpu_providers.shadeform.requests.post")
    @patch("gpu_providers.shadeform.requests.get")
    def test_launch_raises_when_no_capacity_matches(
        self, mock_get: MagicMock, mock_post: MagicMock
    ) -> None:
        mock_get.return_value = _response(200, _TYPES_RESPONSE_NO_CAPACITY)

        with self.assertRaises(GPUProviderError):
            self.provider.launch(
                job_id="job-1",
                image="ghcr.io/larkup/video-worker:latest",
                env={},
                gpu_type="A6000",
            )

        mock_post.assert_not_called()

    @patch("gpu_providers.shadeform.requests.get")
    def test_launch_raises_on_types_api_error(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(500, {"message": "internal error"})

        with self.assertRaises(GPUProviderError):
            self.provider.launch(
                job_id="job-1",
                image="ghcr.io/larkup/video-worker:latest",
                env={},
                gpu_type="A6000",
            )


class GetStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = ShadeformProvider(api_key="secret-key")

    @patch("gpu_providers.shadeform.requests.get")
    def test_active_maps_to_running(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(200, {"status": "active"})

        status = self.provider.get_status("inst-123")

        self.assertEqual(status.state, InstanceState.RUNNING)
        args, kwargs = mock_get.call_args
        self.assertEqual(args[0], "https://api.shadeform.ai/v1/instances/inst-123/info")
        self.assertEqual(kwargs["headers"]["X-API-KEY"], "secret-key")

    @patch("gpu_providers.shadeform.requests.get")
    def test_deleted_maps_to_exited(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(200, {"status": "deleted"})

        status = self.provider.get_status("inst-123")

        self.assertEqual(status.state, InstanceState.EXITED)

    @patch("gpu_providers.shadeform.requests.get")
    def test_unrecognized_status_maps_to_unknown_with_detail(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(200, {"status": "some_new_status"})

        status = self.provider.get_status("inst-123")

        self.assertEqual(status.state, InstanceState.UNKNOWN)
        self.assertEqual(status.detail, "some_new_status")


class TerminateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = ShadeformProvider(api_key="secret-key")

    @patch("gpu_providers.shadeform.requests.post")
    def test_terminate_succeeds(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(200, {})

        self.provider.terminate("inst-123")

        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], "https://api.shadeform.ai/v1/instances/inst-123/delete")
        self.assertEqual(kwargs["headers"]["X-API-KEY"], "secret-key")

    @patch("gpu_providers.shadeform.requests.post")
    def test_terminate_is_a_noop_when_instance_already_gone(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(404, {"message": "not found"})

        self.provider.terminate("inst-already-gone")


if __name__ == "__main__":
    unittest.main()
