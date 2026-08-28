from __future__ import annotations

import json
import time
from typing import Callable


def create_progress_reporter(send: Callable[[str], None]) -> Callable[[str, int, str], None]:
    """Throttle structured progress without allowing transport errors to fail work."""
    last_stage = ""
    last_percent = -1
    last_sent_at = 0.0

    def report(stage: str, percent: int, message: str) -> None:
        nonlocal last_stage, last_percent, last_sent_at
        now = time.monotonic()
        if stage == last_stage and percent <= last_percent:
            return
        if stage == last_stage and percent - last_percent < 2 and now - last_sent_at < 1.0:
            return
        try:
            send(
                json.dumps(
                    {
                        "stage": stage,
                        "percent": max(0, min(99, int(percent))),
                        "message": message[:240],
                    },
                    separators=(",", ":"),
                )
            )
            last_stage, last_percent, last_sent_at = stage, percent, now
        except Exception:
            return

    return report
