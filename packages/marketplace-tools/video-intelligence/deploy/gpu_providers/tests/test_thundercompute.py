from __future__ import annotations

import os
import subprocess
import unittest
from unittest.mock import MagicMock, patch

from gpu_providers.base import GPUProviderError, InstanceState
from gpu_providers.thundercompute import ThunderComputeProvider


def _response(status_code: int, json_body: dict | None = None, text: str = "") -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.ok = status_code < 400
    response.json.return_value = json_body or {}
    response.text = text
    return response


class FromEnvTests(unittest.TestCase):
    def test_raises_when_api_key_missing(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(GPUProviderError):
                ThunderComputeProvider.from_env()

    def test_builds_from_env_when_api_key_present(self) -> None:
        with patch.dict(os.environ, {"THUNDERCOMPUTE_API_KEY": "fake-key-for-tests"}, clear=True):
            provider = ThunderComputeProvider.from_env()
        self.assertEqual(provider.name, "thundercompute")


class LaunchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = ThunderComputeProvider(api_key="fake-key-for-tests")

    @patch("gpu_providers.thundercompute.subprocess.run")
    @patch("gpu_providers.thundercompute.requests.get")
    @patch("gpu_providers.thundercompute.requests.post")
    def test_launch_creates_instance_and_starts_container_over_ssh(
        self, mock_post: MagicMock, mock_get: MagicMock, mock_run: MagicMock
    ) -> None:
        mock_post.return_value = _response(
            201, {"identifier": 42, "uuid": "abc-123", "key": "fake-private-key-material"}
        )
        mock_get.return_value = _response(
            200, {"42": {"status": "RUNNING", "ip": "203.0.113.5"}}
        )
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="container-id\n", stderr=""
        )

        instance_id = self.provider.launch(
            job_id="job-1",
            image="ghcr.io/larkup/video-worker:latest",
            env={"LARKUP_VIDEO_JOB_ID": "job-1"},
            gpu_type="a100",
        )

        self.assertEqual(instance_id, "42")
        mock_post.assert_called_once()
        create_kwargs = mock_post.call_args.kwargs
        self.assertEqual(create_kwargs["json"]["gpu_type"], "a100")
        self.assertTrue(create_kwargs["headers"]["Authorization"].startswith("Bearer "))

        mock_run.assert_called_once()
        ssh_command = mock_run.call_args.args[0]
        self.assertIn("ubuntu@203.0.113.5", ssh_command)
        self.assertIn("-e", ssh_command)
        self.assertIn("LARKUP_VIDEO_JOB_ID=job-1", ssh_command)
        self.assertEqual(ssh_command[-1], "ghcr.io/larkup/video-worker:latest")

    @patch("gpu_providers.thundercompute.requests.post")
    def test_launch_raises_gpu_provider_error_when_create_fails(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(500, text="internal error")

        with self.assertRaises(GPUProviderError):
            self.provider.launch(
                job_id="job-1",
                image="ghcr.io/larkup/video-worker:latest",
                env={},
                gpu_type="a100",
            )

    @patch("gpu_providers.thundercompute.requests.get")
    @patch("gpu_providers.thundercompute.requests.post")
    def test_launch_raises_when_no_private_key_returned(
        self, mock_post: MagicMock, mock_get: MagicMock
    ) -> None:
        mock_post.return_value = _response(201, {"identifier": 7, "uuid": "u"})

        with self.assertRaises(GPUProviderError):
            self.provider.launch(job_id="job-1", image="img", env={}, gpu_type="a100")

        mock_get.assert_not_called()

    @patch("gpu_providers.thundercompute.subprocess.run")
    @patch("gpu_providers.thundercompute.requests.get")
    @patch("gpu_providers.thundercompute.requests.post")
    def test_launch_raises_when_ssh_start_command_fails(
        self, mock_post: MagicMock, mock_get: MagicMock, mock_run: MagicMock
    ) -> None:
        mock_post.return_value = _response(201, {"identifier": 42, "key": "fake-private-key"})
        mock_get.return_value = _response(200, {"42": {"status": "RUNNING", "ip": "203.0.113.5"}})
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="docker: command not found"
        )

        with self.assertRaises(GPUProviderError):
            self.provider.launch(job_id="job-1", image="img", env={}, gpu_type="a100")


class GetStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = ThunderComputeProvider(api_key="fake-key-for-tests")

    @patch("gpu_providers.thundercompute.requests.get")
    def test_maps_running_status(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(200, {"42": {"status": "RUNNING", "ip": "1.2.3.4"}})

        status = self.provider.get_status("42")

        self.assertEqual(status.state, InstanceState.RUNNING)
        self.assertEqual(status.detail, "RUNNING")

    @patch("gpu_providers.thundercompute.requests.get")
    def test_maps_deleting_status_to_exited(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(200, {"42": {"status": "DELETING"}})

        status = self.provider.get_status("42")

        self.assertEqual(status.state, InstanceState.EXITED)

    @patch("gpu_providers.thundercompute.requests.get")
    def test_missing_instance_maps_to_exited(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(200, {})

        status = self.provider.get_status("42")

        self.assertEqual(status.state, InstanceState.EXITED)

    @patch("gpu_providers.thundercompute.requests.get")
    def test_unrecognized_status_maps_to_unknown_with_raw_detail(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(200, {"42": {"status": "SOMETHING_NEW"}})

        status = self.provider.get_status("42")

        self.assertEqual(status.state, InstanceState.UNKNOWN)
        self.assertEqual(status.detail, "SOMETHING_NEW")


class TerminateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = ThunderComputeProvider(api_key="fake-key-for-tests")

    @patch("gpu_providers.thundercompute.requests.post")
    def test_terminate_succeeds(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(200, {"message": "deleted"})

        self.provider.terminate("42")

        mock_post.assert_called_once()
        self.assertIn("/instances/42/delete", mock_post.call_args.args[0])

    @patch("gpu_providers.thundercompute.requests.post")
    def test_terminate_is_a_noop_when_instance_already_gone(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(404, text="not found")

        self.provider.terminate("42")  # must not raise

    @patch("gpu_providers.thundercompute.requests.post")
    def test_terminate_raises_on_real_error(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(500, text="internal error")

        with self.assertRaises(GPUProviderError):
            self.provider.terminate("42")


if __name__ == "__main__":
    unittest.main()
