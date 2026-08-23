from __future__ import annotations

from typing import Any


def rebase_result_timestamps(result: dict[str, Any], offset_secs: float) -> None:
    """Translate clip-relative evidence to the original source-video clock."""
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
    for entity in result.get("entities", []):
        if not isinstance(entity, dict) or not isinstance(entity.get("timestampsMs"), list):
            continue
        entity["timestampsMs"] = [
            round(float(timestamp)) + offset_ms
            for timestamp in entity["timestampsMs"]
            if isinstance(timestamp, (int, float))
        ]
