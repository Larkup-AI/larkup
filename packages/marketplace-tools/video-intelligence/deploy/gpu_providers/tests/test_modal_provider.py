from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from gpu_providers.base import GPUProviderError, InstanceState
from gpu_providers.modal_provider import ModalProvider


class ModalProviderTests(unittest.TestCase):
    def test_from_env_requires_both_credentials(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(GPUProviderError):
                ModalProvider.from_env()
        with patch.dict("os.environ", {"MODAL_TOKEN_ID": "id"}, clear=True):
            with self.assertRaises(GPUProviderError):
                ModalProvider.from_env()

    def test_from_env_accepts_either_key_env_var_name(self) -> None:
        with patch.dict("os.environ", {"MODAL_TOKEN_ID": "id", "MODAL_API_KEY": "secret"}, clear=True):
            provider = ModalProvider.from_env()
        self.assertEqual((provider.token_id, provider.token_secret), ("id", "secret"))
        with patch.dict("os.environ", {"MODAL_TOKEN_ID": "id", "MODAL_TOKEN_SECRET": "secret2"}, clear=True):
            provider = ModalProvider.from_env()
        self.assertEqual(provider.token_secret, "secret2")

    def test_launch_spawns_the_named_function_with_env_as_payload(self) -> None:
        provider = ModalProvider(token_id="id", token_secret="s")
        fake_call = MagicMock(object_id="call-1")
        fake_function = MagicMock()
        fake_function.spawn.return_value = fake_call
        fake_modal = MagicMock()
        fake_modal.Function.from_name.return_value = fake_function
        with patch.object(provider, "_sdk", return_value=fake_modal):
            instance_id = provider.launch(
                job_id="job_x", image="ignored", env={"sourceUrl": "https://x"}, gpu_type="ignored"
            )
        self.assertEqual(instance_id, "call-1")
        fake_modal.Function.from_name.assert_called_with(provider.app_name, provider.function_name)
        fake_function.spawn.assert_called_with({"sourceUrl": "https://x"})

    def test_get_status_running_while_result_not_ready(self) -> None:
        provider = ModalProvider(token_id="id", token_secret="s")
        fake_call = MagicMock()
        fake_call.get.side_effect = TimeoutError()
        with patch.object(provider, "_function_call", return_value=fake_call):
            status = provider.get_status("call-1")
        self.assertEqual(status.state, InstanceState.RUNNING)

    def test_get_status_exited_once_the_call_completes(self) -> None:
        provider = ModalProvider(token_id="id", token_secret="s")
        fake_call = MagicMock()
        fake_call.get.return_value = {"result": {}}
        with patch.object(provider, "_function_call", return_value=fake_call):
            status = provider.get_status("call-1")
        self.assertEqual(status.state, InstanceState.EXITED)

    def test_get_status_failed_when_the_call_raises_a_real_error(self) -> None:
        provider = ModalProvider(token_id="id", token_secret="s")
        fake_call = MagicMock()
        fake_call.get.side_effect = RuntimeError("worker crashed")
        with patch.object(provider, "_function_call", return_value=fake_call):
            status = provider.get_status("call-1")
        self.assertEqual(status.state, InstanceState.FAILED)
        self.assertIn("worker crashed", status.detail or "")

    def test_get_result_returns_none_while_still_running(self) -> None:
        provider = ModalProvider(token_id="id", token_secret="s")
        fake_call = MagicMock()
        fake_call.get.side_effect = TimeoutError()
        with patch.object(provider, "_function_call", return_value=fake_call):
            self.assertIsNone(provider.get_result("call-1"))

    def test_get_result_returns_the_worker_payload_once_ready(self) -> None:
        provider = ModalProvider(token_id="id", token_secret="s")
        fake_call = MagicMock()
        fake_call.get.return_value = {"result": {"durationMs": 5}, "actualSourceMinutes": 0.1}
        with patch.object(provider, "_function_call", return_value=fake_call):
            output = provider.get_result("call-1")
        self.assertEqual(output["result"], {"durationMs": 5})

    def test_get_progress_is_not_yet_supported(self) -> None:
        provider = ModalProvider(token_id="id", token_secret="s")
        self.assertIsNone(provider.get_progress("call-1"))

    def test_terminate_cancels_the_call(self) -> None:
        provider = ModalProvider(token_id="id", token_secret="s")
        fake_call = MagicMock()
        with patch.object(provider, "_function_call", return_value=fake_call):
            provider.terminate("call-1")
        fake_call.cancel.assert_called_once()

    def test_terminate_wraps_failures_as_provider_error(self) -> None:
        provider = ModalProvider(token_id="id", token_secret="s")
        fake_call = MagicMock()
        fake_call.cancel.side_effect = RuntimeError("gone")
        with patch.object(provider, "_function_call", return_value=fake_call):
            with self.assertRaises(GPUProviderError):
                provider.terminate("call-1")


if __name__ == "__main__":
    unittest.main()
