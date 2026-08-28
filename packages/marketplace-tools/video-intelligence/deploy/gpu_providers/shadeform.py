"""Client for Shadeform (https://www.shadeform.ai), a multi-cloud GPU broker
that provisions instances across many underlying clouds (AWS, Azure,
Hyperstack, Lambda, and others) behind one API. Instance types are addressed
by Shadeform's own standardized `shade_instance_type` SKU, e.g. "A6000",
"A100_80G", "A100" -- see https://docs.shadeform.ai/api-reference/instances/instances-types.
"""

from __future__ import annotations

import os
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

BASE_URL = "https://api.shadeform.ai/v1"

# https://docs.shadeform.ai/api-reference/instances/instances-info -- exact
# `status` values the API documents. Anything else maps to UNKNOWN below
# rather than being guessed at.
_STATE_BY_STATUS = {
    "creating": InstanceState.PENDING,
    "pending_provider": InstanceState.PENDING,
    "pending": InstanceState.PENDING,
    "active": InstanceState.RUNNING,
    "deleting": InstanceState.EXITED,
    "deleted": InstanceState.EXITED,
    "error": InstanceState.FAILED,
}


@dataclass(frozen=True)
class _CapacityMatch:
    cloud: str
    region: str
    hourly_price: int


class ShadeformProvider(GPUInstanceProvider):
    """Rents instances through Shadeform's marketplace (`shade_cloud=True`).

    `launch` needs an underlying `cloud` (e.g. "hyperstack") that our own
    interface doesn't ask callers for -- only a `gpu_type`
    (`shade_instance_type`) and an optional `region`. So `launch` first
    queries `/instances/types` for available capacity matching those,
    and picks the cheapest match's `cloud`/`region` to create against.
    """

    name: ClassVar[str] = "shadeform"

    def __init__(self, *, api_key: str) -> None:
        self.api_key = api_key

    @classmethod
    def from_env(cls) -> "ShadeformProvider":
        api_key = os.getenv("SHADE_FORM_API_KEY")
        if not api_key:
            raise GPUProviderError(
                "SHADE_FORM_API_KEY is not set; cannot build a Shadeform client"
            )
        return cls(api_key=api_key)

    def _headers(self) -> dict[str, str]:
        return {"X-API-KEY": self.api_key, "Content-Type": "application/json"}

    def _find_capacity(self, *, gpu_type: str, region: str | None) -> _CapacityMatch:
        params: dict[str, str] = {"shade_instance_type": gpu_type, "available": "true"}
        if region:
            params["region"] = region
        response = requests.get(
            f"{BASE_URL}/instances/types",
            params=params,
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(response, self.name)
        body: dict[str, Any] = response.json()
        matches: list[_CapacityMatch] = []
        for instance_type in body.get("instance_types", []):
            cloud = instance_type.get("cloud")
            hourly_price = instance_type.get("hourly_price", 0)
            for slot in instance_type.get("availability", []):
                if not slot.get("available"):
                    continue
                slot_region = slot.get("region")
                if region and slot_region != region:
                    continue
                if cloud and slot_region:
                    matches.append(_CapacityMatch(cloud=cloud, region=slot_region, hourly_price=hourly_price))
        if not matches:
            raise GPUProviderError(
                f"{self.name}: no available capacity for gpu_type={gpu_type!r} region={region!r}"
            )
        matches.sort(key=lambda match: match.hourly_price)
        return matches[0]

    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        capacity = self._find_capacity(gpu_type=gpu_type, region=region)
        payload = {
            "cloud": capacity.cloud,
            "region": capacity.region,
            "shade_instance_type": gpu_type,
            "shade_cloud": True,
            "name": f"larkup-video-{job_id}",
            "launch_configuration": {
                "type": "docker",
                "docker_configuration": {
                    "image": image,
                    "envs": [{"name": key, "value": value} for key, value in env.items()],
                },
            },
        }
        response = requests.post(
            f"{BASE_URL}/instances/create",
            json=payload,
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(response, self.name)
        body: dict[str, Any] = response.json()
        instance_id = body.get("id")
        if not instance_id:
            raise GPUProviderError(f"{self.name}: create-instance response missing 'id': {body!r}")
        return str(instance_id)

    def get_status(self, instance_id: str) -> InstanceStatus:
        response = requests.get(
            f"{BASE_URL}/instances/{instance_id}/info",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(response, self.name)
        body: dict[str, Any] = response.json()
        raw_status = str(body.get("status", "")).lower()
        state = _STATE_BY_STATUS.get(raw_status, InstanceState.UNKNOWN)
        return InstanceStatus(state=state, detail=raw_status or None)

    def terminate(self, instance_id: str) -> None:
        response = requests.post(
            f"{BASE_URL}/instances/{instance_id}/delete",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        if response.status_code == 404:
            return
        raise_for_response(response, self.name)
