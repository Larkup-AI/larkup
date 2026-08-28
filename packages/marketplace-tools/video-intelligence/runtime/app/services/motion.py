from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class ScoredFrame:
    time_ms: int
    frame: np.ndarray
    motion_score: float


class MotionSampler:
    """Picks the frames most likely to matter within a clip or bounded range.

    Scores each frame by grayscale difference from its predecessor -- a
    cheap proxy for "something changed here" (an action, a reveal, a state
    transition) -- and biases selection toward high-scoring frames while
    still guaranteeing even coverage, so a slow deliberate action that
    produces a low frame-diff is never dropped entirely.
    """

    @staticmethod
    def to_gray(frame: np.ndarray) -> np.ndarray:
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    def score_frame(self, frame: np.ndarray, previous_gray: np.ndarray | None) -> tuple[float, np.ndarray]:
        """Returns (motion_score, this frame's grayscale) for incremental/streaming use."""
        gray = self.to_gray(frame)
        score = 0.0 if previous_gray is None else float(np.mean(cv2.absdiff(gray, previous_gray)))
        return score, gray

    def score_sequence(self, frames: list[tuple[int, np.ndarray]]) -> list[ScoredFrame]:
        scored: list[ScoredFrame] = []
        previous_gray: np.ndarray | None = None
        for time_ms, frame in frames:
            score, gray = self.score_frame(frame, previous_gray)
            scored.append(ScoredFrame(time_ms=time_ms, frame=frame, motion_score=score))
            previous_gray = gray
        return scored

    def select_adaptive(
        self, frames: list[tuple[int, np.ndarray]], target_count: int, *, coverage_floor: float = 0.4
    ) -> list[tuple[int, np.ndarray]]:
        """`coverage_floor` reserves a fraction of the budget for evenly time-spread
        picks; the rest goes to the highest-motion frames."""
        if len(frames) <= target_count:
            return frames
        scored = self.score_sequence(frames)

        coverage_budget = max(1, round(target_count * coverage_floor))
        step = len(scored) / coverage_budget
        coverage_indices = {round(i * step) for i in range(coverage_budget)}
        coverage_indices = {min(index, len(scored) - 1) for index in coverage_indices}

        remaining_budget = max(0, target_count - len(coverage_indices))
        motion_ranked = sorted(
            (index for index in range(len(scored)) if index not in coverage_indices),
            key=lambda index: -scored[index].motion_score,
        )
        selected_indices = coverage_indices | set(motion_ranked[:remaining_budget])
        ordered = sorted(selected_indices)
        return [(scored[index].time_ms, scored[index].frame) for index in ordered]
