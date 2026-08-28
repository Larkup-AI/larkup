from __future__ import annotations

import json
import os
import unittest
from typing import Any
from unittest.mock import MagicMock, patch

from gpu_providers.base import GPUProviderError, InstanceState
from gpu_providers.northflank import NorthflankProvider


def _mock_response(status_code: int, json_body: dict[str, Any]) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.ok = 200 <= status_code < 400
    response.json.return_value = json_body
    response.text = json.dumps(json_body)
    return response


class NorthflankProviderFromEnvTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    def test_from_env_raises_when_api_key_missing(self) -> None:
        with self.assertRaises(GPUProviderError):
            NorthflankProvider.from_env()

    @patch.dict(os.environ, {"NORTHFLANK_API_KEY": "test-key-123"}, clear=True)
    def test_from_env_raises_when_project_id_missing(self) -> None:
        with self.assertRaises(GPUProviderError):
            NorthflankProvider.from_env()

    @patch.dict(
        os.environ,
        {"NORTHFLANK_API_KEY": "test-key-123", "NORTHFLANK_PROJECT_ID": "default-project"},
        clear=True,
    )
    def test_from_env_reads_required_vars(self) -> None:
        provider = NorthflankProvider.from_env()
        self.assertEqual(provider.api_key, "test-key-123")
        self.assertEqual(provider.project_id, "default-project")


