"""RunPod Serverless GPU provider.

RunPod Serverless is a managed job queue, not "rent a raw VM": you submit a
payload straight to a pre-registered endpoint (its worker image is fixed
when the endpoint is created in RunPod's dashboard, not chosen per job) and
poll a job id for status, progress, and eventually the worker's own return
value. `launch()` maps onto RunPod's async `/run` submit, `get_status()`
onto `/status/{id}`, `terminate()` onto `/cancel/{id}`; `get_result()` and
`get_progress()` both read the same `/status/{id}` payload RunPod already
relays, since its worker (deploy/gpu_providers/runpod_worker_entrypoint.py)
has no AWS credentials of its own to self-report with. `image`/`region` are
accepted for interface parity with the rent-a-VM providers but ignored.
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

_STATUS_MAP: dict[str, InstanceState] = {
    "IN_QUEUE": InstanceState.PENDING,
    "QUEUED": InstanceState.PENDING,
    "IN_PROGRESS": InstanceState.RUNNING,
    "RUNNING": InstanceState.RUNNING,
    "COMPLETED": InstanceState.EXITED,
    "CANCELLED": InstanceState.EXITED,
    "CANCELED": InstanceState.EXITED,
    "FAILED": InstanceState.FAILED,
    "TIMED_OUT": InstanceState.FAILED,
}
_PROGRESS_STAGES = {
    "queued",
    "prepare",
    "probe",
    "transcribe",
    "decode",
    "ocr",
    "detect",
    "synthesize",
    "complete",
}


@dataclass
class RunpodProvider(GPUInstanceProvider):
    name: ClassVar[str] = "runpod"

    api_key: str
    endpoint_id: str

    @classmethod
    def from_env(cls) -> "RunpodProvider":
        api_key, endpoint_id = os.getenv("RUNPOD_API_KEY"), os.getenv("RUNPOD_ENDPOINT_ID")
        if not api_key or not endpoint_id:
            raise GPUProviderError(
                "RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID must both be set to build a RunPod provider client"
            )
        return cls(api_key=api_key, endpoint_id=endpoint_id)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def _base_url(self) -> str:
        return f"https://api.runpod.ai/v2/{self.endpoint_id}"

    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        response = requests.post(
            f"{self._base_url()}/run",
            json={"input": dict(env)},
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(response, self.name)
        data = response.json()
        instance_id = data.get("id")
        if not instance_id:
            raise GPUProviderError(f"RunPod /run did not return a job id: {data}")
        return str(instance_id)

    def get_status(self, instance_id: str) -> InstanceStatus:
        data = self._status(instance_id)
        raw_status = str(data.get("status") or "").upper()
        state = _STATUS_MAP.get(raw_status, InstanceState.UNKNOWN)
        if raw_status == "COMPLETED" and not isinstance(data.get("output"), dict):
            state = InstanceState.FAILED
        detail = raw_status or None
        if state == InstanceState.FAILED:
            detail = _failure_detail(data.get("error")) or detail
        return InstanceStatus(state=state, detail=detail)

    def get_result(self, instance_id: str) -> dict[str, Any] | None:
        data = self._status(instance_id)
        if str(data.get("status") or "").upper() != "COMPLETED":
            return None
        output = data.get("output")
        if not isinstance(output, dict) or not isinstance(output.get("result"), dict):
            return None
        return output

    def get_progress(self, instance_id: str) -> dict[str, Any] | None:
        data = self._status(instance_id)
        if str(data.get("status") or "").upper() not in {"IN_PROGRESS", "RUNNING"}:
            return None
        # RunPod's worker SDK serializes progress updates as `output` while a
        # job is in progress; some API versions also expose `progress`.
        progress = data.get("progress") or data.get("output")
        if isinstance(progress, str):
            import json

            try:
                progress = json.loads(progress)
            except json.JSONDecodeError:
                return None
        if not isinstance(progress, dict):
            return None
        stage, message = str(progress.get("stage") or ""), str(progress.get("message") or "")
        try:
            percent = int(progress.get("percent"))
        except (TypeError, ValueError):
            return None
        if stage not in _PROGRESS_STAGES or not (0 <= percent < 100) or not message:
            return None
        result: dict[str, Any] = {"stage": stage, "percent": percent, "message": message}
        try:
            stage_percent = float(progress.get("stagePercent"))
        except (TypeError, ValueError):
            stage_percent = None
        if stage_percent is not None and 0 <= stage_percent <= 100:
            result["stagePercent"] = stage_percent
        for key in (
            "sequence",
            "elapsedSeconds",
            "estimatedRemainingSeconds",
            "current",
            "total",
        ):
            try:
                value = float(progress.get(key))
            except (TypeError, ValueError):
                continue
            if value >= 0:
                result[key] = int(value) if value.is_integer() else value
        unit = str(progress.get("unit") or "").strip()[:80]
        if unit:
            result["unit"] = unit
        return result

    def terminate(self, instance_id: str) -> None:
        response = requests.post(
            f"{self._base_url()}/cancel/{instance_id}",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        if response.status_code == 404:
            return
        raise_for_response(response, self.name)

    def _status(self, instance_id: str) -> dict[str, Any]:
        response = requests.get(
            f"{self._base_url()}/status/{instance_id}",
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT_SECS,
        )
        raise_for_response(response, self.name)
        data = response.json()
        return data if isinstance(data, dict) else {}


def _failure_detail(error: Any) -> str | None:
    """Return the actionable worker message without leaking a provider traceback."""
    if isinstance(error, dict):
        message = error.get("error_message") or error.get("message")
    elif isinstance(error, str):
        try:
            import json

            parsed = json.loads(error)
        except json.JSONDecodeError:
            parsed = None
        message = (
            parsed.get("error_message") or parsed.get("message")
            if isinstance(parsed, dict)
            else error
        )
    else:
        return None
    clean = " ".join(str(message).split())
    return clean[:800] or None
