from __future__ import annotations

from typing import Any


def normalized_important_ranges(
    brief: dict[str, Any], duration_secs: float
) -> list[tuple[float, float]]:
    """Clamps a brief's requested ranges to the source duration, sorted and merged."""
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


def visual_sampling_interval(mode: str, duration_seconds: float) -> float:
    """Seconds between sampled frames for a given indexing mode and source length."""
    base_intervals = {"fast": 5.0, "balanced": 2.0, "deep": 0.75}
    max_samples = {"fast": 360, "balanced": 720, "deep": 1_800}
    return max(base_intervals[mode], duration_seconds / max_samples[mode])


def rebase_result_timestamps(result: dict[str, Any], offset_secs: float) -> None:
    """Translates clip-relative evidence (a bounded/rebased inspection) to the source clock."""
    offset_ms = round(offset_secs * 1_000)

    def shift(item: dict[str, Any], *keys: str) -> None:
        for key in keys:
            if isinstance(item.get(key), (int, float)):
                item[key] = round(float(item[key])) + offset_ms

    for segment in result.get("transcript", []):
        if not isinstance(segment, dict):
            continue
        shift(segment, "startMs", "endMs")
        for word in segment.get("words", []):
            if isinstance(word, dict):
                shift(word, "startMs", "endMs")
    for observation in result.get("visualObservations", []):
        if isinstance(observation, dict):
            shift(observation, "timeMs")
    for track in result.get("tracks", []):
        if isinstance(track, dict):
            shift(track, "startMs", "endMs")
    for state in result.get("scoreboardStates", []):
        if isinstance(state, dict):
            shift(state, "timeMs")
    for observation in result.get("semanticObservations", []):
        if isinstance(observation, dict):
            shift(observation, "startMs", "endMs")
    for embedding in result.get("videoEmbeddings", []):
        if isinstance(embedding, dict):
            shift(embedding, "startMs", "endMs")
    for entity in result.get("entities", []):
        if not isinstance(entity, dict) or not isinstance(entity.get("timestampsMs"), list):
            continue
        entity["timestampsMs"] = [
            round(float(timestamp)) + offset_ms
            for timestamp in entity["timestampsMs"]
            if isinstance(timestamp, (int, float))
        ]
