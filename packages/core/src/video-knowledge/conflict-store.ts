import { randomUUID } from 'node:crypto';
import { mutateVideoKnowledgeState } from './store';
import type { EvidenceConflictRevision, EvidenceResolutionStatus } from './types';

/** Persist a conflict instead of allowing a newer derived claim to overwrite source evidence. */
export function recordVideoKnowledgeConflict(
  input: Omit<EvidenceConflictRevision, 'id' | 'schemaVersion' | 'createdAt' | 'status'> & {
    status?: EvidenceResolutionStatus;
  },
) {
  return mutateVideoKnowledgeState((state) => {
    const existing = state.conflicts.find(
      (conflict) =>
        conflict.knowledgeRevisionId === input.knowledgeRevisionId &&
        [...conflict.evidenceLineageIds].sort().join('|') ===
          [...input.evidenceLineageIds].sort().join('|') &&
        conflict.status !== 'resolved',
    );
    if (existing) return existing;
    const conflict: EvidenceConflictRevision = {
      ...input,
      id: randomUUID(),
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      status: input.status ?? 'conflicted',
    };
    state.conflicts.push(conflict);
    return conflict;
  });
}

/** Terminal conflicts never auto-retry; only an explicit scoped refinement can supersede them. */
export function setVideoKnowledgeConflictStatus(
  id: string,
  status: EvidenceResolutionStatus,
  resolutionReason?: EvidenceConflictRevision['resolutionReason'],
) {
  return mutateVideoKnowledgeState((state) => {
    const conflict = state.conflicts.find((candidate) => candidate.id === id);
    if (!conflict) return undefined;
    conflict.status = status;
    conflict.resolutionReason = resolutionReason;
    return conflict;
  });
}
