from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from gpu_providers.base import GPUProviderError, InstanceState
from gpu_providers.salad import SaladProvider


def _response(status_code: int, json_body: dict | None = None, text: str = "") -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.ok = 200 <= status_code < 300
    response.json.return_value = json_body or {}
    response.text = text
    return response


class SaladFromEnvTests(unittest.TestCase):
    def test_raises_when_api_key_missing(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(GPUProviderError):
                SaladProvider.from_env()

    def test_raises_when_organization_name_missing(self) -> None:
        with patch.dict("os.environ", {"SALAD_API_KEY": "key"}, clear=True):
            with self.assertRaises(GPUProviderError):
                SaladProvider.from_env()

    def test_builds_provider_with_default_project_name(self) -> None:
        env = {"SALAD_API_KEY": "key", "SALAD_ORGANIZATION_NAME": "acme"}
        with patch.dict("os.environ", env, clear=True):
            provider = SaladProvider.from_env()
        self.assertEqual(provider.api_key, "key")
        self.assertEqual(provider.organization_name, "acme")
        self.assertEqual(provider.project_name, "larkup-video")

    def test_builds_provider_with_explicit_project_name(self) -> None:
        env = {
            "SALAD_API_KEY": "key",
            "SALAD_ORGANIZATION_NAME": "acme",
            "SALAD_PROJECT_NAME": "custom-project",
        }
        with patch.dict("os.environ", env, clear=True):
            provider = SaladProvider.from_env()
        self.assertEqual(provider.project_name, "custom-project")


class SaladProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = SaladProvider(
            api_key="secret-key", organization_name="acme", project_name="larkup-video"
        )

    @patch("gpu_providers.salad.requests.request")
    def test_launch_builds_expected_request_and_returns_instance_id(self, mock_request: MagicMock) -> None:
        mock_request.return_value = _response(201, {"name": "larkup-job-42"})

        instance_id = self.provider.launch(
            job_id="Job_42",
            image="ghcr.io/larkup/video-worker:latest",
            env={"LARKUP_VIDEO_JOB_ID": "job-42"},
            gpu_type="ed563892-aacd-40f5-80b7-90c9be6c759b",
        )

        self.assertEqual(instance_id, "larkup-job-42")
        mock_request.assert_called_once()
        method, url = mock_request.call_args.args
        kwargs = mock_request.call_args.kwargs
        self.assertEqual(method, "POST")
        self.assertEqual(
            url,
            "https://api.salad.com/api/public/organizations/acme/projects/larkup-video/containers",
        )
        self.assertEqual(kwargs["headers"]["Salad-Api-Key"], "secret-key")
        body = kwargs["json"]
        self.assertEqual(body["name"], "larkup-job-42")
        self.assertEqual(body["container"]["image"], "ghcr.io/larkup/video-worker:latest")
        self.assertEqual(body["container"]["environment_variables"], {"LARKUP_VIDEO_JOB_ID": "job-42"})
        self.assertEqual(
            body["container"]["resources"]["gpu_classes"], ["ed563892-aacd-40f5-80b7-90c9be6c759b"]
        )
        self.assertEqual(body["replicas"], 1)
        self.assertEqual(body["autostart_policy"], True)

    @patch("gpu_providers.salad.requests.request")
    def test_launch_raises_gpu_provider_error_on_api_failure(self, mock_request: MagicMock) -> None:
        mock_request.return_value = _response(422, text="invalid gpu_classes")

        with self.assertRaises(GPUProviderError):
            self.provider.launch(
                job_id="job-1",
                image="ghcr.io/larkup/video-worker:latest",
                env={},
                gpu_type="not-a-real-uuid",
            )

    @patch("gpu_providers.salad.requests.request")
    def test_get_status_maps_running(self, mock_request: MagicMock) -> None:
        mock_request.return_value = _response(200, {"current_state": {"status": "running"}})

        status = self.provider.get_status("larkup-job-42")

        self.assertEqual(status.state, InstanceState.RUNNING)
        self.assertEqual(status.detail, "running")

    @patch("gpu_providers.salad.requests.request")
    def test_get_status_maps_stopped_to_exited(self, mock_request: MagicMock) -> None:
        mock_request.return_value = _response(200, {"current_state": {"status": "stopped"}})

        status = self.provider.get_status("larkup-job-42")

        self.assertEqual(status.state, InstanceState.EXITED)

    @patch("gpu_providers.salad.requests.request")
    def test_get_status_maps_succeeded_to_exited(self, mock_request: MagicMock) -> None:
        mock_request.return_value = _response(200, {"current_state": {"status": "succeeded"}})

        status = self.provider.get_status("larkup-job-42")

        self.assertEqual(status.state, InstanceState.EXITED)

    @patch("gpu_providers.salad.requests.request")
    def test_get_status_maps_unknown_status_conservatively(self, mock_request: MagicMock) -> None:
        mock_request.return_value = _response(200, {"current_state": {"status": "some_new_status"}})

        status = self.provider.get_status("larkup-job-42")

        self.assertEqual(status.state, InstanceState.UNKNOWN)
        self.assertEqual(status.detail, "some_new_status")

    @patch("gpu_providers.salad.requests.request")
    def test_terminate_succeeds(self, mock_request: MagicMock) -> None:
        mock_request.return_value = _response(204)

        self.provider.terminate("larkup-job-42")

        method, url = mock_request.call_args.args
        self.assertEqual(method, "DELETE")
        self.assertTrue(url.endswith("/containers/larkup-job-42"))

    @patch("gpu_providers.salad.requests.request")
    def test_terminate_is_a_noop_when_already_gone(self, mock_request: MagicMock) -> None:
        mock_request.return_value = _response(404, text="not found")

        self.provider.terminate("larkup-job-42")  # must not raise


if __name__ == "__main__":
    unittest.main()
