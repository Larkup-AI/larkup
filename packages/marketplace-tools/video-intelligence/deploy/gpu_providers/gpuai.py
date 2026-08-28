"""gpu.ai (https://gpu.ai) is a GPU instance/VM rental marketplace with SSH
access, similar in shape to Vast.ai (see the public OpenAPI spec at
github.com/gpuai-dev/openapi, served live at https://api.gpu.ai/v1/openapi.json).
`POST /instances` only accepts a closed `environment` vocabulary
(`certified[:framework[@version]]`, `raw_vm[:os]`, `provider_template`) or a
curated `template_id` (e.g. comfyui, vllm) whose backing container image and
start command are deliberately excluded from the API ("TMPL-13
defense-by-omission" per the spec) -- there is no field to point at an
arbitrary image, and `raw_vm` has no cloud-init/user-data/startup-script field
to bootstrap unattended. So `launch` cannot start our worker image and raises
`GPUProviderError` instead. `get_status`/`terminate` are implemented for real
against the generic instance-lifecycle endpoints, which work for any instance
regardless of how it was created.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import ClassVar

import requests

from .base import (
    DEFAULT_TIMEOUT_SECS,
    GPUInstanceProvider,
    GPUProviderError,
    InstanceState,
    InstanceStatus,
    raise_for_response,
)

API_BASE = "https://api.gpu.ai/v1"

# gpu.ai's `Instance.status` (GET /instances/{id}), mapped to our coarse states.
_STATUS_MAP: dict[str, InstanceState] = {
    "allocating": InstanceState.PENDING,
    "starting": InstanceState.PENDING,
    "running": InstanceState.RUNNING,
    "stopping": InstanceState.RUNNING,
    "stopped": InstanceState.EXITED,
    "terminated": InstanceState.EXITED,
    "error": InstanceState.FAILED,
}


@dataclass(frozen=True)
class GpuAiProvider(GPUInstanceProvider):
    name: ClassVar[str] = "gpuai"

    api_key: str
    base_url: str = API_BASE

    @classmethod
    def from_env(cls) -> "GpuAiProvider":
        api_key = os.getenv("GPUAI_API_KEY")
        if not api_key:
            raise GPUProviderError("GPUAI_API_KEY is not set")
        return cls(api_key=api_key)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        raise GPUProviderError(
            "gpuai cannot run an arbitrary Docker image: POST /instances only "
            "accepts a closed `environment` vocabulary (certified[:framework"
            "[@version]], raw_vm[:os], provider_template) or a curated "
            "`template_id` (e.g. comfyui, vllm) whose container image and start "
            "command are not exposed by the API, and `raw_vm` has no cloud-init/"
            "user-data/startup-script field to bootstrap unattended. There is no "
            f"way to launch {image!r} for job {job_id!r} through this API."
        )

    def get_status(self, instance_id: str) -> InstanceStatus:
        response = requests.get(
            f"{self.base_url}/instances/{instance_id}",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(response, self.name)
        raw_status = response.json().get("status")
        state = _STATUS_MAP.get(raw_status, InstanceState.UNKNOWN)
        return InstanceStatus(state=state, detail=raw_status)

    def terminate(self, instance_id: str) -> None:
        response = requests.delete(
            f"{self.base_url}/instances/{instance_id}",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        if response.status_code == 404:
            return  # already gone -- gpu.ai documents DELETE as idempotent
        raise_for_response(response, self.name)
