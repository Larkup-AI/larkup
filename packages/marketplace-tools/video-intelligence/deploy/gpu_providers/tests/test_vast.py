from __future__ import annotations

import json
import os
import unittest
from typing import Any
from unittest.mock import MagicMock, patch

from gpu_providers.base import GPUProviderError, InstanceState
from gpu_providers.vast import VastAiProvider


def _mock_response(status_code: int, json_body: dict[str, Any]) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.ok = 200 <= status_code < 400
    response.json.return_value = json_body
    response.text = json.dumps(json_body)
    return response


class VastAiProviderFromEnvTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    def test_from_env_raises_when_api_key_missing(self) -> None:
        with self.assertRaises(GPUProviderError):
            VastAiProvider.from_env()

    @patch.dict(os.environ, {"VAST_API_KEY": "test-key-123"}, clear=True)
    def test_from_env_reads_api_key_from_environment(self) -> None:
        provider = VastAiProvider.from_env()
        self.assertEqual(provider.api_key, "test-key-123")


class VastAiProviderLaunchTests(unittest.TestCase):
    @patch("gpu_providers.vast.requests.put")
    @patch("gpu_providers.vast.requests.post")
    def test_launch_rents_cheapest_matching_offer(
        self, mock_post: MagicMock, mock_put: MagicMock
    ) -> None:
        mock_post.return_value = _mock_response(
            200,
            {
                "offers": [
                    {"id": 111, "dph_total": 0.50, "gpu_name": "RTX_4090"},
                    {"id": 222, "dph_total": 0.30, "gpu_name": "RTX_4090"},
                ]
            },
        )
        mock_put.return_value = _mock_response(
            200, {"success": True, "new_contract": 999}
        )

        provider = VastAiProvider(api_key="secret-key")
        instance_id = provider.launch(
            job_id="job-1",
            image="larkup/video-worker:latest",
            env={"LARKUP_VIDEO_JOB_ID": "job-1", "LARKUP_VIDEO_BUCKET": "my-bucket"},
            gpu_type="RTX_4090",
            region="US",
        )

        self.assertEqual(instance_id, "999")

        search_args, search_kwargs = mock_post.call_args
        self.assertEqual(search_args[0], "https://console.vast.ai/api/v0/bundles/")
        self.assertEqual(
            search_kwargs["headers"]["Authorization"], "Bearer secret-key"
        )
        self.assertEqual(search_kwargs["json"]["gpu_name"], {"eq": "RTX_4090"})
        self.assertEqual(search_kwargs["json"]["geolocation"], {"eq": "US"})
        self.assertEqual(search_kwargs["timeout"], 20)

        rent_args, rent_kwargs = mock_put.call_args
        self.assertEqual(rent_args[0], "https://console.vast.ai/api/v0/asks/222/")
        self.assertEqual(rent_kwargs["headers"]["Authorization"], "Bearer secret-key")
        self.assertEqual(rent_kwargs["json"]["image"], "larkup/video-worker:latest")
        self.assertIn("-e LARKUP_VIDEO_JOB_ID=job-1", rent_kwargs["json"]["env"])
        self.assertIn("-e LARKUP_VIDEO_BUCKET=my-bucket", rent_kwargs["json"]["env"])

    @patch("gpu_providers.vast.requests.post")
    def test_launch_raises_when_no_offer_matches(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _mock_response(200, {"offers": []})

        provider = VastAiProvider(api_key="secret-key")
        with self.assertRaises(GPUProviderError):
            provider.launch(
                job_id="job-1",
                image="larkup/video-worker:latest",
                env={},
                gpu_type="H100_SXM",
            )

    @patch("gpu_providers.vast.requests.post")
    def test_launch_raises_on_search_api_error(self, mock_post: MagicMock) -> None:
        mock_post.return_value = _mock_response(500, {"detail": "server error"})

        provider = VastAiProvider(api_key="secret-key")
        with self.assertRaises(GPUProviderError):
            provider.launch(
                job_id="job-1", image="larkup/video-worker:latest", env={}, gpu_type="RTX_4090"
            )


class VastAiProviderGetStatusTests(unittest.TestCase):
    @patch("gpu_providers.vast.requests.get")
    def test_get_status_maps_running(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _mock_response(
            200, {"instances": {"actual_status": "running"}}
        )
        provider = VastAiProvider(api_key="secret-key")
        status = provider.get_status("999")
        self.assertEqual(status.state, InstanceState.RUNNING)

    @patch("gpu_providers.vast.requests.get")
    def test_get_status_maps_exited(self, mock_get: MagicMock) -> None:
        mock_get.return_value = _mock_response(
            200, {"instances": {"actual_status": "exited"}}
        )
        provider = VastAiProvider(api_key="secret-key")
        status = provider.get_status("999")
        self.assertEqual(status.state, InstanceState.EXITED)

    @patch("gpu_providers.vast.requests.get")
    def test_get_status_maps_unrecognized_status_to_unknown(
        self, mock_get: MagicMock
    ) -> None:
        mock_get.return_value = _mock_response(
            200, {"instances": {"actual_status": "offline"}}
        )
        provider = VastAiProvider(api_key="secret-key")
        status = provider.get_status("999")
        self.assertEqual(status.state, InstanceState.UNKNOWN)
        self.assertEqual(status.detail, "offline")


class VastAiProviderTerminateTests(unittest.TestCase):
    @patch("gpu_providers.vast.requests.delete")
    def test_terminate_succeeds(self, mock_delete: MagicMock) -> None:
        mock_delete.return_value = _mock_response(200, {"success": True})
        provider = VastAiProvider(api_key="secret-key")
        provider.terminate("999")
        mock_delete.assert_called_once_with(
            "https://console.vast.ai/api/v0/instances/999/",
            headers={
                "Authorization": "Bearer secret-key",
                "Content-Type": "application/json",
            },
            timeout=20,
        )

    @patch("gpu_providers.vast.requests.delete")
    def test_terminate_is_noop_when_instance_already_gone(
        self, mock_delete: MagicMock
    ) -> None:
        mock_delete.return_value = _mock_response(
            404, {"success": False, "error": "not_found", "msg": "Instance not found"}
        )
        provider = VastAiProvider(api_key="secret-key")
        provider.terminate("999")


if __name__ == "__main__":
    unittest.main()
