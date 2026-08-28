from __future__ import annotations

from .base import GPUInstanceProvider, GPUProviderError
from .gpuai import GpuAiProvider
from .hyperstack import HyperstackProvider
from .modal_provider import ModalProvider
from .northflank import NorthflankProvider
from .runpod import RunpodProvider
from .salad import SaladProvider
from .scaleway import ScalewayProvider
from .shadeform import ShadeformProvider
from .thundercompute import ThunderComputeProvider
from .vast import VastAiProvider

_PROVIDERS: dict[str, type[GPUInstanceProvider]] = {
    ShadeformProvider.name: ShadeformProvider,
    VastAiProvider.name: VastAiProvider,
    SaladProvider.name: SaladProvider,
    ScalewayProvider.name: ScalewayProvider,
    ThunderComputeProvider.name: ThunderComputeProvider,
    GpuAiProvider.name: GpuAiProvider,
    NorthflankProvider.name: NorthflankProvider,
    HyperstackProvider.name: HyperstackProvider,
    RunpodProvider.name: RunpodProvider,
    ModalProvider.name: ModalProvider,
}

# Modal is the default managed-cloud dispatch target; RunPod remains fully
# supported and selectable via LARKUP_VIDEO_GPU_PROVIDER=runpod.
DEFAULT_PROVIDER = "modal"


def available_providers() -> tuple[str, ...]:
    return tuple(sorted(_PROVIDERS))


def get_provider(name: str) -> GPUInstanceProvider:
    """Build the named provider's client from environment credentials.

    `name` matches a provider's `.name` (e.g. "vast", "shadeform"); this is
    the single switch point a caller uses to pick a GPU vendor without
    hardcoding any provider's API shape.
    """
    try:
        provider_cls = _PROVIDERS[name]
    except KeyError as error:
        raise GPUProviderError(
            f"unknown GPU provider {name!r}; expected one of {available_providers()}"
        ) from error
    return provider_cls.from_env()