class NorthflankProviderLaunchTests(unittest.TestCase):
    @patch("gpu_providers.northflank.requests.post")
    def test_launch_creates_job_and_starts_a_run(self, mock_post: MagicMock) -> None:
        mock_post.side_effect = [
            _mock_response(200, {"data": {"id": "video-job-1", "name": "video-job-1"}}),
            _mock_response(
                200,
                {"data": {"id": "d34582a4-35bd-4c71-8e7c-e36999b88723", "runName": "video-job-1-run"}},
            ),
        ]

        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        instance_id = provider.launch(
            job_id="job_1",
            image="larkup/video-worker:latest",
            env={"LARKUP_VIDEO_JOB_ID": "job_1", "LARKUP_VIDEO_BUCKET": "my-bucket"},
            gpu_type="nvidia-tesla-t4",
            region="us-east",
        )

        self.assertEqual(instance_id, "video-job-1:d34582a4-35bd-4c71-8e7c-e36999b88723")
        self.assertEqual(mock_post.call_count, 2)

        create_args, create_kwargs = mock_post.call_args_list[0]
        self.assertEqual(create_args[0], "https://api.northflank.com/v1/projects/default-project/jobs")
        self.assertEqual(create_kwargs["headers"]["Authorization"], "Bearer secret-key")
        self.assertEqual(create_kwargs["timeout"], 20)
        body = create_kwargs["json"]
        self.assertEqual(body["deployment"]["external"]["imagePath"], "larkup/video-worker:latest")
        self.assertEqual(body["billing"]["gpu"]["configuration"]["gpuType"], "nvidia-tesla-t4")
        self.assertTrue(body["billing"]["gpu"]["enabled"])
        self.assertEqual(body["runtimeEnvironment"]["LARKUP_VIDEO_JOB_ID"], "job_1")
        self.assertEqual(body["runtimeEnvironment"]["LARKUP_VIDEO_BUCKET"], "my-bucket")

        run_args, run_kwargs = mock_post.call_args_list[1]
        self.assertEqual(
            run_args[0],
            "https://api.northflank.com/v1/projects/default-project/jobs/video-job-1/runs",
        )
        self.assertEqual(run_kwargs["headers"]["Authorization"], "Bearer secret-key")

    @patch("gpu_providers.northflank.requests.post")
    def test_launch_raises_on_create_job_api_error(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _mock_response(400, {"error": "invalid gpuType"})

        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        with self.assertRaises(GPUProviderError):
            provider.launch(
                job_id="job-1",
                image="larkup/video-worker:latest",
                env={},
                gpu_type="not-a-real-gpu",
            )

    @patch("gpu_providers.northflank.requests.post")
    def test_launch_raises_on_run_job_api_error(self, mock_post: MagicMock) -> None:
        mock_post.side_effect = [
            _mock_response(200, {"data": {"id": "video-job-1"}}),
            _mock_response(500, {"error": "server error"}),
        ]

        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        with self.assertRaises(GPUProviderError):
            provider.launch(
                job_id="job-1", image="larkup/video-worker:latest", env={}, gpu_type="nvidia-tesla-t4"
            )


class NorthflankProviderGetStatusTests(unittest.TestCase):
    @patch("gpu_providers.northflank.requests.get")
    def test_get_status_maps_running(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _mock_response(
            200,
            {
                "data": {
                    "status": "RUNNING",
                    "concluded": False,
                    "startedAt": "2020-12-08T11:47:08Z",
                }
            },
        )
        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        status = provider.get_status("video-job-1:run-1")
        self.assertEqual(status.state, InstanceState.RUNNING)

        get_args, get_kwargs = mock_get.call_args
        self.assertEqual(
            get_args[0],
            "https://api.northflank.com/v1/projects/default-project/jobs/video-job-1/runs/run-1",
        )
        self.assertEqual(get_kwargs["headers"]["Authorization"], "Bearer secret-key")

    @patch("gpu_providers.northflank.requests.get")
    def test_get_status_maps_pending_before_start(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _mock_response(
            200, {"data": {"status": "RUNNING", "concluded": False, "startedAt": ""}}
        )
        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        status = provider.get_status("video-job-1:run-1")
        self.assertEqual(status.state, InstanceState.PENDING)

    @patch("gpu_providers.northflank.requests.get")
    def test_get_status_maps_succeeded_to_exited(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _mock_response(
            200, {"data": {"status": "SUCCESS", "concluded": True}}
        )
        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        status = provider.get_status("video-job-1:run-1")
        self.assertEqual(status.state, InstanceState.EXITED)

    @patch("gpu_providers.northflank.requests.get")
    def test_get_status_maps_failed(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _mock_response(
            200, {"data": {"status": "FAILED", "concluded": True}}
        )
        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        status = provider.get_status("video-job-1:run-1")
        self.assertEqual(status.state, InstanceState.FAILED)

    @patch("gpu_providers.northflank.requests.get")
    def test_get_status_maps_unrecognized_status_to_unknown(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _mock_response(200, {"data": {"status": "QUEUED"}})
        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        status = provider.get_status("video-job-1:run-1")
        self.assertEqual(status.state, InstanceState.UNKNOWN)
        self.assertEqual(status.detail, "QUEUED")

    def test_get_status_raises_on_malformed_instance_id(self) -> None:
        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        with self.assertRaises(GPUProviderError):
            provider.get_status("no-colon-here")


class NorthflankProviderTerminateTests(unittest.TestCase):
    @patch("gpu_providers.northflank.requests.delete")
    def test_terminate_succeeds(self, mock_delete: MagicMock) -> None:
        mock_delete.return_value = _mock_response(200, {"data": {}})
        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        provider.terminate("video-job-1:run-1")
        mock_delete.assert_called_once_with(
            "https://api.northflank.com/v1/projects/default-project/jobs/video-job-1",
            headers={
                "Authorization": "Bearer secret-key",
                "Content-Type": "application/json",
            },
            timeout=20,
        )

    @patch("gpu_providers.northflank.requests.delete")
    def test_terminate_is_noop_when_job_already_gone(self, mock_delete: MagicMock) -> None:
        mock_delete.return_value = _mock_response(404, {"error": "not found"})
        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        provider.terminate("video-job-1:run-1")

    @patch("gpu_providers.northflank.requests.delete")
    def test_terminate_raises_on_other_api_error(self, mock_delete: MagicMock) -> None:
        mock_delete.return_value = _mock_response(500, {"error": "server error"})
        provider = NorthflankProvider(api_key="secret-key", project_id="default-project")
        with self.assertRaises(GPUProviderError):
            provider.terminate("video-job-1:run-1")


if __name__ == "__main__":
    unittest.main()
