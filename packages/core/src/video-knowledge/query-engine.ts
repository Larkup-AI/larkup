import { getCachedArtifactAnalysis, saveCachedArtifactAnalysis } from './artifact-cache-store';
import { evidenceTextForRetrieval } from './evidence-text';
import { readVideoKnowledgeState } from './store';
import type { EvidenceRevision, MetadataValue, TimeRange, VideoKnowledgeStoreState } from './types';

export type VideoKnowledgeScanKind = 'source-inventory' | 'all-evidence';

export interface VideoKnowledgeScanRecord {
  id: string;
  sourceEvidenceId: string;
  kind:
    | 'question'
    | 'clue'
    | 'heading'
    | 'slide-item'
    | 'board-item'
    | 'list-item'
    | 'structure'
    | 'evidence';
  channel?: 'spoken' | 'visible';
  questionRole?: 'primary' | 'interactional' | 'rhetorical';
  taskId?: string;
  promptSlots?: number;
  text: string;
  answer?: string;
  respondent?: string;
  timeRange: TimeRange;
  modality: EvidenceRevision['modality'];
  confidence: EvidenceRevision['confidence'];
}

export interface VideoKnowledgeScanPage {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  kind: VideoKnowledgeScanKind;
  resultHandle: string;
  records: VideoKnowledgeScanRecord[];
  continuation: {
    cursor: number;
    nextCursor?: number;
    hasMore: boolean;
    totalRecords: number;
  };
  coverage: {
    complete: boolean;
    scannedRecords: number;
    totalRecords: number;
    reason?: string;
  };
}

export interface VideoKnowledgeAggregate {
  mediaAssetId: string;
  knowledgeRevisionId: string;
  resultHandle: string;
  cached: boolean;
  participants: Array<{ name: string; description: string; timeRange: TimeRange }>;
  /**
   * Frame-grounded sightings consolidated by the indexing protocol. These are
   * observed intervals, not inferred continuous screen time between samples.
   */
  visibleSubjects: Array<{
    identity: string;
    identityBasis: 'source-named' | 'source-described' | 'unresolved';
    appearances: TimeRange[];
    observedDurationSecs: number;
    observationCount: number;
  }>;
  timeline: Array<{ text: string; timeRange: TimeRange }>;
  sourceItems: VideoKnowledgeScanRecord[];
  coverage: {
    inventoryComplete: boolean;
    activeEvidenceRecords: number;
  };
}

function activeManifest(state: VideoKnowledgeStoreState, mediaAssetId: string) {
  return state.manifests
    .filter((item) => item.mediaAssetId === mediaAssetId && item.activatedAt)
    .sort((left, right) => right.activatedAt!.localeCompare(left.activatedAt!))[0];
}

function activeEvidence(state: VideoKnowledgeStoreState, mediaAssetId: string) {
  const manifest = activeManifest(state, mediaAssetId);
  if (!manifest) return { manifest: undefined, evidence: [] as EvidenceRevision[] };
  const ids = new Set(Object.values(manifest.activeEvidenceRevisionIds));
  return {
    manifest,
    evidence: state.evidence
      .filter((item) => item.mediaAssetId === mediaAssetId && ids.has(item.id))
      .sort(
        (left, right) =>
          left.timeRange.startSecs - right.timeRange.startSecs ||
          left.timeRange.endSecs - right.timeRange.endSecs ||
          left.id.localeCompare(right.id),
      ),
  };
}

