from __future__ import annotations

import threading
import unittest

from app.services.pipeline import _run_with_progress


class RunWithProgressTests(unittest.TestCase):
    def test_reports_increasing_progress_below_ceiling_while_running_then_returns_result(self) -> None:
        release = threading.Event()
        calls: list[tuple[str, int, str]] = []

        def slow_call() -> str:
            release.wait(timeout=5)
            return "done"

        def progress(stage: str, percent: int, message: str) -> None:
            calls.append((stage, percent, message))
            if len(calls) >= 2:
                release.set()

        result = _run_with_progress(
            slow_call, progress, "synthesize", 88, "Generating clip embeddings", ramp_seconds=0.3
        )

        self.assertEqual(result, "done")
        self.assertGreaterEqual(len(calls), 2)
        self.assertTrue(
            all(stage == "synthesize" and message == "Generating clip embeddings" for stage, _, message in calls)
        )
        percents = [percent for _, percent, _ in calls]
        self.assertTrue(all(88 <= percent <= 99 for percent in percents))
        self.assertEqual(percents, sorted(percents))

    def test_reraises_the_call_error_on_the_caller_thread(self) -> None:
        def failing_call() -> None:
            raise ValueError("boom")

        with self.assertRaises(ValueError):
            _run_with_progress(failing_call, lambda *_args: None, "synthesize", 88, "msg", ramp_seconds=0.1)

    def test_switches_to_the_slow_message_once_the_threshold_is_passed(self) -> None:
        release = threading.Event()
        calls: list[tuple[int, str]] = []

        def slow_call() -> str:
            release.wait(timeout=5)
            return "done"

        def progress(_stage: str, percent: int, message: str) -> None:
            calls.append((percent, message))
            if len(calls) >= 3:
                release.set()

        result = _run_with_progress(
            slow_call,
            progress,
            "synthesize",
            88,
            "fast message",
            ramp_seconds=0.3,
            slow_after_seconds=0.2,
            slow_message="slow message",
        )

        self.assertEqual(result, "done")
        messages = [message for _, message in calls]
        # The first tick fires near elapsed=0, before the 0.2s threshold; the
        # 1s thread.join between ticks puts every later tick well past it.
        self.assertEqual(messages[0], "fast message")
        self.assertTrue(any(message == "slow message" for message in messages[1:]))

    def test_never_reports_the_ceiling_percent_as_immediately_done(self) -> None:
        def instant_call() -> str:
            return "done"

        percents: list[int] = []

        def progress(_stage: str, percent: int, _message: str) -> None:
            percents.append(percent)

        result = _run_with_progress(instant_call, progress, "synthesize", 88, "msg", ramp_seconds=0.3)
        self.assertEqual(result, "done")
        # A call that finishes before the first poll may report no progress
        # ticks at all; if it did report one, it must still respect the cap.
        self.assertTrue(all(percent <= 99 for percent in percents))


if __name__ == "__main__":
    unittest.main()
