"""Scaleway GPU client: GPU Instances are plain VMs (Scaleway's Serverless
Jobs/Containers do not currently offer GPU resources), so this launches a VM
from a Docker+NVIDIA-preinstalled "GPU OS" marketplace image and hands it a
cloud-init script that `docker run`s our worker image on boot. Example
`gpu_type` values (Scaleway commercial types): "H100-1-80G", "L4-1-24G",
"L40S-1-48G".
"""

from __future__ import annotations

import os
import shlex
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

_API_BASE = "https://api.scaleway.com/instance/v1"

# H100-SXM and L4 GPU Instances are both documented as available here; kept
# as a fallback only -- SCALEAWAY_DEFAULT_ZONE should be set explicitly for
# production use since GPU availability varies by zone and over time.
DEFAULT_ZONE = "fr-par-2"

# "stopping" and "locked" are deliberately left unmapped (-> UNKNOWN):
# "stopping" is a transitional state that is neither cleanly running nor
# exited yet, and "locked" reflects an account/billing hold rather than the
# compute's own lifecycle -- guessing either would be worse than UNKNOWN.
_STATE_MAP = {
    "starting": InstanceState.PENDING,
    "running": InstanceState.RUNNING,
    "stopped": InstanceState.EXITED,
    "stopped in place": InstanceState.EXITED,
}


def _cloud_init_script(image: str, env: dict[str, str]) -> str:
    """A shell-script cloud-init payload: Scaleway's user-data API only accepts
    plain text (no gzip), and cloud-init runs any `#!`-prefixed user-data
    directly as a boot script on first boot.
    """
    env_flags = " ".join(
        f"-e {shlex.quote(f'{key}={value}')}" for key, value in env.items()
    )
    docker_run = f"docker run -d --restart=unless-stopped --gpus all {env_flags} {shlex.quote(image)}"
    return "\n".join(
        [
            "#!/bin/bash",
            "set -euxo pipefail",
            f"docker pull {shlex.quote(image)}",
            docker_run,
            "",
        ]
    )


@dataclass(frozen=True)
class ScalewayProvider(GPUInstanceProvider):
    name: ClassVar[str] = "scaleway"

    secret_key: str
    project_id: str
    image_id: str
    default_zone: str = DEFAULT_ZONE
    access_key_id: str | None = None

    @classmethod
    def from_env(cls) -> "ScalewayProvider":
        secret_key = os.getenv("SCALEAWAY_API_KEY")
        if not secret_key:
            raise GPUProviderError("SCALEAWAY_API_KEY is not set")
        project_id = os.getenv("SCALEAWAY_PROJECT_ID")
        if not project_id:
            raise GPUProviderError("SCALEAWAY_PROJECT_ID is not set")
        image_id = os.getenv("SCALEAWAY_GPU_IMAGE_ID")
        if not image_id:
            raise GPUProviderError(
                "SCALEAWAY_GPU_IMAGE_ID is not set; it must be the UUID (in "
                "your target zone) of a Scaleway Marketplace GPU OS image "
                "with Docker and NVIDIA drivers preinstalled, e.g. "
                "'Ubuntu Noble GPU OS 13 (NVIDIA)'"
            )
        return cls(
            secret_key=secret_key,
            project_id=project_id,
            image_id=image_id,
            default_zone=os.getenv("SCALEAWAY_DEFAULT_ZONE", DEFAULT_ZONE),
            # Scaleway's Instance API authenticates with the secret key alone
            # (X-Auth-Token below); the access key id only matters for the
            # separate S3-compatible Object Storage API (AWS SigV4 signing),
            # which this provider never calls. Read anyway so it is available
            # if a future request type here needs it, and so nothing here
            # silently ignores a credential the caller configured.
            access_key_id=os.getenv("SCALEAWAY_ACCESS_KEY_ID"),
        )

    def _headers(self) -> dict[str, str]:
        return {"X-Auth-Token": self.secret_key}

    def _instance_ref(self, instance_id: str) -> tuple[str, str]:
        # `get_status`/`terminate` take no zone argument, but Scaleway's API
        # is zone-scoped, so `launch` encodes the zone it actually used into
        # the returned id as "{zone}/{server_id}". Falls back to
        # `default_zone` for a bare id, in case anything else constructs one.
        zone, sep, server_id = instance_id.partition("/")
        if not sep:
            return self.default_zone, instance_id
        return zone, server_id

    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        zone = region or self.default_zone
        create_response = requests.post(
            f"{_API_BASE}/zones/{zone}/servers",
            json={
                "name": f"larkup-video-{job_id}"[:63],
                "commercial_type": gpu_type,
                "project": self.project_id,
                "image": self.image_id,
                "dynamic_ip_required": True,
                "tags": ["larkup-video-intelligence", f"job:{job_id}"],
            },
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(create_response, self.name)
        try:
            server_id = str(create_response.json()["server"]["id"])
        except (KeyError, TypeError, ValueError) as error:
            raise GPUProviderError(
                f"{self.name}: create-server response missing server.id"
            ) from error

        user_data_response = requests.patch(
            f"{_API_BASE}/zones/{zone}/servers/{server_id}/user_data/cloud-init",
            data=_cloud_init_script(image, env).encode("utf-8"),
            headers={**self._headers(), "Content-Type": "text/plain"},
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(user_data_response, self.name)

        # Newly created servers boot stopped -- unlike e.g. AWS RunInstances,
        # Scaleway requires an explicit poweron action to start them.
        poweron_response = requests.post(
            f"{_API_BASE}/zones/{zone}/servers/{server_id}/action",
            json={"action": "poweron"},
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(poweron_response, self.name)
        return f"{zone}/{server_id}"

    def get_status(self, instance_id: str) -> InstanceStatus:
        zone, server_id = self._instance_ref(instance_id)
        response = requests.get(
            f"{_API_BASE}/zones/{zone}/servers/{server_id}",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        if response.status_code == 404:
            return InstanceStatus(state=InstanceState.UNKNOWN, detail="not found")
        raise_for_response(response, self.name)
        server: dict[str, Any] = response.json().get("server", {})
        raw_state = str(server.get("state") or "")
        state = _STATE_MAP.get(raw_state, InstanceState.UNKNOWN)
        detail = str(server.get("state_detail") or raw_state or "") or None
        return InstanceStatus(state=state, detail=detail)

    def terminate(self, instance_id: str) -> None:
        zone, server_id = self._instance_ref(instance_id)
        # The `terminate` action (vs a plain DELETE) also removes attached
        # local/block volumes so nothing keeps billing after the instance is
        # gone. This provider only ever requests an ephemeral dynamic IP
        # (see `launch`), which Scaleway releases with the server; a
        # manually reserved flexible IP would need its own cleanup call, but
        # nothing here creates one.
        response = requests.post(
            f"{_API_BASE}/zones/{zone}/servers/{server_id}/action",
            json={"action": "terminate"},
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        if response.status_code == 404:
            return
        raise_for_response(response, self.name)
