"""Northflank GPU provider client.

Northflank Jobs (https://northflank.com/docs/v1/api/project/jobs) are
run-to-completion containers, distinct from Northflank's long-running
Services -- a Job runs our worker image once and exits on its own, which is
exactly what one video-indexing run needs. GPU capacity is requested via a
`gpuType` SKU on the job's billing config; Northflank does not constrain it
to a fixed enum (it is validated against whatever hardware the target
cluster actually has), but confirmed examples from Northflank's own docs
include "nvidia-tesla-t4" and "a100-80".
"""

from __future__ import annotations

import os
import re
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

API_BASE = "https://api.northflank.com/v1"

# Baseline CPU/RAM plan a job runs under; the GPU itself is a separate line
# item layered on top via `billing.gpu`, per Northflank's job examples.
DEFAULT_DEPLOYMENT_PLAN = "nf-compute-20"

_NAME_MAX_LEN = 52


def _job_name(job_id: str) -> str:
    """Build a Northflank-legal job name from an arbitrary job id.

    Names must match ``^[a-zA-Z]((-|\\s)?[a-zA-Z0-9]+((-|\\s)[a-zA-Z0-9]+)*)?$``
    and be 3-52 chars -- no underscores, must start with a letter, no
    leading/trailing/doubled separators.
    """
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", job_id).strip("-")
    name = f"video-{slug}" if slug else "video-job"
    return name[:_NAME_MAX_LEN].rstrip("-")


def _split_instance_id(instance_id: str) -> tuple[str, str]:
    try:
        job_id, run_id = instance_id.split(":", 1)
    except ValueError as error:
        raise GPUProviderError(f"malformed northflank instance id: {instance_id!r}") from error
    return job_id, run_id


@dataclass
class NorthflankProvider(GPUInstanceProvider):
    name: ClassVar[str] = "northflank"

    api_key: str
    project_id: str
    deployment_plan: str = DEFAULT_DEPLOYMENT_PLAN
    image_credentials_id: str | None = None

    @classmethod
    def from_env(cls) -> "NorthflankProvider":
        api_key = os.getenv("NORTHFLANK_API_KEY")
        if not api_key:
            raise GPUProviderError("NORTHFLANK_API_KEY is not set")
        project_id = os.getenv("NORTHFLANK_PROJECT_ID")
        if not project_id:
            raise GPUProviderError("NORTHFLANK_PROJECT_ID is not set")
        return cls(
            api_key=api_key,
            project_id=project_id,
            deployment_plan=os.getenv("NORTHFLANK_DEPLOYMENT_PLAN", DEFAULT_DEPLOYMENT_PLAN),
            image_credentials_id=os.getenv("NORTHFLANK_IMAGE_CREDENTIALS_ID") or None,
        )

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def _url(self, path: str) -> str:
        return f"{API_BASE}/projects/{self.project_id}{path}"

    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        # Northflank has no per-job region: a project is pinned to one
        # cluster/region when it's created, so `region` is accepted here
        # for interface parity but has nothing to bind it to.
        del region

        external: dict[str, str] = {"imagePath": image}
        if self.image_credentials_id:
            external["credentials"] = self.image_credentials_id

        body = {
            "name": _job_name(job_id),
            "billing": {
                "deploymentPlan": self.deployment_plan,
                "gpu": {
                    "enabled": True,
                    "configuration": {"gpuType": gpu_type, "gpuCount": 1},
                },
            },
            "deployment": {"external": external},
            "runtimeEnvironment": env,
        }
        create_response = requests.post(
            self._url("/jobs"), headers=self._headers(), json=body, timeout=DEFAULT_TIMEOUT_SECS
        )
        raise_for_response(create_response, self.name)
        try:
            job_id_nf = create_response.json()["data"]["id"]
        except (KeyError, ValueError) as error:
            raise GPUProviderError(f"{self.name} create-job response missing data.id") from error

        run_response = requests.post(
            self._url(f"/jobs/{job_id_nf}/runs"),
            headers=self._headers(),
            json={},
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(run_response, self.name)
        try:
            run_id = run_response.json()["data"]["id"]
        except (KeyError, ValueError) as error:
            raise GPUProviderError(f"{self.name} run-job response missing data.id") from error

        return f"{job_id_nf}:{run_id}"

    def get_status(self, instance_id: str) -> InstanceStatus:
        job_id, run_id = _split_instance_id(instance_id)
        response = requests.get(
            self._url(f"/jobs/{job_id}/runs/{run_id}"),
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(response, self.name)
        run = response.json().get("data", {})
        status = run.get("status")

        if status == "SUCCESS":
            return InstanceStatus(InstanceState.EXITED, detail=status)
        if status == "FAILED":
            return InstanceStatus(InstanceState.FAILED, detail=status)
        if status == "RUNNING":
            # Northflank reports "RUNNING" from the moment a run is queued;
            # `startedAt` only gets set once the container actually starts.
            if run.get("startedAt"):
                return InstanceStatus(InstanceState.RUNNING, detail=status)
            return InstanceStatus(InstanceState.PENDING, detail=status)
        return InstanceStatus(InstanceState.UNKNOWN, detail=str(status))

    def terminate(self, instance_id: str) -> None:
        job_id, _run_id = _split_instance_id(instance_id)
        response = requests.delete(
            self._url(f"/jobs/{job_id}"), headers=self._headers(), timeout=DEFAULT_TIMEOUT_SECS
        )
        if response.status_code == 404:
            return
        raise_for_response(response, self.name)
