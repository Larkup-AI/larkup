import { randomUUID } from 'node:crypto';
import { mutateVideoKnowledgeState } from './store';
import type {
  Confidence,
  EvidenceModality,
  MetadataValue,
  SourceModelRef,
  TimeRange,
  VideoKnowledgeProjection,
  VideoObservationKind,
} from './types';

export interface LegacyMediaEvidenceSegment {
  text: string;
  transcript?: string;
  visualContext?: string;
  startSecs: number;
  endSecs: number;
  sequence: number;
}

export interface BuildVideoKnowledgeInput {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  segments: LegacyMediaEvidenceSegment[];
  projections: Array<{
    documentId: string;
    kind: VideoKnowledgeProjection['kind'];
    startSecs?: number;
    endSecs?: number;
  }>;
}

/** Provider output is converted to this strict, source-linked shape before persistence. */
export interface OfflineKnowledgeEvidenceInput {
  modality: EvidenceModality;
  timeRange: TimeRange;
  payload: MetadataValue;
  source: SourceModelRef;
  confidence: Confidence;
  frameArtifactIds?: string[];
  /** Optional typed observation supplied by a schema-validated adapter. */
  observation?: {
    kind: VideoObservationKind;
    value: MetadataValue;
    confidence?: Confidence;
  };
}

export interface BuildTypedVideoKnowledgeInput {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  evidence: OfflineKnowledgeEvidenceInput[];
  /** Semantic scene size is bounded and only used when continuity is unknown. */
  maximumSceneDurationSecs?: number;
}

const uncalibrated: Confidence = {
  score: 1,
  source: 'heuristic',
  calibrationStatus: 'uncalibrated',
  uncertaintyReasons: [
    'Legacy timeline evidence has not been calibrated against the video evaluation corpus.',
  ],
};

function textFromValue(value: MetadataValue): string {
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.text === 'string'
  ) {
    return value.text;
  }
  return JSON.stringify(value);
}

function isStateValue(value: MetadataValue): value is Record<string, MetadataValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Deterministically turns validated provider artifacts into evidence-linked
 * observations and timeline structures. It deliberately accepts no free-text
 * summary as a substitute for an artifact: every derived record retains the
 * evidence lineage that supports it.
 */
