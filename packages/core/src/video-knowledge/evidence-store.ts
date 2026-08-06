import { randomUUID } from 'node:crypto';
import { mutateVideoKnowledgeState, readVideoKnowledgeState } from './store';
import type {
  EvidenceRevision,
  FrameArtifactRevision,
  ObservationRevision,
  StateRevision,
  StateTransitionRevision,
  EventRevision,
  SceneRevision,
  EvidenceConflictRevision,
} from './types';

type RecordWithIdentity = { id: string; lineageId: string; createdAt: string };
function withIdentity<
  T extends Omit<RecordWithIdentity, 'id' | 'lineageId' | 'createdAt'> & { lineageId?: string },
>(record: T) {
  return {
    ...record,
    id: randomUUID(),
    lineageId: record.lineageId ?? randomUUID(),
    createdAt: new Date().toISOString(),
  } as T & RecordWithIdentity;
}

export function appendEvidence(
  record: Omit<EvidenceRevision, 'id' | 'lineageId' | 'createdAt' | 'schemaVersion'> & {
    lineageId?: string;
  },
) {
  return mutateVideoKnowledgeState((state) => {
    const value = { ...withIdentity(record), schemaVersion: 1 } as EvidenceRevision;
    state.evidence.push(value);
    return value;
  });
}
export function appendFrameArtifact(
  record: Omit<FrameArtifactRevision, 'id' | 'lineageId' | 'createdAt' | 'schemaVersion'> & {
    lineageId?: string;
  },
) {
  return mutateVideoKnowledgeState((state) => {
    const value = { ...withIdentity(record), schemaVersion: 1 } as FrameArtifactRevision;
    state.artifacts.push(value);
    return value;
  });
}
export function appendObservation(
  record: Omit<ObservationRevision, 'id' | 'lineageId' | 'createdAt' | 'schemaVersion'> & {
    lineageId?: string;
  },
) {
  return mutateVideoKnowledgeState((state) => {
    const value = { ...withIdentity(record), schemaVersion: 1 } as ObservationRevision;
    state.observations.push(value);
    return value;
  });
}
export function appendState(
  record: Omit<StateRevision, 'id' | 'lineageId' | 'createdAt' | 'schemaVersion'> & {
    lineageId?: string;
  },
) {
  return mutateVideoKnowledgeState((state) => {
    const value = { ...withIdentity(record), schemaVersion: 1 } as StateRevision;
    state.states.push(value);
    return value;
  });
}
export function appendStateTransition(
  record: Omit<StateTransitionRevision, 'id' | 'lineageId' | 'createdAt' | 'schemaVersion'> & {
    lineageId?: string;
  },
) {
  return mutateVideoKnowledgeState((state) => {
    const value = { ...withIdentity(record), schemaVersion: 1 } as StateTransitionRevision;
    state.transitions.push(value);
    return value;
  });
}
export function appendEvent(
  record: Omit<EventRevision, 'id' | 'lineageId' | 'createdAt' | 'schemaVersion'> & {
    lineageId?: string;
  },
) {
  return mutateVideoKnowledgeState((state) => {
    const value = { ...withIdentity(record), schemaVersion: 1 } as EventRevision;
    state.events.push(value);
    return value;
  });
}
export function appendScene(
  record: Omit<SceneRevision, 'id' | 'lineageId' | 'createdAt' | 'schemaVersion'> & {
    lineageId?: string;
  },
) {
  return mutateVideoKnowledgeState((state) => {
    const value = { ...withIdentity(record), schemaVersion: 1 } as SceneRevision;
    state.scenes.push(value);
    return value;
  });
}
export function appendEvidenceConflict(
  record: Omit<EvidenceConflictRevision, 'id' | 'createdAt' | 'schemaVersion'>,
) {
  return mutateVideoKnowledgeState((state) => {
    const value: EvidenceConflictRevision = {
      ...record,
      id: randomUUID(),
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
    };
    state.conflicts.push(value);
    return value;
  });
}
export async function listEvidenceForRevision(knowledgeRevisionId: string) {
  return (await readVideoKnowledgeState()).evidence.filter(
    (record) => record.knowledgeRevisionId === knowledgeRevisionId,
  );
}
