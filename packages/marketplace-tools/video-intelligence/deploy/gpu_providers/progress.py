from __future__ import annotations

import json
import threading
import time
from typing import Callable


def create_progress_reporter(
    send: Callable[[str], None],
) -> Callable[..., None]:
    """Throttle structured progress without allowing transport errors to fail work."""
    last_stage = ""
    last_percent = -1
    last_overall_percent = -1
    last_stage_percent = -1
    last_message = ""
    last_details = ""
    last_sent_at = 0.0

    def report(
        stage: str,
        percent: int,
        message: str,
        stage_percent: int | None = None,
        details: dict[str, int | float | str] | None = None,
    ) -> None:
        nonlocal last_stage, last_percent, last_overall_percent, last_stage_percent, last_message, last_details, last_sent_at
        now = time.monotonic()
        percent = max(last_overall_percent, max(0, min(99, int(percent))))
        measured_stage_percent = (
            max(0, min(99, int(stage_percent)))
            if stage_percent is not None
            else percent
        )
        message = message[:240]
        details_json = json.dumps(details or {}, sort_keys=True, separators=(",", ":"))
        unchanged = (
            stage == last_stage
            and percent <= last_percent
            and measured_stage_percent <= last_stage_percent
            and message == last_message
            and details_json == last_details
        )
        if unchanged:
            return
        # A phase that advances slowly still has something to say -- which
        # segment is being read, how many are left. Let that text through on
        # its own cadence, and only rate-limit repeats of the same state.
        if (
            stage == last_stage
            and percent - last_percent < 2
            and measured_stage_percent - last_stage_percent < 2
            and message == last_message
            and details_json == last_details
            and now - last_sent_at < 1.0
        ):
            return
        try:
            payload = json.dumps(
                {
                    "stage": stage,
                    "percent": percent,
                    "message": message,
                    **(
                        {"stagePercent": measured_stage_percent}
                        if stage_percent is not None
                        else {}
                    ),
                    **(details or {}),
                },
                separators=(",", ":"),
            )

            # Provider progress transport is best-effort. A lost or slow
            # callback must never strand the worker after its evidence is
            # ready; RunPod will still receive the final handler result.
            def deliver() -> None:
                try:
                    send(payload)
                except Exception:
                    pass

            thread = threading.Thread(target=deliver, daemon=True)
            thread.start()
            thread.join(timeout=2)
            (
                last_stage,
                last_percent,
                last_overall_percent,
                last_stage_percent,
                last_message,
                last_details,
                last_sent_at,
            ) = (
                stage,
                percent,
                percent,
                measured_stage_percent,
                message,
                details_json,
                now,
            )
        except Exception:
            return

    return report
