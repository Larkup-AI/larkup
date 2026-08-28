from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any, ClassVar

DEFAULT_TIMEOUT_SECS = 20


class InstanceState(str, Enum):
    """Coarse lifecycle of a rented GPU instance/container.

    Job progress and results are not modeled here: `cloud_worker_entrypoint.py`
    already reports them straight into DynamoDB/S3 once it starts running on the
    instance. A provider only has to answer "is compute still booting, running,
    done, or dead".
    """

    PENDING = "pending"
    RUNNING = "running"
    EXITED = "exited"
    FAILED = "failed"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class InstanceStatus:
    state: InstanceState
    detail: str | None = None


class GPUProviderError(RuntimeError):
    """A provider API rejected a request or returned an unexpected response."""


class GPUInstanceProvider(ABC):
    """Rents compute to run a single video-indexing job, in one of two shapes.

    Rent-a-VM providers (vast, shadeform, salad, scaleway, thundercompute,
    gpuai, northflank, hyperstack) launch a raw instance/container running
    `python -m app.cloud_worker` with `env`; that worker has its own AWS
    access and pulls the job, processes it, and writes status/results
    straight into DynamoDB/S3 on its own. For these, `get_status` answering
    "is compute still booting, running, done, or dead" is the whole contract
    -- `get_result`/`get_progress` are irrelevant and left at their defaults.

    Managed job-queue providers (runpod, modal) instead submit a payload
    directly to a platform-run worker function that has no AWS credentials
    of its own; the platform relays that worker's return value and live
    progress back through its own status API. For these, the control plane
    is responsible for writing the result to S3 and settling the job itself
    once `get_status` reports done, using `get_result`/`get_progress` to
    pull what the rent-a-VM model gets for free via direct self-reporting.

    Either way every provider stays swappable behind the same calls, and
    which vendor is in use stays an internal deployment decision rather than
    something a caller (or an end user) has to know.
    """

    name: ClassVar[str]

    @classmethod
    @abstractmethod
    def from_env(cls) -> "GPUInstanceProvider":
        """Build a client from this provider's API credentials in the environment."""

    @abstractmethod
    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        """Start one GPU instance/container running `image` with `env`.

        `gpu_type` is this provider's own SKU/identifier for the GPU to rent
        (see the provider's module docstring for examples) -- there is
        deliberately no universal GPU taxonomy here, since catalogs differ
        too much across vendors to make one meaningful. Returns a
        provider-scoped instance id used for `get_status` and `terminate`.
        """

    @abstractmethod
    def get_status(self, instance_id: str) -> InstanceStatus:
        """Return the current lifecycle state of a previously launched instance."""

    @abstractmethod
    def terminate(self, instance_id: str) -> None:
        """Stop and release the instance so billing for it stops.

        Must be safe to call on an instance that has already exited or been
        removed by the provider.
        """

    def get_result(self, instance_id: str) -> dict[str, Any] | None:
        """Returns `{"result": ..., "actualSourceMinutes": ...}` for a completed
        job-queue provider, or None for a rent-a-VM provider (whose instance
        already wrote its result directly to DynamoDB/S3, so the control
        plane never needs to fetch anything here). Only runpod/modal override
        this; every other provider keeps this default.
        """
        return None

    def get_progress(self, instance_id: str) -> dict[str, Any] | None:
        """Returns `{"stage", "percent", "message"}` while a job-queue provider's
        job is running, or None for a rent-a-VM provider (whose instance
        writes progress straight into DynamoDB itself, bypassing this poll
        entirely) or when no finer-grained progress is available yet.
        """
        return None


def raise_for_response(response: "object", provider: str) -> None:
    """Shared HTTP error mapping so each provider does not repeat this.

    `response` is a `requests.Response`; typed loosely here to avoid making
    `requests` an import-time dependency of this module for callers that only
    need the dataclasses/enum above.
    """
    if getattr(response, "ok", False):
        return
    status = getattr(response, "status_code", "?")
    try:
        detail = response.text[:500]
    except Exception:
        detail = "<no response body>"
    raise GPUProviderError(f"{provider} API error {status}: {detail}")
