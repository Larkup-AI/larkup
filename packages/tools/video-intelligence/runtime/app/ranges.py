from __future__ import annotations

from typing import Any


def normalized_important_ranges(
    brief: dict[str, Any], duration_secs: float
) -> list[tuple[float, float]]:
    ranges: list[tuple[float, float]] = []
    for candidate in brief.get("importantRanges") or []:
        try:
            start = max(0.0, float(candidate.get("startSecs")))
            end = min(duration_secs, float(candidate.get("endSecs")))
        except (AttributeError, TypeError, ValueError):
            continue
        if end > start:
            ranges.append((start, end))
    ranges.sort()
    merged: list[tuple[float, float]] = []
    for start, end in ranges:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged
