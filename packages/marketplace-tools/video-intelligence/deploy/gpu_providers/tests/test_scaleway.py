from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from gpu_providers.base import GPUProviderError, InstanceState
from gpu_providers.scaleway import ScalewayProvider


def _response(status_code: int = 200, json_body: dict | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.ok = 200 <= status_code < 300
    response.json.return_value = json_body or {}
    response.text = str(json_body or {})
    return response


_ENV = {
    "SCALEAWAY_API_KEY": "secret-key",
    "SCALEAWAY_PROJECT_ID": "11111111-1111-1111-1111-111111111111",
    "SCALEAWAY_GPU_IMAGE_ID": "22222222-2222-2222-2222-222222222222",
}


class FromEnvTests(unittest.TestCase):
    @patch.dict("os.environ", {}, clear=True)
    def test_raises_when_api_key_is_unset(self) -> None:
        with self.assertRaises(GPUProviderError):
            ScalewayProvider.from_env()

    @patch.dict("os.environ", {"SCALEAWAY_API_KEY": "secret-key"}, clear=True)
    def test_raises_when_project_id_is_unset(self) -> None:
        with self.assertRaises(GPUProviderError):
            ScalewayProvider.from_env()

    @patch.dict(
        "os.environ",
        {"SCALEAWAY_API_KEY": "secret-key", "SCALEAWAY_PROJECT_ID": "proj-1"},
        clear=True,
    )
    def test_raises_when_image_id_is_unset(self) -> None:
        with self.assertRaises(GPUProviderError):
            ScalewayProvider.from_env()

    @patch.dict("os.environ", _ENV, clear=True)
    def test_builds_client_from_env_with_default_zone(self) -> None:
        provider = ScalewayProvider.from_env()
        self.assertEqual(provider.secret_key, "secret-key")
        self.assertEqual(provider.project_id, _ENV["SCALEAWAY_PROJECT_ID"])
        self.assertEqual(provider.image_id, _ENV["SCALEAWAY_GPU_IMAGE_ID"])
        self.assertEqual(provider.default_zone, "fr-par-2")

    @patch.dict("os.environ", {**_ENV, "SCALEAWAY_DEFAULT_ZONE": "nl-ams-1"}, clear=True)
    def test_builds_client_with_overridden_zone(self) -> None:
        provider = ScalewayProvider.from_env()
        self.assertEqual(provider.default_zone, "nl-ams-1")


class LaunchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = ScalewayProvider(
            secret_key="secret-key",
            project_id="proj-1",
            image_id="image-1",
        )

    @patch("gpu_providers.scaleway.requests.patch")
    @patch("gpu_providers.scaleway.requests.post")
    def test_launch_builds_request_and_returns_instance_id(
        self, mock_post: MagicMock, mock_patch: MagicMock
    ) -> None:
        create_response = _response(201, {"server": {"id": "server-123"}})
        poweron_response = _response(200, {})
        mock_post.side_effect = [create_response, poweron_response]
        mock_patch.return_value = _response(200, {})

        instance_id = self.provider.launch(
            job_id="job-1",
            image="ghcr.io/larkup/video-worker:latest",
            env={"LARKUP_VIDEO_JOB_ID": "job-1"},
            gpu_type="L4-1-24G",
        )

        self.assertEqual(instance_id, "fr-par-2/server-123")

        create_args, create_kwargs = mock_post.call_args_list[0]
        self.assertEqual(
            create_args[0], "https://api.scaleway.com/instance/v1/zones/fr-par-2/servers"
        )
        self.assertEqual(create_kwargs["headers"]["X-Auth-Token"], "secret-key")
        payload = create_kwargs["json"]
        self.assertEqual(payload["commercial_type"], "L4-1-24G")
        self.assertEqual(payload["project"], "proj-1")
        self.assertEqual(payload["image"], "image-1")
        self.assertIs(payload["dynamic_ip_required"], True)

        patch_args, patch_kwargs = mock_patch.call_args
        self.assertEqual(
            patch_args[0],
            "https://api.scaleway.com/instance/v1/zones/fr-par-2/servers/server-123/user_data/cloud-init",
        )
        self.assertEqual(patch_kwargs["headers"]["X-Auth-Token"], "secret-key")
        script = patch_kwargs["data"].decode("utf-8")
        self.assertIn("docker pull ghcr.io/larkup/video-worker:latest", script)
        self.assertIn("--gpus all", script)
        self.assertIn("LARKUP_VIDEO_JOB_ID=job-1", script)

        poweron_args, poweron_kwargs = mock_post.call_args_list[1]
        self.assertEqual(
            poweron_args[0],
            "https://api.scaleway.com/instance/v1/zones/fr-par-2/servers/server-123/action",
        )
        self.assertEqual(poweron_kwargs["json"], {"action": "poweron"})

    @patch("gpu_providers.scaleway.requests.post")
    def test_launch_raises_on_create_failure(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(400, {"message": "bad request"})

        with self.assertRaises(GPUProviderError):
            self.provider.launch(
                job_id="job-1",
                image="ghcr.io/larkup/video-worker:latest",
                env={},
                gpu_type="L4-1-24G",
            )


class GetStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = ScalewayProvider(
            secret_key="secret-key",
            project_id="proj-1",
            image_id="image-1",
        )

    @patch("gpu_providers.scaleway.requests.get")
    def test_running_maps_to_running(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(200, {"server": {"state": "running"}})

        status = self.provider.get_status("fr-par-2/server-123")

        self.assertEqual(status.state, InstanceState.RUNNING)
        args, kwargs = mock_get.call_args
        self.assertEqual(
            args[0], "https://api.scaleway.com/instance/v1/zones/fr-par-2/servers/server-123"
        )
        self.assertEqual(kwargs["headers"]["X-Auth-Token"], "secret-key")

    @patch("gpu_providers.scaleway.requests.get")
    def test_stopped_maps_to_exited(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(200, {"server": {"state": "stopped"}})

        status = self.provider.get_status("fr-par-2/server-123")

        self.assertEqual(status.state, InstanceState.EXITED)

    @patch("gpu_providers.scaleway.requests.get")
    def test_unrecognized_state_maps_to_unknown_with_detail(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(200, {"server": {"state": "locked"}})

        status = self.provider.get_status("fr-par-2/server-123")

        self.assertEqual(status.state, InstanceState.UNKNOWN)
        self.assertEqual(status.detail, "locked")

    @patch("gpu_providers.scaleway.requests.get")
    def test_uses_default_zone_when_instance_id_has_no_zone_prefix(
        self, mock_get: MagicMock
    ) -> None:
        mock_get.return_value = _response(200, {"server": {"state": "running"}})

        self.provider.get_status("bare-server-id")

        args, _kwargs = mock_get.call_args
        self.assertEqual(
            args[0], "https://api.scaleway.com/instance/v1/zones/fr-par-2/servers/bare-server-id"
        )


class TerminateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = ScalewayProvider(
            secret_key="secret-key",
            project_id="proj-1",
            image_id="image-1",
        )

    @patch("gpu_providers.scaleway.requests.post")
    def test_terminate_succeeds(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(200, {})

        self.provider.terminate("fr-par-2/server-123")

        args, kwargs = mock_post.call_args
        self.assertEqual(
            args[0],
            "https://api.scaleway.com/instance/v1/zones/fr-par-2/servers/server-123/action",
        )
        self.assertEqual(kwargs["json"], {"action": "terminate"})
        self.assertEqual(kwargs["headers"]["X-Auth-Token"], "secret-key")

    @patch("gpu_providers.scaleway.requests.post")
    def test_terminate_is_a_noop_when_instance_already_gone(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(404, {"message": "not found"})

        self.provider.terminate("fr-par-2/server-already-gone")


if __name__ == "__main__":
    unittest.main()