export function buildVideoKnowledgeFromEvidence(input: BuildTypedVideoKnowledgeInput) {
  return mutateVideoKnowledgeState((state) => {
    const now = new Date().toISOString();
    const maxSceneDuration = Math.max(30, input.maximumSceneDurationSecs ?? 300);
    const accepted = [...input.evidence]
      .filter(
        (item) =>
          Number.isFinite(item.timeRange.startSecs) && Number.isFinite(item.timeRange.endSecs),
      )
      .sort(
        (left, right) =>
          left.timeRange.startSecs - right.timeRange.startSecs ||
          left.timeRange.endSecs - right.timeRange.endSecs,
      );
    const evidence = accepted.map((item) => {
      const id = randomUUID();
      const lineageId = randomUUID();
      state.evidence.push({
        id,
        lineageId,
        mediaAssetId: input.mediaAssetId,
        knowledgeRevisionId: input.knowledgeRevisionId,
        modality: item.modality,
        timeRange: range(
          item.timeRange.startSecs,
          item.timeRange.endSecs,
          item.timeRange.precision,
        ),
        frameArtifactIds: item.frameArtifactIds,
        payload: item.payload,
        source: item.source,
        confidence: item.confidence,
        schemaVersion: 1,
        createdAt: now,
      });
      return { item, id, lineageId };
    });

    const observations: Array<{
      id: string;
      lineageId: string;
      evidenceLineageId: string;
      item: OfflineKnowledgeEvidenceInput;
    }> = [];
    for (const record of evidence) {
      const kind =
        record.item.observation?.kind ??
        (record.item.modality === 'transcript'
          ? 'speech'
          : record.item.modality === 'ocr'
          ? 'ocr'
          : record.item.modality === 'audio-event'
          ? 'audio-event'
          : record.item.modality === 'computed'
          ? 'computed'
          : 'state');
      const id = randomUUID();
      const lineageId = randomUUID();
      state.observations.push({
        id,
        lineageId,
        mediaAssetId: input.mediaAssetId,
        knowledgeRevisionId: input.knowledgeRevisionId,
        kind,
        timeRange: range(
          record.item.timeRange.startSecs,
          record.item.timeRange.endSecs,
          record.item.timeRange.precision,
        ),
        value: record.item.observation?.value ?? record.item.payload,
        evidenceLineageIds: [record.lineageId],
        confidence: record.item.observation?.confidence ?? record.item.confidence,
        schemaVersion: 1,
        createdAt: now,
      });
      observations.push({ id, lineageId, evidenceLineageId: record.lineageId, item: record.item });
    }

    // Explicit state records are accepted from validated UI/OCR/vision output.
    // Generic visual captions remain observations, avoiding invented properties.
    const previousByProperty = new Map<
      string,
      { id: string; value: MetadataValue; lineageId: string }
    >();
    for (const observation of observations) {
      const value = observation.item.observation?.value ?? observation.item.payload;
      if (!isStateValue(value)) continue;
      const subject = typeof value.subject === 'string' ? value.subject.trim() : '';
      const property = typeof value.property === 'string' ? value.property.trim() : '';
      if (!subject || !property || value.value === undefined) continue;
      const key = `${subject}\u0000${property}`;
      const previous = previousByProperty.get(key);
      const stateId = randomUUID();
      const stateLineageId = randomUUID();
      state.states.push({
        id: stateId,
        lineageId: stateLineageId,
        mediaAssetId: input.mediaAssetId,
        knowledgeRevisionId: input.knowledgeRevisionId,
        subject,
        property,
        value: value.value,
        timeRange: range(
          observation.item.timeRange.startSecs,
          observation.item.timeRange.endSecs,
          observation.item.timeRange.precision,
        ),
        previousStateId: previous?.id,
        evidenceLineageIds: [observation.evidenceLineageId],
        confidence: observation.item.observation?.confidence ?? observation.item.confidence,
        schemaVersion: 1,
        createdAt: now,
      });
      const conflictingState = state.states.find(
        (candidate) =>
          candidate.id !== stateId &&
          candidate.mediaAssetId === input.mediaAssetId &&
          candidate.subject === subject &&
          candidate.property === property &&
          candidate.timeRange.startSecs <= observation.item.timeRange.endSecs &&
          candidate.timeRange.endSecs >= observation.item.timeRange.startSecs &&
          JSON.stringify(candidate.value) !== JSON.stringify(value.value),
      );
      if (conflictingState) {
        const existing = state.conflicts.some(
          (conflict) =>
            conflict.knowledgeRevisionId === input.knowledgeRevisionId &&
            conflict.evidenceLineageIds.includes(observation.evidenceLineageId) &&
            conflict.evidenceLineageIds.some((lineageId) =>
              conflictingState.evidenceLineageIds.includes(lineageId),
            ),
        );
        if (!existing) {
          state.conflicts.push({
            id: randomUUID(),
            mediaAssetId: input.mediaAssetId,
            knowledgeRevisionId: input.knowledgeRevisionId,
            evidenceLineageIds: [
              ...new Set([...conflictingState.evidenceLineageIds, observation.evidenceLineageId]),
            ],
            affectedObservationLineageIds: [observation.lineageId],
            status: 'conflicted',
            schemaVersion: 1,
            createdAt: now,
          });
        }
      }
      if (previous && JSON.stringify(previous.value) !== JSON.stringify(value.value)) {
        const transitionLineageId = randomUUID();
        state.transitions.push({
          id: randomUUID(),
          lineageId: transitionLineageId,
          mediaAssetId: input.mediaAssetId,
          knowledgeRevisionId: input.knowledgeRevisionId,
          beforeStateId: previous.id,
          afterStateId: stateId,
          description: `${subject} ${property} changed from ${textFromValue(
            previous.value,
          )} to ${textFromValue(value.value)}.`,
          timeRange: range(
            observation.item.timeRange.startSecs,
            observation.item.timeRange.endSecs,
            observation.item.timeRange.precision,
          ),
          evidenceLineageIds: [observation.evidenceLineageId],
          confidence: observation.item.observation?.confidence ?? observation.item.confidence,
          schemaVersion: 1,
          createdAt: now,
        });
      }
      previousByProperty.set(key, { id: stateId, lineageId: stateLineageId, value: value.value });
    }

    // One event per direct artifact keeps temporal retrieval precise and lets
    // callers compose adjacent events without trusting a broad summary.
    const events = observations.map((observation) => {
      const item = observation.item;
      const transition = state.transitions.find(
        (candidate) =>
          candidate.knowledgeRevisionId === input.knowledgeRevisionId &&
          candidate.timeRange.startSecs === item.timeRange.startSecs &&
          candidate.evidenceLineageIds.includes(observation.evidenceLineageId),
      );
      const event = {
        id: randomUUID(),
        lineageId: randomUUID(),
        mediaAssetId: input.mediaAssetId,
        knowledgeRevisionId: input.knowledgeRevisionId,
        type: transition ? 'state-transition' : item.observation?.kind ?? item.modality,
        description:
          transition?.description ??
          textFromValue(item.observation?.value ?? item.payload).slice(0, 2_000),
        timeRange: range(
          item.timeRange.startSecs,
          item.timeRange.endSecs,
          item.timeRange.precision,
        ),
        evidenceLineageIds: [observation.evidenceLineageId],
        observationLineageIds: [observation.lineageId],
        transitionLineageIds: transition ? [transition.lineageId] : [],
        confidence: item.observation?.confidence ?? item.confidence,
        schemaVersion: 1 as const,
        createdAt: now,
      };
      state.events.push(event);
      return event;
    });

    // Scene boundaries use time continuity plus a bounded duration; they are
    // semantic containers, not FFmpeg-shot identities.
    const sceneGroups: (typeof events)[] = [];
    for (const event of events) {
      const group = sceneGroups.at(-1);
      if (
        !group ||
        event.timeRange.startSecs - group.at(-1)!.timeRange.endSecs > 15 ||
        event.timeRange.endSecs - group[0].timeRange.startSecs > maxSceneDuration
      ) {
        sceneGroups.push([event]);
      } else {
        group.push(event);
      }
    }
    const scenes = sceneGroups.map((group, index) => {
      const scene = {
        id: randomUUID(),
        lineageId: randomUUID(),
        mediaAssetId: input.mediaAssetId,
        knowledgeRevisionId: input.knowledgeRevisionId,
        title: `Scene ${index + 1}: ${eventsDescription(group).slice(0, 120)}`,
        timeRange: range(
          group[0].timeRange.startSecs,
          group.at(-1)!.timeRange.endSecs,
          group.some((event) => event.timeRange.precision === 'estimated')
            ? 'estimated'
            : 'segment',
        ),
        eventLineageIds: group.map((event) => event.lineageId),
        evidenceLineageIds: group.flatMap((event) => event.evidenceLineageIds),
        quality: { ...uncalibrated, coverage: 1 },
        capabilities: [...new Set(group.map((event) => `larkup:${event.type}`))],
        schemaVersion: 1 as const,
        createdAt: now,
      };
      state.scenes.push(scene);
      return scene;
    });
    const chapterSize = 6;
    for (let start = 0; start < scenes.length; start += chapterSize) {
      const group = scenes.slice(start, start + chapterSize);
      state.chapters.push({
        id: randomUUID(),
        lineageId: randomUUID(),
        mediaAssetId: input.mediaAssetId,
        knowledgeRevisionId: input.knowledgeRevisionId,
        title: `Chapter ${Math.floor(start / chapterSize) + 1}: ${group[0].title.slice(0, 120)}`,
        timeRange: range(group[0].timeRange.startSecs, group.at(-1)!.timeRange.endSecs, 'segment'),
        sceneLineageIds: group.map((scene) => scene.lineageId),
        eventLineageIds: group.flatMap((scene) => scene.eventLineageIds),
        evidenceLineageIds: group.flatMap((scene) => scene.evidenceLineageIds),
        quality: { ...uncalibrated, coverage: 1 },
        schemaVersion: 1,
        createdAt: now,
      });
    }
    return {
      evidenceIds: evidence.map((item) => item.id),
      evidenceLineageIds: evidence.map((item) => item.lineageId),
      observationIds: observations.map((item) => item.id),
      observationLineageIds: observations.map((item) => item.lineageId),
      eventIds: events.map((item) => item.id),
      sceneIds: scenes.map((item) => item.id),
    };
  });
}

