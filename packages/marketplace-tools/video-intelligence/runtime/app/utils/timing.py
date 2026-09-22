from __future__ import annotations

from typing import Any, Iterable


FULL_SOURCE_VISUAL_SAMPLE_BUDGET = {
    "fast": 240,
    "balanced": 480,
    "thorough": 720,
}

FULL_SOURCE_OCR_SAMPLE_BUDGET = {
    "fast": 90,
    "balanced": 180,
    "thorough": 300,
}


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
    base_intervals = {"fast": 5.0, "balanced": 2.0, "thorough": 0.75}
    max_samples = {"fast": 360, "balanced": 720, "thorough": 1_800}
    return max(base_intervals[mode], duration_seconds / max_samples[mode])


def bounded_visual_sampling_intervals(
    mode: str,
    covered_duration_secs: float,
    sample_interval_secs: float,
    priority_sample_interval_secs: float,
    priority_ranges: Iterable[tuple[float, float]],
) -> tuple[float, float]:
    """Caps a full-source navigation pass while preserving priority detail.

    A first index is a searchable map, not a substitute for the later bounded
    close-read. The cap is expressed only in source duration and user-selected
    mode, so it applies equally to every language and video subject.
    """
    budget = FULL_SOURCE_VISUAL_SAMPLE_BUDGET.get(mode, FULL_SOURCE_VISUAL_SAMPLE_BUDGET["balanced"])
    duration = max(0.001, float(covered_duration_secs))
    priority_duration = sum(
        max(0.0, min(duration, float(end)) - max(0.0, float(start)))
        for start, end in priority_ranges
    )
    priority_budget = max(1, round(budget * 0.25)) if priority_duration > 0 else 0
    base_budget = max(1, budget - priority_budget)
    bounded_sample = max(float(sample_interval_secs), duration / base_budget)
    bounded_priority = max(
        float(priority_sample_interval_secs),
        priority_duration / priority_budget if priority_budget else 0.0,
    )
    return bounded_sample, min(bounded_sample, bounded_priority)


def ocr_sampling_interval(
    mode: str,
    covered_duration_secs: float,
    frame_sample_interval_secs: float,
) -> float:
    """Keeps OCR navigable without making every visual sample a text pass."""
    budget = FULL_SOURCE_OCR_SAMPLE_BUDGET.get(mode, FULL_SOURCE_OCR_SAMPLE_BUDGET["balanced"])
    return max(
        float(frame_sample_interval_secs),
        max(0.001, float(covered_duration_secs)) / budget,
    )


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
    ledger = result.get("anonymousPresenceLedger")
    if isinstance(ledger, dict):
        for track in ledger.get("tracks", []):
            if not isinstance(track, dict):
                continue
            shift(track, "startMs", "endMs")
            if isinstance(track.get("timestampsMs"), list):
                track["timestampsMs"] = [
                    round(float(timestamp)) + offset_ms
                    for timestamp in track["timestampsMs"]
                    if isinstance(timestamp, (int, float))
                ]
        for label in ledger.get("labels", []):
            if isinstance(label, dict) and isinstance(label.get("simultaneousTimestampsMs"), list):
                label["simultaneousTimestampsMs"] = [
                    round(float(timestamp)) + offset_ms
                    for timestamp in label["simultaneousTimestampsMs"]
                    if isinstance(timestamp, (int, float))
                ]
    for overlay in result.get("recurringOverlayText", []):
        if not isinstance(overlay, dict):
            continue
        shift(overlay, "firstSeenMs", "lastSeenMs")
        if isinstance(overlay.get("timestampsMs"), list):
            overlay["timestampsMs"] = [
                round(float(timestamp)) + offset_ms
                for timestamp in overlay["timestampsMs"]
                if isinstance(timestamp, (int, float))
            ]
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

    # Knowledge synthesis runs while a bounded source is still on its local
    # clip clock. Its citations are persisted alongside raw evidence, so they
    # must be translated by the same offset before a refinement is searchable.
    summary = result.get("knowledgeSummary")
    if not isinstance(summary, dict):
        return
    for key in ("stateHistory", "keyEvents", "narrative"):
        for item in summary.get(key, []):
            if isinstance(item, dict):
                shift(item, "startMs", "endMs")
    for key in ("participants", "context"):
        for item in summary.get(key, []):
            if not isinstance(item, dict):
                continue
            for evidence in item.get("evidence", []):
                if isinstance(evidence, dict):
                    shift(evidence, "startMs", "endMs")
    for subject in summary.get("visibleSubjects", []):
        if not isinstance(subject, dict):
            continue
        for appearance in subject.get("appearances", []):
            if isinstance(appearance, dict):
                shift(appearance, "startMs", "endMs")