function sourceInventoryRecords(evidence: EvidenceRevision): VideoKnowledgeScanRecord[] {
  const lines = evidenceTextForRetrieval(evidence.payload)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const records: VideoKnowledgeScanRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const question = line.match(
      /^(?:Source question \((spoken|visible)(?:,\s*(primary|interactional|rhetorical))?\)|Question):\s*(.+)$/iu,
    );
    const sourceItem = line.match(
      /^Source item \((clue|heading|slide-item|board-item|list-item),\s*(spoken|visible)\):\s*(.+)$/iu,
    );
    const structure = line.match(/^Source structure \((grid|sequence|collection)\):\s*(.+)$/iu);
    if (!question && !sourceItem && !structure) continue;
    let answer: string | undefined;
    let respondent: string | undefined;
    let dimensions: string | undefined;
    let promptSlots: number | undefined;
    let taskId: string | undefined;
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 4); cursor += 1) {
      const candidate = lines[cursor]!;
      if (/^(?:Source question \(|Question:|Source item \(|Source structure \()/iu.test(candidate))
        break;
      const answerMatch = candidate.match(/^(?:Source answer|Answer):\s*(.+)$/iu);
      const respondentMatch = candidate.match(/^(?:Source respondent|Answered by):\s*(.+)$/iu);
      const dimensionsMatch = candidate.match(/^Source dimensions:\s*(.+)$/iu);
      const promptSlotsMatch = candidate.match(/^Source prompt slots:\s*(\d+)\s*$/iu);
      const taskIdMatch = candidate.match(/^Source task id:\s*(\S.{0,239})$/iu);
      if (answerMatch) answer = answerMatch[1]!.trim();
      if (respondentMatch) respondent = respondentMatch[1]!.trim();
      if (dimensionsMatch) dimensions = dimensionsMatch[1]!.trim();
      if (promptSlotsMatch) promptSlots = Number(promptSlotsMatch[1]);
      if (taskIdMatch) taskId = taskIdMatch[1]!.trim();
    }
    const isQuestion = Boolean(question);
    records.push({
      id: `${evidence.id}:inventory:${index}`,
      sourceEvidenceId: evidence.id,
      kind: isQuestion
        ? 'question'
        : structure
          ? 'structure'
          : (sourceItem![1] as VideoKnowledgeScanRecord['kind']),
      ...(isQuestion || sourceItem
        ? { channel: (question?.[1] ?? sourceItem?.[2]) as 'spoken' | 'visible' }
        : {}),
      ...(isQuestion
        ? {
            questionRole:
              (question?.[2] as VideoKnowledgeScanRecord['questionRole'] | undefined) ?? 'primary',
          }
        : {}),
      ...(isQuestion && taskId ? { taskId } : {}),
      ...(structure && promptSlots !== undefined && Number.isSafeInteger(promptSlots)
        ? { promptSlots }
        : {}),
      text: `${question?.[3] ?? sourceItem?.[3] ?? structure?.[2] ?? ''}${
        dimensions ? `\n${dimensions}` : ''
      }`.trim(),
      ...(answer ? { answer } : {}),
      ...(respondent ? { respondent } : {}),
      timeRange: evidence.timeRange,
      modality: evidence.modality,
      confidence: evidence.confidence,
    });
  }
  return records;
}

const INVENTORY_DUPLICATE_WINDOW_SECS = 120;

function inventoryIdentity(record: VideoKnowledgeScanRecord) {
  return `${record.kind}\u0000${record.channel ?? ''}\u0000${record.taskId ?? ''}\u0000${record.text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()}`;
}

function moreInformative(left: string | undefined, right: string | undefined) {
  const first = left?.trim() ?? '';
  const second = right?.trim() ?? '';
  return second.length > first.length ? second : first || undefined;
}

/**
 * Source inventory windows overlap so an utterance or a held title can occur
 * in adjacent readings. Collapse only nearby identical records; a genuine
 * repeat later in the source remains an independently timestamped item.
 */
function collapseSourceInventoryRecords(records: VideoKnowledgeScanRecord[]) {
  const previousByIdentity = new Map<string, number>();
  const collapsed: VideoKnowledgeScanRecord[] = [];
  for (const record of records) {
    const identity = inventoryIdentity(record);
    const previousIndex = previousByIdentity.get(identity);
    const previous = previousIndex === undefined ? undefined : collapsed[previousIndex];
    if (
      previous &&
      record.timeRange.startSecs - previous.timeRange.endSecs <= INVENTORY_DUPLICATE_WINDOW_SECS
    ) {
      previous.answer = moreInformative(previous.answer, record.answer);
      previous.respondent = moreInformative(previous.respondent, record.respondent);
      previous.timeRange = {
        ...previous.timeRange,
        endSecs: Math.max(previous.timeRange.endSecs, record.timeRange.endSecs),
      };
      continue;
    }
    previousByIdentity.set(identity, collapsed.length);
    collapsed.push({ ...record });
  }
  return collapsed;
}

function inventoryCoverage(evidence: EvidenceRevision[]) {
  const marker = evidence
    .map((item) => evidenceTextForRetrieval(item.payload))
    .find((text) => /^Source inventory coverage:\s*(complete|partial)\b/imu.test(text));
  if (!marker) {
    return {
      complete: false,
      reason: 'The active index has no complete-source inventory marker.',
    };
  }
  const complete = /^Source inventory coverage:\s*complete\b/imu.test(marker);
  return {
    complete,
    ...(complete ? {} : { reason: 'One or more source windows could not be inventoried.' }),
  };
}

/**
 * Deterministically pages active evidence in chronological order. It never
 * ranks candidates, so a full-source request cannot silently become Top-K.
 */
export async function scanVideoKnowledge(
  mediaAssetId: string,
  input: { kind: VideoKnowledgeScanKind; cursor?: number; limit?: number },
): Promise<VideoKnowledgeScanPage | undefined> {
  const { manifest, evidence } = activeEvidence(await readVideoKnowledgeState(), mediaAssetId);
  if (!manifest) return undefined;
  const records =
    input.kind === 'source-inventory'
      ? collapseSourceInventoryRecords(evidence.flatMap(sourceInventoryRecords))
      : evidence.map((item) => ({
          id: item.id,
          sourceEvidenceId: item.id,
          kind: 'evidence' as const,
          text: evidenceTextForRetrieval(item.payload),
          timeRange: item.timeRange,
          modality: item.modality,
          confidence: item.confidence,
        }));
  const cursor = Math.max(0, Math.min(records.length, Math.floor(input.cursor ?? 0)));
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 48)));
  const page = records.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length;
  const coverage = inventoryCoverage(evidence);
  return {
    mediaAssetId,
    knowledgeRevisionId: manifest.knowledgeRevisionId,
    kind: input.kind,
    resultHandle: `video-scan:v1:${manifest.knowledgeRevisionId}:${input.kind}`,
    records: page,
    continuation: {
      cursor,
      ...(nextCursor < records.length ? { nextCursor } : {}),
      hasMore: nextCursor < records.length,
      totalRecords: records.length,
    },
    coverage: {
      // Enumerating the active index is exact, but a complete-source answer
      // still needs the runtime's explicit proof that every source window was
      // inventoried. Older/partial indexes remain useful evidence, never a
      // silently complete recording.
      complete: coverage.complete,
      scannedRecords: page.length,
      totalRecords: records.length,
      ...(coverage.reason ? { reason: coverage.reason } : {}),
    },
  };
}

