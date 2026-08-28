"""Hyperstack GPU provider client.

Hyperstack (https://www.hyperstack.cloud) rents GPUs as full virtual
machines, not containers -- every VM must be created inside a pre-existing
Hyperstack "environment" (a named, region-scoped resource group), so region
selection happens by picking an environment rather than by a per-request
field. Example `gpu_type`/flavor values from Hyperstack's docs:
"n3-RTX-A6000x1", "n3-A100x1", "n2-RTX-A5000x1".
"""

from __future__ import annotations

import os
import shlex
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

API_BASE = "https://infrahub-api.nexgencloud.com/v1/core/virtual-machines"

# Hyperstack's standard CUDA-ready GPU image; documented as shipping with
# Docker and NVIDIA drivers preinstalled, so the cloud-init script below only
# has to `docker run` our worker image -- it never installs anything itself.
DEFAULT_IMAGE_NAME = "Ubuntu Server 22.04 LTS R550 CUDA 12.4 with Docker"

# Hyperstack's documented VM `status` values (see
# docs/virtual-machines/manage-vm-state). Anything not listed here maps to
# InstanceState.UNKNOWN rather than being guessed at.
_STATUS_MAP: dict[str, InstanceState] = {
    "CREATING": InstanceState.PENDING,
    "BUILD": InstanceState.PENDING,
    "STARTING": InstanceState.PENDING,
    "ACTIVE": InstanceState.RUNNING,
    "SHUTOFF": InstanceState.EXITED,
    "DELETING": InstanceState.EXITED,
    "ERROR": InstanceState.FAILED,
}


def _build_user_data(image: str, env: dict[str, str]) -> str:
    """Cloud-init `user_data` Hyperstack runs once on first boot.

    Values are shell-quoted since job env can contain arbitrary characters;
    keys are our own fixed env-var names (e.g. LARKUP_VIDEO_JOB_ID) so they
    are safe to interpolate directly.
    """
    env_args = " ".join(f"-e {key}={shlex.quote(value)}" for key, value in env.items())
    docker_run = f"docker run --rm --gpus all {env_args} {shlex.quote(image)}".strip()
    return f"#!/bin/bash\nset -euo pipefail\n{docker_run}\n"


@dataclass
class HyperstackProvider(GPUInstanceProvider):
    name: ClassVar[str] = "hyperstack"

    api_key: str
    environment_name: str
    key_name: str

    @classmethod
    def from_env(cls) -> "HyperstackProvider":
        api_key = os.getenv("HYPERSTACK_API_KEY")
        if not api_key:
            raise GPUProviderError("HYPERSTACK_API_KEY is not set")
        environment_name = os.getenv("HYPERSTACK_ENVIRONMENT_NAME")
        if not environment_name:
            raise GPUProviderError(
                "HYPERSTACK_ENVIRONMENT_NAME is not set (Hyperstack requires an "
                "existing environment name to create a VM in)"
            )
        key_name = os.getenv("HYPERSTACK_KEY_NAME")
        if not key_name:
            raise GPUProviderError(
                "HYPERSTACK_KEY_NAME is not set (Hyperstack requires an existing "
                "SSH keypair name to create a VM)"
            )
        return cls(api_key=api_key, environment_name=environment_name, key_name=key_name)

    def _headers(self) -> dict[str, str]:
        return {"api_key": self.api_key, "content-type": "application/json"}

    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        # Region is chosen by `environment_name` above, not per-request --
        # `region` is accepted for interface parity but not sent.
        payload = {
            "name": f"larkup-video-{job_id}"[:50],
            "environment_name": self.environment_name,
            "image_name": DEFAULT_IMAGE_NAME,
            "flavor_name": gpu_type,
            "key_name": self.key_name,
            "count": 1,
            "assign_floating_ip": False,
            "user_data": _build_user_data(image, env),
        }
        response = requests.post(
            API_BASE, json=payload, headers=self._headers(), timeout=DEFAULT_TIMEOUT_SECS
        )
        raise_for_response(response, self.name)
        try:
            instances = response.json()["instances"]
            return str(instances[0]["id"])
        except (KeyError, IndexError, ValueError, TypeError) as error:
            raise GPUProviderError(
                f"{self.name}: unexpected create-VM response shape: {response.text[:500]}"
            ) from error

    def get_status(self, instance_id: str) -> InstanceStatus:
        response = requests.get(
            f"{API_BASE}/{instance_id}", headers=self._headers(), timeout=DEFAULT_TIMEOUT_SECS
        )
        raise_for_response(response, self.name)
        try:
            instance = response.json()["instance"]
        except (KeyError, ValueError, TypeError) as error:
            raise GPUProviderError(
                f"{self.name}: unexpected get-VM response shape: {response.text[:500]}"
            ) from error
        raw_status = instance.get("status")
        power_state = instance.get("power_state")
        state = _STATUS_MAP.get(str(raw_status), InstanceState.UNKNOWN)
        return InstanceStatus(
            state=state, detail=f"status={raw_status} power_state={power_state}"
        )

    def terminate(self, instance_id: str) -> None:
        response = requests.delete(
            f"{API_BASE}/{instance_id}", headers=self._headers(), timeout=DEFAULT_TIMEOUT_SECS
        )
        if response.status_code == 404:
            return
        raise_for_response(response, self.name)
