"""Lossless source-record compaction for the fixed benchmark answer writer."""
from .common import canonical


def compact_answer_evidence(document):
    seen = {}
    record_lists = {'evidence', 'readings', 'sourceReadings', 'observedSubjects', 'records'}

    def visit(value, field='', page=False):
        if isinstance(value, dict):
            return {key: visit(child, key) for key, child in value.items()
                    if not (page and key in {'ui', 'policy'})}
        if isinstance(value, list):
            result = []
            for item in value:
                # Keep repeated events distinct by their complete source record,
                # including time, identity, content, and any conflicting value.
                if field in record_lists and isinstance(item, dict) and any(
                    key in item for key in ('id', 'timeRange', 'startMs', 'startSecs', 'atSecs', 'range', 'appearances')
                ):
                    fingerprint = canonical(item)
                    if fingerprint in seen.setdefault(field, set()):
                        continue
                    seen[field].add(fingerprint)
                result.append(visit(item, page=field == 'pages'))
            return result
        return value

    return visit(document, page=True)
