from __future__ import annotations

import time
import unittest

from app.services.pipeline import PHASES, STAGE_PHASES, SmoothProgress, _stage_percent


class SmoothProgressTests(unittest.TestCase):
    def test_a_phase_keeps_heartbeating_without_inventing_progress(self) -> None:
        reports: list[tuple[str, int, str]] = []
        with SmoothProgress(
            lambda stage, percent, message, _stage, _details: reports.append(
                (stage, percent, message)
            ),
            tick_seconds=0.02,
        ) as smooth:
            smooth.phase(
                "synthesize", 58, "Watching video segments", 94, span_seconds=0.3
            )
            time.sleep(0.4)

        percents = [percent for _, percent, _ in reports]
        self.assertGreater(len(percents), 3)
        self.assertTrue(all(percent == percents[0] for percent in percents), percents)

    def test_heartbeat_never_creeps_toward_the_phase_ceiling(self) -> None:
        reports: list[int] = []
        with SmoothProgress(
            lambda _stage, percent, *_rest: reports.append(percent), tick_seconds=0.02
        ) as smooth:
            smooth.phase(
                "synthesize", 58, "Watching video segments", 70, span_seconds=0.05
            )
            time.sleep(0.4)

        self.assertTrue(all(percent == 58 for percent in reports), reports)

    def test_real_milestones_never_go_backwards(self) -> None:
        reports: list[int] = []
        with SmoothProgress(
            lambda _stage, percent, *_rest: reports.append(percent), tick_seconds=0.02
        ) as smooth:
            smooth.phase("detect", 34, "Reading video frames", 58, span_seconds=5)
            time.sleep(0.1)
            smooth.milestone("detect", 50, "Reading video frames (500/1000)")
            time.sleep(0.05)
            # A late milestone reporting an earlier percent cannot rewind the bar.
            smooth.milestone("detect", 40, "Reading video frames (520/1000)")

        self.assertEqual(reports, sorted(reports))
        self.assertGreaterEqual(reports[-1], 50)

    def test_status_text_can_change_without_claiming_progress(self) -> None:
        reports: list[tuple[int, str]] = []
        with SmoothProgress(
            lambda _stage, percent, message, _pct, _details: reports.append(
                (percent, message)
            ),
            tick_seconds=5,
        ) as smooth:
            smooth.milestone("probe", 8, "Reading video signals")
            smooth.message("Reading visible text signals")

        self.assertEqual(reports[-1], (8, "Reading visible text signals"))
        self.assertEqual(reports[-2][0], 8)

    def test_phase_budget_is_ordered_contiguous_and_bounded(self) -> None:
        bands = list(PHASES.values())
        self.assertEqual(bands, sorted(bands))
        for (_, end), (next_start, _) in zip(bands, bands[1:]):
            self.assertEqual(end, next_start, "phases must not leave a gap in the bar")
        self.assertGreaterEqual(bands[0][0], 0)
        self.assertLessEqual(bands[-1][1], 99)
        # Watching the video is the phase that dominates the wall clock, so it
        # must own the widest slice or the bar stalls there.
        widest = max(PHASES, key=lambda name: PHASES[name][1] - PHASES[name][0])
        self.assertEqual(widest, "describe")

    def test_no_phase_is_wide_enough_to_read_as_a_jump(self) -> None:
        for name, (start, end) in PHASES.items():
            self.assertLessEqual(end - start, 40, f"{name} spans too much of the bar")

    def test_stage_percent_fills_each_stage_from_end_to_end(self) -> None:
        """A host draws one bar per step from this, so each must span 0-99."""
        for stage, phases in STAGE_PHASES.items():
            start = min(PHASES[phase][0] for phase in phases)
            end = max(PHASES[phase][1] for phase in phases)
            self.assertEqual(_stage_percent(stage, start), 0, stage)
            self.assertEqual(_stage_percent(stage, end), 99, stage)
            self.assertEqual(_stage_percent(stage, (start + end) / 2), 50, stage)

    def test_stage_percent_is_reported_alongside_every_update(self) -> None:
        reports: list[tuple[str, int, int]] = []
        with SmoothProgress(
            lambda stage, percent, _message, stage_percent, _details: reports.append(
                (stage, percent, stage_percent)
            ),
            tick_seconds=5,
        ) as smooth:
            smooth.milestone("detect", PHASES["frames"][0], "Reading video frames")
            smooth.milestone(
                "detect", sum(PHASES["frames"]) / 2, "Reading video frames"
            )

        self.assertEqual([stage for stage, _, _ in reports], ["detect", "detect"])
        self.assertEqual(reports[0][2], 0)
        self.assertEqual(reports[-1][2], 50)

    def test_narrow_phase_heartbeats_without_faking_stage_progress(self) -> None:
        reports: list[tuple[int, int]] = []
        with SmoothProgress(
            lambda _stage, percent, _message, stage_percent, _details: reports.append(
                (percent, stage_percent)
            ),
            tick_seconds=0.01,
        ) as smooth:
            smooth.phase(
                "transcribe",
                PHASES["transcribe"][0],
                "Reading speech",
                PHASES["transcribe"][1],
                span_seconds=0.4,
            )
            time.sleep(0.12)

        stage_updates_by_overall: dict[int, set[int]] = {}
        for overall, stage in reports:
            stage_updates_by_overall.setdefault(overall, set()).add(stage)
        self.assertEqual(stage_updates_by_overall, {PHASES["transcribe"][0]: {0}})

    def test_an_unknown_stage_reports_the_overall_percent(self) -> None:
        self.assertEqual(_stage_percent("queued", 0), 0)
        self.assertEqual(_stage_percent("complete", 99), 99)

    def test_measured_phase_eta_overrides_the_conservative_initial_budget(self) -> None:
        reports: list[dict[str, int | float | str]] = []
        with SmoothProgress(
            lambda _stage, _percent, _message, _stage_percent, details: reports.append(
                details
            ),
            tick_seconds=5,
        ) as smooth:
            smooth.configure_eta(240)
            smooth.step(
                "synthesize",
                2,
                10,
                "Watching clips",
                PHASES["describe"],
                estimated_remaining_seconds=90,
                unit="clips",
            )

        self.assertEqual(reports[-1]["current"], 2)
        self.assertEqual(reports[-1]["total"], 10)
        self.assertEqual(reports[-1]["unit"], "clips")
        self.assertGreaterEqual(int(reports[-1]["estimatedRemainingSeconds"]), 89)
        self.assertLessEqual(int(reports[-1]["estimatedRemainingSeconds"]), 90)

    def test_final_phase_keeps_its_bounded_eta(self) -> None:
        reports: list[dict[str, int | float | str]] = []
        with SmoothProgress(
            lambda _stage, _percent, _message, _stage_percent, details: reports.append(
                details
            ),
            tick_seconds=5,
        ) as smooth:
            smooth.configure_eta(900)
            smooth.phase(
                "synthesize",
                PHASES["synthesize"][0],
                "Putting the timeline together",
                PHASES["synthesize"][1],
                30,
                estimated_remaining_seconds=30,
            )

        self.assertLessEqual(int(reports[-1]["estimatedRemainingSeconds"]), 30)

    def test_expired_eta_is_cleared_instead_of_sticking_at_one_second(self) -> None:
        reports: list[dict[str, int | float | str]] = []
        smooth = SmoothProgress(
            lambda _stage, _percent, _message, _stage_percent, details: reports.append(
                details
            ),
            tick_seconds=5,
        )
        smooth.phase(
            "synthesize",
            PHASES["synthesize"][0],
            "Putting the timeline together",
            PHASES["synthesize"][1],
            30,
            estimated_remaining_seconds=30,
        )
        assert smooth._eta_override_at is not None
        smooth._eta_override_at -= 31
        smooth._flush(force=True)

        self.assertEqual(reports[-1]["estimatedRemainingSeconds"], 0)


if __name__ == "__main__":
    unittest.main()