function isAggregate(value: MetadataValue): value is Record<string, MetadataValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

type VisibleSubjectBasis = 'source-named' | 'source-described' | 'unresolved';
type VisibleSubjectObservation = {
  identity: string;
  identityBasis: VisibleSubjectBasis;
  timeRange: TimeRange;
};

const visibleSubjectBases = new Set<VisibleSubjectBasis>([
  'source-named',
  'source-described',
  'unresolved',
]);

/**
 * Read the indexing protocol, not prose or question vocabulary. Both the
 * per-frame protocol line and the reconciled summary are accepted so an
 * active revision remains useful across indexer versions.
 */
function visibleSubjectObservations(evidence: EvidenceRevision[]): VisibleSubjectObservation[] {
  const observations: VisibleSubjectObservation[] = [];
  for (const item of evidence) {
    const text = evidenceTextForRetrieval(item.payload);
    for (const line of text.split(/\r?\n/)) {
      const value = line.trim();
      if (!value.startsWith('Visible subject: ')) continue;
      try {
        const subject = JSON.parse(value.slice('Visible subject: '.length)) as {
          identity?: unknown;
          identityBasis?: unknown;
          startMs?: unknown;
          endMs?: unknown;
        };
        const identity = typeof subject.identity === 'string' ? subject.identity.trim() : '';
        const basis = subject.identityBasis;
        const startSecs = Number(subject.startMs) / 1_000;
        const endSecs = Number(subject.endMs) / 1_000;
        if (
          identity &&
          typeof basis === 'string' &&
          visibleSubjectBases.has(basis as VisibleSubjectBasis) &&
          Number.isFinite(startSecs) &&
          Number.isFinite(endSecs) &&
          startSecs >= 0 &&
          endSecs >= startSecs
        ) {
          observations.push({
            identity,
            identityBasis: basis as VisibleSubjectBasis,
            timeRange: { startSecs, endSecs, precision: 'estimated' },
          });
        }
      } catch {
        // A malformed protocol record cannot establish a sighting.
      }
    }

    const summary = text.match(
      /^Reconciled visible subject:\s*([^\n]+)\nIdentity basis:\s*(source-named|source-described|unresolved)\nObserved appearances:\s*([^\n]+)/imu,
    );
    if (!summary) continue;
    const identity = summary[1]!.trim();
    const identityBasis = summary[2]! as VisibleSubjectBasis;
    for (const appearance of summary[3]!.matchAll(/(\d+)-(\d+)ms\s*\((?:direct|partial)\)/gu)) {
      const startSecs = Number(appearance[1]) / 1_000;
      const endSecs = Number(appearance[2]) / 1_000;
      if (
        !identity ||
        !Number.isFinite(startSecs) ||
        !Number.isFinite(endSecs) ||
        endSecs < startSecs
      )
        continue;
      observations.push({
        identity,
        identityBasis,
        timeRange: { startSecs, endSecs, precision: 'estimated' },
      });
    }
  }
  return observations;
}