function range(startSecs: number, endSecs: number, precision: TimeRange['precision']): TimeRange {
  return { startSecs: Math.max(0, startSecs), endSecs: Math.max(startSecs, endSecs), precision };
}

function eventsDescription(events: Array<{ description: string }>) {
  return (
    events
      .map((event) => event.description)
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Timeline evidence'
  );
}

/**
 * Converts the existing timestamped media pipeline into immutable evidence.
 * It is intentionally deterministic: model-generated summaries remain a
 * projection and never become the sole source for an observation.
 */
export function buildVideoKnowledgeFromSegments(input: BuildVideoKnowledgeInput) {
  return mutateVideoKnowledgeState((state) => {
    const now = new Date().toISOString();
    const evidenceIdsBySegment = new Map<number, string[]>();
    const observationIdsBySegment = new Map<number, string[]>();
    let previousVisualState: { id: string; lineageId: string; value: string } | undefined;

    for (const segment of input.segments) {
      const evidenceIds: string[] = [];
      const observationIds: string[] = [];
      const addEvidence = (
        modality: 'transcript' | 'visual',
        text: string,
        precision: TimeRange['precision'],
      ) => {
        if (!text.trim()) return;
        const id = randomUUID();
        const lineageId = randomUUID();
        state.evidence.push({
          id,
          lineageId,
          mediaAssetId: input.mediaAssetId,
          knowledgeRevisionId: input.knowledgeRevisionId,
          modality,
          timeRange: range(segment.startSecs, segment.endSecs, precision),
          payload: { text },
          source: { kind: 'provider' },
          confidence: uncalibrated,
          schemaVersion: 1,
          createdAt: now,
        });
        evidenceIds.push(id);
        const observationId = randomUUID();
        state.observations.push({
          id: observationId,
          lineageId: randomUUID(),
          mediaAssetId: input.mediaAssetId,
          knowledgeRevisionId: input.knowledgeRevisionId,
          kind: modality === 'transcript' ? 'speech' : 'state',
          timeRange: range(segment.startSecs, segment.endSecs, precision),
          value: { text },
          evidenceLineageIds: [lineageId],
          confidence: uncalibrated,
          schemaVersion: 1,
          createdAt: now,
        });
        observationIds.push(observationId);
      };
      addEvidence('transcript', segment.transcript ?? '', 'segment');
      addEvidence('visual', segment.visualContext ?? '', 'estimated');
      evidenceIdsBySegment.set(segment.sequence, evidenceIds);
      observationIdsBySegment.set(segment.sequence, observationIds);
      if (evidenceIds.length > 0) {
        state.events.push({
          id: randomUUID(),
          lineageId: randomUUID(),
          mediaAssetId: input.mediaAssetId,
          knowledgeRevisionId: input.knowledgeRevisionId,
          type: 'timeline-observation',
          description: segment.text.slice(0, 2_000),
          timeRange: range(segment.startSecs, segment.endSecs, 'segment'),
          evidenceLineageIds: state.evidence
            .filter((evidence) => evidenceIds.includes(evidence.id))
            .map((evidence) => evidence.lineageId),
          observationLineageIds: state.observations
            .filter((observation) => observationIds.includes(observation.id))
            .map((observation) => observation.lineageId),
          transitionLineageIds: [],
          confidence: uncalibrated,
          schemaVersion: 1,
          createdAt: now,
        });
      }
      if (segment.visualContext?.trim()) {
        const visualValue = segment.visualContext.trim();
        const stateId = randomUUID();
        const stateLineageId = randomUUID();
        const visualEvidence = state.evidence.find(
          (item) =>
            item.id ===
            evidenceIds.find(
              (id) =>
                state.evidence.find((candidate) => candidate.id === id)?.modality === 'visual',
            ),
        );
        state.states.push({
          id: stateId,
          lineageId: stateLineageId,
          mediaAssetId: input.mediaAssetId,
          knowledgeRevisionId: input.knowledgeRevisionId,
          subject: 'video',
          property: 'visual-context',
          value: { text: visualValue },
          timeRange: range(segment.startSecs, segment.endSecs, 'estimated'),
          previousStateId: previousVisualState?.id,
          evidenceLineageIds: visualEvidence ? [visualEvidence.lineageId] : [],
          confidence: uncalibrated,
          schemaVersion: 1,
          createdAt: now,
        });
        if (previousVisualState && previousVisualState.value !== visualValue) {
          state.transitions.push({
            id: randomUUID(),
            lineageId: randomUUID(),
            mediaAssetId: input.mediaAssetId,
            knowledgeRevisionId: input.knowledgeRevisionId,
            beforeStateId: previousVisualState.id,
            afterStateId: stateId,
            description: 'Visual context changed.',
            timeRange: range(segment.startSecs, segment.endSecs, 'estimated'),
            evidenceLineageIds: visualEvidence ? [visualEvidence.lineageId] : [],
            confidence: uncalibrated,
            schemaVersion: 1,
            createdAt: now,
          });
        }
        previousVisualState = { id: stateId, lineageId: stateLineageId, value: visualValue };
      }
    }

    for (const segment of input.segments) {
      const evidenceIds = evidenceIdsBySegment.get(segment.sequence) ?? [];
      if (evidenceIds.length === 0) continue;
      state.scenes.push({
        id: randomUUID(),
        lineageId: randomUUID(),
        mediaAssetId: input.mediaAssetId,
        knowledgeRevisionId: input.knowledgeRevisionId,
        title: `Timeline ${segment.sequence + 1}`,
        timeRange: range(segment.startSecs, segment.endSecs, 'segment'),
        eventLineageIds: state.events
          .filter(
            (event) =>
              event.knowledgeRevisionId === input.knowledgeRevisionId &&
              event.timeRange.startSecs === segment.startSecs,
          )
          .map((event) => event.lineageId),
        evidenceLineageIds: state.evidence
          .filter((evidence) => evidenceIds.includes(evidence.id))
          .map((evidence) => evidence.lineageId),
        quality: uncalibrated,
        capabilities: [
          ...(segment.transcript?.trim() ? ['larkup:transcript'] : []),
          ...(segment.visualContext?.trim() ? ['larkup:visual'] : []),
        ],
        schemaVersion: 1,
        createdAt: now,
      });
    }

    const evidenceForProjection = (start?: number, end?: number) =>
      state.evidence.filter(
        (evidence) =>
          evidence.knowledgeRevisionId === input.knowledgeRevisionId &&
          (start === undefined || evidence.timeRange.endSecs >= start) &&
          (end === undefined || evidence.timeRange.startSecs <= end),
      );
    const projectionIds: string[] = [];
    for (const projectionInput of input.projections) {
      const evidence = evidenceForProjection(projectionInput.startSecs, projectionInput.endSecs);
      const projectionId = randomUUID();
      state.projections.push({
        id: projectionId,
        mediaAssetId: input.mediaAssetId,
        knowledgeRevisionId: input.knowledgeRevisionId,
        kind: projectionInput.kind,
        documentId: projectionInput.documentId,
        lineageIds: evidence.map((item) => item.lineageId),
        evidenceIds: evidence.map((item) => item.id),
        timeRange:
          projectionInput.startSecs === undefined
            ? undefined
            : range(
                projectionInput.startSecs,
                projectionInput.endSecs ?? projectionInput.startSecs,
                'segment',
              ),
        quality: uncalibrated,
        active: false,
        schemaVersion: 1,
        createdAt: now,
      });
      projectionIds.push(projectionId);
    }
    const evidence = state.evidence.filter(
      (item) => item.knowledgeRevisionId === input.knowledgeRevisionId,
    );
    return {
      evidenceCount: evidence.length,
      projectionIds,
      activeEvidenceRevisionIds: Object.fromEntries(
        evidence.map((item) => [item.lineageId, item.id]),
      ),
      activeObservationRevisionIds: Object.fromEntries(
        state.observations
          .filter((item) => item.knowledgeRevisionId === input.knowledgeRevisionId)
          .map((item) => [item.lineageId, item.id]),
      ),
    };
  });
}
