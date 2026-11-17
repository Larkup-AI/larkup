"""Bounded source navigation from observed on-screen labels, without answer labels."""
import re
import unicodedata
from collections import Counter


def anchor_key(text):
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', str(text)).casefold())


def ocr_notes(raw):
    notes = []
    for observation in raw.get('visualObservations') or []:
        at = observation.get('timeMs')
        if not isinstance(at, (int, float)):
            continue
        lines = [str(line.get('text') or '') for line in observation.get('ocr') or []
                 if isinstance(line, dict) and float(line.get('confidence') or 0) >= .5]
        if lines:
            notes.append({'startMs': at, 'endMs': at, 'text': '\n'.join(lines), 'modality': 'ocr'})
    return notes


def quoted_anchor_windows(notes, anchors, duration=None):
    anchors = list(dict.fromkeys(a for a in anchors if a))
    if len(anchors) < 2:
        return []
    events = sorted((note['startMs'] / 1000, index) for note in notes
                    for index, anchor in enumerate(anchors) if anchor in anchor_key(note['text']))
    counts, left, candidates = Counter(), 0, []
    for right, (at, index) in enumerate(events):
        counts[index] += 1
        while len(counts) == len(anchors):
            start = events[left][0]
            if at - start <= 60:
                padding = min(8, (60 - (at - start)) / 2)
                candidates.append({'startSecs': max(0, start - padding),
                                   'endSecs': min(duration or at + padding, at + padding)})
            old = events[left][1]
            counts[old] -= 1
            if not counts[old]: del counts[old]
            left += 1
    result = []
    for window in sorted(candidates, key=lambda w: (w['endSecs'] - w['startSecs'], w['startSecs'])):
        if window['endSecs'] <= window['startSecs'] or any(
            window['startSecs'] < prior['endSecs'] and window['endSecs'] > prior['startSecs'] for prior in result
        ):
            continue
        result.append(window)
        if len(result) == 4: break
    return result
