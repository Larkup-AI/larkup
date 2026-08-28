from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from gpu_providers.base import GPUProviderError, InstanceState
from gpu_providers.hyperstack import API_BASE, HyperstackProvider


def _response(*, ok: bool = True, status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    response = MagicMock()
    response.ok = ok
    response.status_code = status_code
    response.json.return_value = json_data or {}
    response.text = text
    return response


class HyperstackFromEnvTests(unittest.TestCase):
    def test_raises_when_api_key_missing(self) -> None:
        env = {
            "HYPERSTACK_ENVIRONMENT_NAME": "prod",
            "HYPERSTACK_KEY_NAME": "prod-key",
        }
        with patch.dict("os.environ", env, clear=True):
            with self.assertRaises(GPUProviderError):
                HyperstackProvider.from_env()

    def test_raises_when_environment_name_missing(self) -> None:
        env = {
            "HYPERSTACK_API_KEY": "test-key",
            "HYPERSTACK_KEY_NAME": "prod-key",
        }
        with patch.dict("os.environ", env, clear=True):
            with self.assertRaises(GPUProviderError):
                HyperstackProvider.from_env()

    def test_raises_when_key_name_missing(self) -> None:
        env = {
            "HYPERSTACK_API_KEY": "test-key",
            "HYPERSTACK_ENVIRONMENT_NAME": "prod",
        }
        with patch.dict("os.environ", env, clear=True):
            with self.assertRaises(GPUProviderError):
                HyperstackProvider.from_env()

    def test_builds_provider_from_env(self) -> None:
        env = {
            "HYPERSTACK_API_KEY": "test-key",
            "HYPERSTACK_ENVIRONMENT_NAME": "prod",
            "HYPERSTACK_KEY_NAME": "prod-key",
        }
        with patch.dict("os.environ", env, clear=True):
            provider = HyperstackProvider.from_env()
        self.assertEqual(provider.api_key, "test-key")
        self.assertEqual(provider.environment_name, "prod")
        self.assertEqual(provider.key_name, "prod-key")


class HyperstackLaunchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = HyperstackProvider(
            api_key="test-key", environment_name="prod-env", key_name="prod-key"
        )

    @patch("gpu_providers.hyperstack.requests.post")
    def test_launch_success(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(
            json_data={"status": True, "instances": [{"id": 7613, "status": "CREATING"}]}
        )

        instance_id = self.provider.launch(
            job_id="job-123",
            image="ghcr.io/larkup/video-worker:latest",
            env={"LARKUP_VIDEO_JOB_ID": "job-123", "LARKUP_VIDEO_BUCKET": "my bucket"},
            gpu_type="n3-RTX-A6000x1",
        )

        self.assertEqual(instance_id, "7613")
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], API_BASE)
        self.assertEqual(kwargs["headers"]["api_key"], "test-key")
        self.assertEqual(kwargs["timeout"], 20)

        payload = kwargs["json"]
        self.assertEqual(payload["environment_name"], "prod-env")
        self.assertEqual(payload["key_name"], "prod-key")
        self.assertEqual(payload["flavor_name"], "n3-RTX-A6000x1")
        self.assertEqual(payload["count"], 1)
        self.assertIn("job-123", payload["name"])

        user_data = payload["user_data"]
        self.assertTrue(user_data.startswith("#!/bin/bash"))
        self.assertIn("docker run", user_data)
        self.assertIn("ghcr.io/larkup/video-worker:latest", user_data)
        self.assertIn("-e LARKUP_VIDEO_JOB_ID=job-123", user_data)
        self.assertIn("LARKUP_VIDEO_BUCKET='my bucket'", user_data)

    @patch("gpu_providers.hyperstack.requests.post")
    def test_launch_raises_on_api_failure(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _response(
            ok=False, status_code=400, text="invalid flavor_name"
        )

        with self.assertRaises(GPUProviderError):
            self.provider.launch(
                job_id="job-123",
                image="ghcr.io/larkup/video-worker:latest",
                env={},
                gpu_type="not-a-real-flavor",
            )


class HyperstackGetStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = HyperstackProvider(
            api_key="test-key", environment_name="prod-env", key_name="prod-key"
        )

    @patch("gpu_providers.hyperstack.requests.get")
    def test_get_status_running(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(
            json_data={
                "status": True,
                "instance": {"id": 7613, "status": "ACTIVE", "power_state": "RUNNING"},
            }
        )

        status = self.provider.get_status("7613")

        self.assertEqual(status.state, InstanceState.RUNNING)
        self.assertIn("ACTIVE", status.detail or "")
        args, kwargs = mock_get.call_args
        self.assertEqual(args[0], f"{API_BASE}/7613")
        self.assertEqual(kwargs["headers"]["api_key"], "test-key")

    @patch("gpu_providers.hyperstack.requests.get")
    def test_get_status_stopped(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(
            json_data={
                "status": True,
                "instance": {"id": 7613, "status": "SHUTOFF", "power_state": None},
            }
        )

        status = self.provider.get_status("7613")

        self.assertEqual(status.state, InstanceState.EXITED)

    @patch("gpu_providers.hyperstack.requests.get")
    def test_get_status_unknown_falls_back(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _response(
            json_data={
                "status": True,
                "instance": {"id": 7613, "status": "SOME_NEW_STATE", "power_state": None},
            }
        )

        status = self.provider.get_status("7613")

        self.assertEqual(status.state, InstanceState.UNKNOWN)
        self.assertIn("SOME_NEW_STATE", status.detail or "")


class HyperstackTerminateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = HyperstackProvider(
            api_key="test-key", environment_name="prod-env", key_name="prod-key"
        )

    @patch("gpu_providers.hyperstack.requests.delete")
    def test_terminate_success(self, mock_delete: MagicMock) -> None:
        mock_delete.return_value = _response(
            json_data={"status": True, "message": "Instance is being deleted."}
        )

        self.provider.terminate("7613")

        args, kwargs = mock_delete.call_args
        self.assertEqual(args[0], f"{API_BASE}/7613")

    @patch("gpu_providers.hyperstack.requests.delete")
    def test_terminate_already_gone_is_a_no_op(self, mock_delete: MagicMock) -> None:
        mock_delete.return_value = _response(
            ok=False, status_code=404, text="Not Found"
        )

        self.provider.terminate("does-not-exist")

    @patch("gpu_providers.hyperstack.requests.delete")
    def test_terminate_raises_on_other_failures(self, mock_delete: MagicMock) -> None:
        mock_delete.return_value = _response(
            ok=False, status_code=500, text="internal error"
        )

        with self.assertRaises(GPUProviderError):
            self.provider.terminate("7613")


if __name__ == "__main__":
    unittest.main()
