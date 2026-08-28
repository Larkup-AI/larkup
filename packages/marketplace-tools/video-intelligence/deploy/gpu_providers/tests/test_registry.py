from __future__ import annotations

import unittest
from unittest.mock import patch

from gpu_providers.base import GPUProviderError
from gpu_providers.gpuai import GpuAiProvider
from gpu_providers.hyperstack import HyperstackProvider
from gpu_providers.modal_provider import ModalProvider
from gpu_providers.northflank import NorthflankProvider
from gpu_providers.registry import DEFAULT_PROVIDER, available_providers, get_provider
from gpu_providers.runpod import RunpodProvider
from gpu_providers.salad import SaladProvider
from gpu_providers.scaleway import ScalewayProvider
from gpu_providers.shadeform import ShadeformProvider
from gpu_providers.thundercompute import ThunderComputeProvider
from gpu_providers.vast import VastAiProvider

_ENV_BY_PROVIDER = {
    "shadeform": {"SHADE_FORM_API_KEY": "k"},
    "vast": {"VAST_API_KEY": "k"},
    "salad": {"SALAD_API_KEY": "k", "SALAD_ORGANIZATION_NAME": "org"},
    "scaleway": {
        "SCALEAWAY_API_KEY": "k",
        "SCALEAWAY_PROJECT_ID": "p",
        "SCALEAWAY_GPU_IMAGE_ID": "i",
    },
    "thundercompute": {"THUNDERCOMPUTE_API_KEY": "k"},
    "gpuai": {"GPUAI_API_KEY": "k"},
    "northflank": {"NORTHFLANK_API_KEY": "k", "NORTHFLANK_PROJECT_ID": "p"},
    "hyperstack": {
        "HYPERSTACK_API_KEY": "k",
        "HYPERSTACK_ENVIRONMENT_NAME": "env",
        "HYPERSTACK_KEY_NAME": "key",
    },
    "runpod": {"RUNPOD_API_KEY": "k", "RUNPOD_ENDPOINT_ID": "ep"},
    "modal": {"MODAL_TOKEN_ID": "id", "MODAL_API_KEY": "secret"},
}

_CLASS_BY_PROVIDER = {
    "shadeform": ShadeformProvider,
    "vast": VastAiProvider,
    "salad": SaladProvider,
    "scaleway": ScalewayProvider,
    "thundercompute": ThunderComputeProvider,
    "gpuai": GpuAiProvider,
    "northflank": NorthflankProvider,
    "hyperstack": HyperstackProvider,
    "runpod": RunpodProvider,
    "modal": ModalProvider,
}


class RegistryTests(unittest.TestCase):
    def test_available_providers_lists_every_provider_by_name(self) -> None:
        self.assertEqual(available_providers(), tuple(sorted(_CLASS_BY_PROVIDER)))

    def test_default_provider_is_modal(self) -> None:
        self.assertEqual(DEFAULT_PROVIDER, "modal")

    def test_get_provider_rejects_an_unknown_name(self) -> None:
        with self.assertRaises(GPUProviderError):
            get_provider("does-not-exist")

    def test_get_provider_builds_the_right_class_from_env(self) -> None:
        for name, env in _ENV_BY_PROVIDER.items():
            with self.subTest(provider=name), patch.dict("os.environ", env, clear=True):
                provider = get_provider(name)
                self.assertIsInstance(provider, _CLASS_BY_PROVIDER[name])
                self.assertEqual(provider.name, name)

    def test_get_provider_surfaces_missing_credentials(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(GPUProviderError):
                get_provider("vast")


if __name__ == "__main__":
    unittest.main()
