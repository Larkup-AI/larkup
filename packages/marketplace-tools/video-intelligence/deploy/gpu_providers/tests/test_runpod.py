from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from gpu_providers.base import GPUProviderError, InstanceState
from gpu_providers.runpod import RunpodProvider


def _response(*, ok: bool = True, status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    response = MagicMock()
    response.ok = ok
    response.status_code = status_code
    response.json.return_value = json_data or {}
    response.text = text
    return response


class RunpodProviderTests(unittest.TestCase):
    def test_from_env_requires_both_credentials(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(GPUProviderError):
                RunpodProvider.from_env()
        with patch.dict("os.environ", {"RUNPOD_API_KEY": "k"}, clear=True):
            with self.assertRaises(GPUProviderError):
                RunpodProvider.from_env()

    def test_launch_submits_env_as_input_payload_and_returns_job_id(self) -> None:
        provider = RunpodProvider(api_key="k", endpoint_id="ep")
        with patch("gpu_providers.runpod.requests.post", return_value=_response(json_data={"id": "job-1"})) as post:
            instance_id = provider.launch(
                job_id="job_x", image="ignored", env={"sourceUrl": "https://x", "brief": {"goal": "g"}}, gpu_type="ignored"
            )
        self.assertEqual(instance_id, "job-1")
        self.assertEqual(post.call_args.kwargs["json"], {"input": {"sourceUrl": "https://x", "brief": {"goal": "g"}}})
        self.assertIn("/run", post.call_args.args[0])

    def test_launch_without_a_job_id_raises(self) -> None:
        provider = RunpodProvider(api_key="k", endpoint_id="ep")
        with patch("gpu_providers.runpod.requests.post", return_value=_response(json_data={})):
            with self.assertRaises(GPUProviderError):
                provider.launch(job_id="job_x", image="", env={}, gpu_type="")

    def test_get_status_maps_runpod_states(self) -> None:
        provider = RunpodProvider(api_key="k", endpoint_id="ep")
        cases = {
            "IN_QUEUE": InstanceState.PENDING,
            "IN_PROGRESS": InstanceState.RUNNING,
            "CANCELLED": InstanceState.EXITED,
            "FAILED": InstanceState.FAILED,
            "TIMED_OUT": InstanceState.FAILED,
            "SOMETHING_NEW": InstanceState.UNKNOWN,
        }
        for raw, expected in cases.items():
            with patch("gpu_providers.runpod.requests.get", return_value=_response(json_data={"status": raw})):
                self.assertEqual(provider.get_status("id").state, expected, raw)

    def test_completed_status_without_output_counts_as_failed(self) -> None:
        provider = RunpodProvider(api_key="k", endpoint_id="ep")
        with patch("gpu_providers.runpod.requests.get", return_value=_response(json_data={"status": "COMPLETED"})):
            self.assertEqual(provider.get_status("id").state, InstanceState.FAILED)

    def test_failed_status_keeps_the_actionable_worker_message(self) -> None:
        provider = RunpodProvider(api_key="k", endpoint_id="ep")
        with patch(
            "gpu_providers.runpod.requests.get",
            return_value=_response(
                json_data={
                    "status": "FAILED",
                    "error": '{"error_message":"the uploaded file does not contain a video stream", "error_traceback":"private trace"}',
                }
            ),
        ):
            status = provider.get_status("id")
        self.assertEqual(status.state, InstanceState.FAILED)
        self.assertEqual(status.detail, "the uploaded file does not contain a video stream")

    def test_get_result_only_returns_a_dict_when_completed_with_a_result(self) -> None:
        provider = RunpodProvider(api_key="k", endpoint_id="ep")
        with patch(
            "gpu_providers.runpod.requests.get",
            return_value=_response(json_data={"status": "COMPLETED", "output": {"result": {"durationMs": 1}, "actualSourceMinutes": 0.2}}),
        ):
            output = provider.get_result("id")
        self.assertEqual(output["result"], {"durationMs": 1})
        with patch("gpu_providers.runpod.requests.get", return_value=_response(json_data={"status": "IN_PROGRESS"})):
            self.assertIsNone(provider.get_result("id"))

    def test_get_progress_only_returns_well_formed_stages(self) -> None:
        provider = RunpodProvider(api_key="k", endpoint_id="ep")
        with patch(
            "gpu_providers.runpod.requests.get",
            return_value=_response(json_data={"status": "IN_PROGRESS", "output": {"stage": "transcribe", "percent": 40, "message": "ok"}}),
        ):
            self.assertEqual(provider.get_progress("id"), {"stage": "transcribe", "percent": 40, "message": "ok"})
        # Malformed/unknown stage must not be relayed as if it were real progress.
        with patch(
            "gpu_providers.runpod.requests.get",
            return_value=_response(json_data={"status": "IN_PROGRESS", "output": {"stage": "not-a-stage", "percent": 40, "message": "ok"}}),
        ):
            self.assertIsNone(provider.get_progress("id"))

    def test_terminate_tolerates_already_gone_instance(self) -> None:
        provider = RunpodProvider(api_key="k", endpoint_id="ep")
        with patch("gpu_providers.runpod.requests.post", return_value=_response(ok=False, status_code=404)):
            provider.terminate("id")  # must not raise

    def test_terminate_raises_on_real_failure(self) -> None:
        provider = RunpodProvider(api_key="k", endpoint_id="ep")
        with patch("gpu_providers.runpod.requests.post", return_value=_response(ok=False, status_code=500, text="boom")):
            with self.assertRaises(GPUProviderError):
                provider.terminate("id")


if __name__ == "__main__":
    unittest.main()