function mergeObservedRanges(ranges: TimeRange[]) {
  const merged: TimeRange[] = [];
  for (const range of [...ranges].sort(
    (left, right) => left.startSecs - right.startSecs || left.endSecs - right.endSecs,
  )) {
    const previous = merged.at(-1);
    if (previous && range.startSecs <= previous.endSecs) {
      previous.endSecs = Math.max(previous.endSecs, range.endSecs);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function aggregateVisibleSubjects(evidence: EvidenceRevision[]) {
  const byIdentity = new Map<string, VisibleSubjectObservation[]>();
  for (const observation of visibleSubjectObservations(evidence)) {
    const key = observation.identity.normalize('NFKC').toLocaleLowerCase();
    const group = byIdentity.get(key) ?? [];
    group.push(observation);
    byIdentity.set(key, group);
  }
  return [...byIdentity.values()]
    .map((observations) => {
      const sourceNamed = observations.find(
        (observation) => observation.identityBasis === 'source-named',
      );
      const identity = sourceNamed?.identity ?? observations[0]!.identity;
      const identityBasis: VisibleSubjectBasis = sourceNamed
        ? 'source-named'
        : observations.some((observation) => observation.identityBasis === 'source-described')
          ? 'source-described'
          : 'unresolved';
      const appearances = mergeObservedRanges(
        observations.map((observation) => observation.timeRange),
      );
      return {
        identity,
        identityBasis,
        appearances,
        observedDurationSecs: appearances.reduce(
          (total, range) => total + range.endSecs - range.startSecs,
          0,
        ),
        observationCount: observations.length,
      };
    })
    .sort((left, right) => left.appearances[0]!.startSecs - right.appearances[0]!.startSecs)
    .slice(0, 200);
}

/**
 * Builds a compact, revision-scoped navigation result from all active
 * evidence, then retains it outside the chat context as an artifact result.
 */
export async function aggregateVideoKnowledge(
  mediaAssetId: string,
): Promise<VideoKnowledgeAggregate | undefined> {
  const state = await readVideoKnowledgeState();
  const { manifest, evidence } = activeEvidence(state, mediaAssetId);
  if (!manifest) return undefined;
  // Bump the derived-artifact version when identity extraction changes so
  // existing indexed media receives the improved aggregate without re-indexing.
  const resultHandle = `video-aggregate:v3:${manifest.knowledgeRevisionId}`;
  const cached = await getCachedArtifactAnalysis(mediaAssetId, resultHandle);
  if (cached && isAggregate(cached)) {
    return { ...(cached as unknown as VideoKnowledgeAggregate), cached: true };
  }

  const participants = new Map<
    string,
    { name: string; description: string; timeRange: TimeRange }
  >();
  const timeline: VideoKnowledgeAggregate['timeline'] = [];
  for (const item of evidence) {
    const text = evidenceTextForRetrieval(item.payload);
    for (const pattern of [
      /^(?:Reconciled |Indexed )?participant:\s*([^—\n]{1,120})\s*—\s*([^\n]+)/gimu,
      /^Present:\s*([^—\n]{1,120})\s*—\s*([^\n]+)/gimu,
    ]) {
      for (const match of text.matchAll(pattern)) {
        const name = match[1]!.trim();
        const description = match[2]!.trim();
        const key = name.normalize('NFKC').toLocaleLowerCase();
        if (name && !participants.has(key)) {
          participants.set(key, { name, description, timeRange: item.timeRange });
        }
      }
    }
    for (const line of text.split(/\r?\n/)) {
      const value = line.trim();
      if (/^(?:Reconciled |Indexed |Chronological note:)/iu.test(value) && value.length > 12) {
        timeline.push({ text: value.slice(0, 800), timeRange: item.timeRange });
      }
    }
  }
  const sourceItems = evidence.flatMap(sourceInventoryRecords);
  const inventory = inventoryCoverage(evidence);
  const aggregate: VideoKnowledgeAggregate = {
    mediaAssetId,
    knowledgeRevisionId: manifest.knowledgeRevisionId,
    resultHandle,
    cached: false,
    participants: [...participants.values()].slice(0, 200),
    visibleSubjects: aggregateVisibleSubjects(evidence),
    timeline: timeline.slice(0, 400),
    sourceItems: sourceItems.slice(0, 2_000),
    coverage: {
      inventoryComplete: inventory.complete,
      activeEvidenceRecords: evidence.length,
    },
  };
  await saveCachedArtifactAnalysis({
    key: resultHandle,
    mediaAssetId,
    knowledgeRevisionId: manifest.knowledgeRevisionId,
    operation: 'video-aggregate-v1',
    value: aggregate as unknown as MetadataValue,
  });
  return aggregate;
}
