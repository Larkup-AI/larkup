"""Modal GPU provider -- the default managed-cloud dispatch target.

Modal is a managed job-queue platform like RunPod, not "rent a raw VM": a
Modal Function is deployed once (see modal_worker_entrypoint.py, deployed
with `modal deploy`), and this provider calls it with `.spawn()`, which
returns a call id to poll. Modal's FunctionCall API does not distinguish
"queued" from "running" the way RunPod's status field does, so get_status()
reports RUNNING for the whole in-flight window rather than faking a
PENDING/RUNNING split Modal doesn't expose. Its worker function has no AWS
credentials of its own, so get_result() relays the worker's own return
value the same way runpod.py does; there is no equivalent of RunPod's live
progress relay here yet (see get_progress()'s docstring).

Named modal_provider.py, not modal.py, on purpose: this file does
`import modal` for the real SDK, and a same-directory module named exactly
`modal.py` risks shadowing it depending on how an entrypoint is invoked.

Every method/signature used here (Function.from_name, .spawn, FunctionCall
.from_id/.get/.cancel/.object_id) has been checked against a real installed
`modal==1.5.4` client, not just documentation -- what remains unverified is
runtime *behavior* against a live account (does .get(timeout=0) actually
raise TimeoutError promptly for a still-running call, does .spawn() dispatch
onto a real deployed Function), which requires `modal deploy` and a real
job run to confirm.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, ClassVar

from .base import GPUInstanceProvider, GPUProviderError, InstanceState, InstanceStatus

DEFAULT_APP_NAME = "larkup-video-intelligence"
DEFAULT_FUNCTION_NAME = "process_video_job"


@dataclass
class ModalProvider(GPUInstanceProvider):
    name: ClassVar[str] = "modal"

    token_id: str
    token_secret: str
    app_name: str = DEFAULT_APP_NAME
    function_name: str = DEFAULT_FUNCTION_NAME

    @classmethod
    def from_env(cls) -> "ModalProvider":
        token_id = os.getenv("MODAL_TOKEN_ID")
        token_secret = os.getenv("MODAL_API_KEY") or os.getenv("MODAL_TOKEN_SECRET")
        if not token_id or not token_secret:
            raise GPUProviderError(
                "MODAL_TOKEN_ID and MODAL_API_KEY must both be set to build a Modal provider client"
            )
        return cls(
            token_id=token_id,
            token_secret=token_secret,
            app_name=os.getenv("LARKUP_VIDEO_MODAL_APP", DEFAULT_APP_NAME),
            function_name=os.getenv("LARKUP_VIDEO_MODAL_FUNCTION", DEFAULT_FUNCTION_NAME),
        )

    def _sdk(self) -> Any:
        import modal

        os.environ.setdefault("MODAL_TOKEN_ID", self.token_id)
        os.environ.setdefault("MODAL_TOKEN_SECRET", self.token_secret)
        return modal

    def _function_call(self, instance_id: str) -> Any:
        return self._sdk().functions.FunctionCall.from_id(instance_id)

    def launch(
        self,
        *,
        job_id: str,
        image: str,
        env: dict[str, str],
        gpu_type: str,
        region: str | None = None,
    ) -> str:
        modal = self._sdk()
        function = modal.Function.from_name(self.app_name, self.function_name)
        call = function.spawn(dict(env))
        return str(call.object_id)

    def get_status(self, instance_id: str) -> InstanceStatus:
        try:
            self._function_call(instance_id).get(timeout=0)
            return InstanceStatus(state=InstanceState.EXITED)
        except TimeoutError:
            return InstanceStatus(
                state=InstanceState.RUNNING,
                detail="in-flight; Modal does not expose a separate queued state",
            )
        except Exception as error:
            return InstanceStatus(state=InstanceState.FAILED, detail=str(error)[:300])

    def get_result(self, instance_id: str) -> dict[str, Any] | None:
        try:
            value = self._function_call(instance_id).get(timeout=0)
        except Exception:
            return None
        return value if isinstance(value, dict) else None

    def get_progress(self, instance_id: str) -> dict[str, Any] | None:
        # Modal does not relay a mid-call progress channel through
        # FunctionCall the way RunPod's status endpoint does. Wiring this up
        # would need the worker to publish progress through a separate Modal
        # primitive (a Dict or Queue keyed by call id) that this method then
        # reads -- left as a follow-up rather than faked here.
        return None

    def terminate(self, instance_id: str) -> None:
        try:
            self._function_call(instance_id).cancel()
        except Exception as error:
            raise GPUProviderError(f"modal cancel failed for {instance_id}: {error}") from error
