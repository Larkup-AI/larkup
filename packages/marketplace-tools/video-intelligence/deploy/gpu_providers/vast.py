"""Vast.ai GPU marketplace provider.

Vast.ai is a peer-to-peer GPU marketplace: hosts list spare machines as
"offers" that renters search and rent on demand, so which machine you get
(and its price) depends on what is available right now rather than a fixed
catalog. `gpu_type` is one of Vast's own `gpu_name` offer-filter values, e.g.
"RTX_4090" or "RTX_3090".
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

BASE_URL = "https://console.vast.ai/api/v0"
DEFAULT_DISK_GB = 32.0

# `actual_status` is null while an instance is still provisioning/scheduling
# and "loading" while its image is being pulled -- both count as PENDING
# here. Anything not in this map (e.g. "offline", "unknown", or a status
# Vast adds later) falls through to InstanceState.UNKNOWN in get_status.
_ACTUAL_STATUS_MAP: dict[str | None, InstanceState] = {
    None: InstanceState.PENDING,
    "loading": InstanceState.PENDING,
    "running": InstanceState.RUNNING,
    "exited": InstanceState.EXITED,
}


def _docker_env_flags(env: dict[str, str]) -> str:
    """Render `env` in the "-e KEY=VALUE ..." docker-flag format Vast's `env` field expects."""
    return " ".join(f"-e {key}={value}" for key, value in env.items())


def _cheapest_offer(offers: list[dict[str, Any]]) -> dict[str, Any]:
    """Pick the lowest hourly-price offer.

    Vast's `order` request field is only a sort hint, not a contract, so we
    re-sort client-side on `dph_total` to actually get the cheapest match.
    """
    priced = [
        offer
        for offer in offers
        if offer.get("id") is not None and offer.get("dph_total") is not None
    ]
    if not priced:
        raise GPUProviderError(
            "vast API returned offers with no usable id/dph_total field"
        )
    return min(priced, key=lambda offer: offer["dph_total"])


@dataclass
class VastAiProvider(GPUInstanceProvider):
    name: ClassVar[str] = "vast"

    api_key: str

    @classmethod
    def from_env(cls) -> "VastAiProvider":
        api_key = os.getenv("VAST_API_KEY")
        if not api_key:
            raise GPUProviderError(
                "VAST_API_KEY is not set; cannot build a Vast.ai provider client"
            )
        return cls(api_key=api_key)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        search_filters: dict[str, Any] = {
            # verified + rentable restricts the search to hosts we can
            # actually deploy an unattended job to right now, not just
            # machines that are theoretically listed.
            "verified": {"eq": True},
            "rentable": {"eq": True},
            "gpu_name": {"eq": gpu_type},
            "type": "ondemand",
            "order": [["dph_total", "asc"]],
            "limit": 20,
        }
        if region:
            search_filters["geolocation"] = {"eq": region}
        search_response = requests.post(
            f"{BASE_URL}/bundles/",
            json=search_filters,
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(search_response, self.name)
        offers = search_response.json().get("offers") or []
        if not offers:
            where = f"gpu_type={gpu_type!r}"
            if region:
                where += f" region={region!r}"
            raise GPUProviderError(f"no Vast.ai offers matched {where}")
        offer = _cheapest_offer(offers)

        rent_response = requests.put(
            f"{BASE_URL}/asks/{offer['id']}/",
            json={
                "image": image,
                "disk": DEFAULT_DISK_GB,
                "env": _docker_env_flags(env),
            },
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(rent_response, self.name)
        rent_data = rent_response.json()
        if not rent_data.get("success", True):
            raise GPUProviderError(
                f"vast rejected rent request for offer {offer['id']}: "
                f"{rent_data.get('msg', rent_data)}"
            )
        instance_id = rent_data.get("new_contract")
        if instance_id is None:
            raise GPUProviderError(f"vast rent response missing new_contract: {rent_data}")
        return str(instance_id)

    def get_status(self, instance_id: str) -> InstanceStatus:
        response = requests.get(
            f"{BASE_URL}/instances/{instance_id}/",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(response, self.name)
        instance = response.json().get("instances")
        if instance is None:
            return InstanceStatus(state=InstanceState.UNKNOWN, detail="instance not found")
        raw_status = instance.get("actual_status")
        if raw_status in _ACTUAL_STATUS_MAP:
            return InstanceStatus(state=_ACTUAL_STATUS_MAP[raw_status])
        return InstanceStatus(state=InstanceState.UNKNOWN, detail=str(raw_status))

    def terminate(self, instance_id: str) -> None:
        response = requests.delete(
            f"{BASE_URL}/instances/{instance_id}/",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        if response.status_code == 404:
            return
        raise_for_response(response, self.name)
