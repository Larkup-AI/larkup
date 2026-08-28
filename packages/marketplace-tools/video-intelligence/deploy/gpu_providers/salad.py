"""Salad (SaladCloud) GPU instance provider.

SaladCloud is a consumer-GPU cloud built from idle gaming/workstation nodes,
rented through "container groups": an image plus a replica count and
resource requirements that SaladCloud schedules directly onto a matching
node -- no cloud-init or VM boot step needed. GPU SKUs are opaque class
UUIDs (no friendly-name filter exists in the create API), fetched from the
Organization Data API's `/gpu-classes` list -- real examples seen in
SaladCloud's docs: "ed563892-aacd-40f5-80b7-90c9be6c759b" (RTX 4090, 24 GB),
"951131f6-5acf-489c-b303-0906be8b26ef" (RTX 3070, 8 GB), and
"3eae6ce4-aa14-4c7d-b502-131730c9af48" (RTX 2060, 6 GB). `gpu_type` for this
provider must be one of these UUIDs.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, ClassVar

import requests

from .base import (
    DEFAULT_TIMEOUT_SECS,
    GPUInstanceProvider,
    GPUProviderError,
    InstanceState,
    InstanceStatus,
    raise_for_response,
)

API_BASE_URL = "https://api.salad.com/api/public"

# SaladCloud has no documented default project name; this is ours, and the
# project must already exist under the organization before `launch` is called.
DEFAULT_PROJECT_NAME = "larkup-video"

# Not specified by the 3-call interface (no cpu/memory params on `launch`),
# and not from SaladCloud docs -- picked as a reasonable fixed footprint for
# a single video-indexing worker.
DEFAULT_CPU_CORES = 4
DEFAULT_MEMORY_MB = 16384

_STATUS_MAP: dict[str, InstanceState] = {
    "pending": InstanceState.PENDING,
    "deploying": InstanceState.PENDING,
    "running": InstanceState.RUNNING,
    "succeeded": InstanceState.EXITED,
    "stopped": InstanceState.EXITED,
    "failed": InstanceState.FAILED,
}


def _container_group_name(job_id: str) -> str:
    """Derive a DNS-safe SaladCloud container group name from a job id.

    Container groups are addressed by name, not a separate opaque id, so
    this name is also the `instance_id` `launch` returns for later
    `get_status`/`terminate` calls. SaladCloud names must be lowercase
    alphanumeric with hyphens.
    """
    slug = re.sub(r"[^a-z0-9-]+", "-", job_id.lower()).strip("-")
    return f"larkup-{slug}"[:63] if slug else "larkup-job"


@dataclass(frozen=True)
class SaladProvider(GPUInstanceProvider):
    name: ClassVar[str] = "salad"

    api_key: str
    organization_name: str
    project_name: str

    @classmethod
    def from_env(cls) -> "SaladProvider":
        api_key = os.getenv("SALAD_API_KEY")
        if not api_key:
            raise GPUProviderError("SALAD_API_KEY is not set")
        organization_name = os.getenv("SALAD_ORGANIZATION_NAME")
        if not organization_name:
            raise GPUProviderError(
                "SALAD_ORGANIZATION_NAME is not set (SaladCloud API paths are "
                "scoped by organization name; there is no sane default)"
            )
        project_name = os.getenv("SALAD_PROJECT_NAME", DEFAULT_PROJECT_NAME)
        return cls(
            api_key=api_key,
            organization_name=organization_name,
            project_name=project_name,
        )

    def _headers(self) -> dict[str, str]:
        return {
            "Salad-Api-Key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _container_group_url(self, container_group_name: str | None = None) -> str:
        parts = [
            API_BASE_URL,
            "organizations",
            self.organization_name,
            "projects",
            self.project_name,
            "containers",
        ]
        if container_group_name:
            parts.append(container_group_name)
        return "/".join(parts)

    def _request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        try:
            return requests.request(
                method, url, headers=self._headers(), timeout=DEFAULT_TIMEOUT_SECS, **kwargs
            )
        except requests.RequestException as error:
            raise GPUProviderError(f"{self.name} API request failed: {error}") from error

    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        del region  # SaladCloud schedules by country_codes, not a region id; not exposed here.
        group_name = _container_group_name(job_id)
        body = {
            "name": group_name,
            "container": {
                "image": image,
                "environment_variables": env,
                "resources": {
                    "cpu": DEFAULT_CPU_CORES,
                    "memory": DEFAULT_MEMORY_MB,
                    "gpu_classes": [gpu_type],
                },
            },
            "replicas": 1,
            # A worker runs one job to completion and exits; SaladCloud must
            # not restart it into re-running the job it just finished.
            "restart_policy": "never",
            "autostart_policy": True,
        }
        response = self._request("POST", self._container_group_url(), json=body)
        raise_for_response(response, self.name)
        return group_name

    def get_status(self, instance_id: str) -> InstanceStatus:
        response = self._request("GET", self._container_group_url(instance_id))
        raise_for_response(response, self.name)
        try:
            payload = response.json()
        except ValueError as error:
            raise GPUProviderError(f"{self.name} returned a non-JSON status response: {error}") from error
        raw_status = str((payload.get("current_state") or {}).get("status") or "").strip().lower()
        state = _STATUS_MAP.get(raw_status, InstanceState.UNKNOWN)
        return InstanceStatus(state=state, detail=raw_status or None)

    def terminate(self, instance_id: str) -> None:
        response = self._request("DELETE", self._container_group_url(instance_id))
        if response.status_code == 404:
            return
        raise_for_response(response, self.name)
