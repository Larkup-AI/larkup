"""Thunder Compute provider, built against its documented REST API
(https://api.thundercompute.com:8443/v1) for create/list/delete -- a real,
versioned OpenAPI exists for those. That API has no field to run a custom
Docker image at creation time, and Thunder's own docs call Docker inside
an instance "experimental" and SSH-only, so `launch()` bridges the gap
itself: create a bare instance, wait for it to boot, then SSH in with the
one-time private key the create call returns to start `image` detached
with `env`. Unverified against a live account: the `instances/list`
map-key field, the default SSH user, and the exact status enum.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import time
from pathlib import Path
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

DEFAULT_BASE_URL = "https://api.thundercompute.com:8443/v1"

# Only these four values are documented (thundercompute.com/docs/cli/operations/monitoring-instances).
# Anything else -- including guesses like "ERROR" or "STOPPED" -- is deliberately left to fall
# through to InstanceState.UNKNOWN in get_status rather than being mapped on spec.
_STATUS_MAP: dict[str, InstanceState] = {
    "RUNNING": InstanceState.RUNNING,
    "CREATING": InstanceState.PENDING,
    "RESTORING": InstanceState.PENDING,
    "DELETING": InstanceState.EXITED,
}


class ThunderComputeProvider(GPUInstanceProvider):
    name: ClassVar[str] = "thundercompute"

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        template: str = "ubuntu-22.04",
        ssh_user: str = "ubuntu",
        num_gpus: int = 1,
        default_cpu_cores: int = 4,
        default_disk_gb: int = 100,
        boot_timeout_secs: float = 300.0,
        boot_poll_interval_secs: float = 5.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._template = template
        self._ssh_user = ssh_user
        self._num_gpus = num_gpus
        self._default_cpu_cores = default_cpu_cores
        self._default_disk_gb = default_disk_gb
        self._boot_timeout_secs = boot_timeout_secs
        self._boot_poll_interval_secs = boot_poll_interval_secs

    @classmethod
    def from_env(cls) -> "ThunderComputeProvider":
        api_key = os.getenv("THUNDERCOMPUTE_API_KEY")
        if not api_key:
            raise GPUProviderError("THUNDERCOMPUTE_API_KEY is not set")
        return cls(api_key=api_key)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        del region  # Thunder Compute has no documented region selection; single production API.
        response = requests.post(
            f"{self._base_url}/instances/create",
            headers=self._headers(),
            json={
                "cpu_cores": self._default_cpu_cores,
                "disk_size_gb": self._default_disk_gb,
                "gpu_type": gpu_type,
                "num_gpus": self._num_gpus,
                "template": self._template,
            },
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(response, self.name)
        payload = response.json()
        try:
            instance_id = str(payload["identifier"])
        except (KeyError, TypeError) as error:
            raise GPUProviderError(
                f"{self.name}: instance create response missing 'identifier': {payload!r}"
            ) from error
        private_key = payload.get("key")
        if not private_key:
            raise GPUProviderError(
                f"{self.name}: instance {instance_id} was created but no SSH private key was "
                "returned (job unable to start)"
            )
        ip = self._wait_for_boot(instance_id)
        self._start_container(ip, private_key, image=image, env=env)
        return instance_id

    def _wait_for_boot(self, instance_id: str) -> str:
        deadline = time.monotonic() + self._boot_timeout_secs
        while True:
            record = self._find_instance(instance_id)
            if record is not None:
                ip = record.get("ip")
                if str(record.get("status", "")).upper() == "RUNNING" and ip:
                    return str(ip)
            if time.monotonic() >= deadline:
                raise GPUProviderError(
                    f"{self.name}: instance {instance_id} did not reach RUNNING with an IP "
                    f"within {self._boot_timeout_secs}s"
                )
            time.sleep(self._boot_poll_interval_secs)

    def _find_instance(self, instance_id: str) -> dict[str, Any] | None:
        response = requests.get(
            f"{self._base_url}/instances/list",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(response, self.name)
        instances = response.json() or {}
        return instances.get(str(instance_id))

    def _start_container(
        self, ip: str, private_key: str, *, image: str, env: dict[str, str]
    ) -> None:
        # Docker on Thunder is documented as experimental and interactive-only
        # (`docker run -it --rm --device nvidia.com/gpu=all ...`); there is no
        # creation-time hook for a custom image, so this runs it detached over SSH
        # using the one-time keypair the create call returned.
        handle = tempfile.NamedTemporaryFile(
            "w", prefix="thundercompute-", suffix=".pem", delete=False
        )
        key_path = Path(handle.name)
        try:
            handle.write(private_key)
            handle.close()
            key_path.chmod(0o600)
            command = [
                "ssh",
                "-i",
                str(key_path),
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "UserKnownHostsFile=/dev/null",
                "-o",
                "ConnectTimeout=10",
                f"{self._ssh_user}@{ip}",
                "docker",
                "run",
                "-d",
                "--device",
                "nvidia.com/gpu=all",
            ]
            for key, value in env.items():
                command += ["-e", f"{key}={value}"]
            command.append(image)
            completed = subprocess.run(command, capture_output=True, text=True)
            if completed.returncode != 0:
                raise GPUProviderError(
                    f"{self.name}: failed to start {image} over SSH: "
                    f"{(completed.stderr or 'no diagnostic').strip()[:500]}"
                )
        finally:
            key_path.unlink(missing_ok=True)

    def get_status(self, instance_id: str) -> InstanceStatus:
        record = self._find_instance(str(instance_id))
        if record is None:
            return InstanceStatus(InstanceState.EXITED, detail="not present in instances/list")
        raw_status = str(record.get("status", ""))
        state = _STATUS_MAP.get(raw_status.upper())
        if state is None:
            return InstanceStatus(InstanceState.UNKNOWN, detail=raw_status or None)
        return InstanceStatus(state, detail=raw_status)

    def terminate(self, instance_id: str) -> None:
        response = requests.post(
            f"{self._base_url}/instances/{instance_id}/delete",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        if response.status_code == 404:
            return
        raise_for_response(response, self.name)
