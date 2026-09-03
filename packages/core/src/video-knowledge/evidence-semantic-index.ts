import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getProjectDataDir, requireProjectDataDir } from '../project-store';
import { readConfig } from '../config-store';
import { embedQuery, embedTexts } from '../indexing/embedder';
import { readVideoKnowledgeState } from './store';
import type { EvidenceModality, EvidenceRevision } from './types';
import { evidenceClaimVerdict, evidenceTextForRetrieval } from './evidence-text';

/**
 * Evidence-granular semantic retrieval.
 *
 * The main corpus indexes a video as a handful of chapter-sized documents, so
 * a vector hit there locates a fifteen-minute span rather than the moment that
 * answers the question, and lexical scoring over the evidence itself returns
 * nothing whenever the question and the source do not share a language. This
 * index closes that gap: it embeds the active evidence at its own timestamps
 * with the workspace's configured embedding model, caches those vectors
 * against the knowledge revision, and answers a query with a ranked list of
 * `(startSecs, endSecs, score)` units.
 *
 * It is deliberately a *locator*, not a source of truth -- callers use the
 * returned scores to rank and to choose where to look, and continue to read
 * the actual claims from the evidence store.
 */

/** Units are merged to this granularity so one hit names a seekable moment. */
const TRANSCRIPT_WINDOW_SECS = 40;
const OCR_WINDOW_SECS = 30;
/** Bounds one-time embedding cost and cache size for a feature-length source. */
const MAX_UNITS = 700;
const EMBED_BATCH = 96;
const MAX_UNIT_CHARS = 900;
const MAX_DESCRIPTIVE_UNITS_PER_MINUTE = 8;
const SEMANTIC_INDEX_VERSION = 'evidence-v2';

export interface SemanticEvidenceUnit {
  id: string;
  modality: EvidenceModality;
  startSecs: number;
  endSecs: number;
  text: string;
  evidenceIds: string[];
}

export interface SemanticEvidenceHit extends SemanticEvidenceUnit {
  score: number;
}

interface CacheEntry {
  key: string;
  dimensions: number;
  units: SemanticEvidenceUnit[];
  /** Base64 float32 vectors, aligned to `units`. */
  vectors: string[];
  builtAt: string;
}

function evidenceTextOf(evidence: EvidenceRevision): string {
  const text = (evidence.payload as { text?: unknown } | undefined)?.text;
  if (text && typeof text === 'object') {
    const record = text as Record<string, unknown>;
    if (typeof record.subject === 'string' && typeof record.property === 'string') {
      return `${record.subject} ${record.property}: ${String(record.value ?? '')}`.trim();
    }
  }
  return evidenceTextForRetrieval(evidence.payload);
}

/** A per-frame object dump locates nothing a caption does not already say. */
function isLowInformation(modality: EvidenceModality, text: string): boolean {
  if (!text) return true;
  if (modality === 'visual' && /^Detected objects:/i.test(text)) return true;
  return text.replace(/[\s\d:.\-]/g, '').length < 2;
}

function mergeWindows(
  items: EvidenceRevision[],
  windowSecs: number,
  modality: EvidenceModality,
): SemanticEvidenceUnit[] {
  const units: SemanticEvidenceUnit[] = [];
  let current: SemanticEvidenceUnit | null = null;
  for (const evidence of items) {
    const text = evidenceTextOf(evidence);
    if (isLowInformation(modality, text)) continue;
    const startSecs = Math.max(0, evidence.timeRange.startSecs);
    if (!current || startSecs - current.startSecs >= windowSecs) {
      current = {
        id: `${modality}:${startSecs.toFixed(1)}`,
        modality,
        startSecs,
        endSecs: Math.max(startSecs, evidence.timeRange.endSecs),
        text,
        evidenceIds: [evidence.id],
      };
      units.push(current);
      continue;
    }
    current.endSecs = Math.max(current.endSecs, evidence.timeRange.endSecs);
    current.evidenceIds.push(evidence.id);
    // On-screen text repeats across consecutive frames; speech does not.
    if (modality === 'ocr' && current.text.includes(text)) continue;
    if (current.text.length < MAX_UNIT_CHARS) current.text = `${current.text} ${text}`;
  }
  return units;
}

/**
 * Turns active evidence into seekable retrieval units: descriptive readings
 * stay one-to-one, while speech and on-screen text are merged into windows so
 * a single hit is a moment rather than a fragment.
 */
export function buildSemanticEvidenceUnits(evidence: EvidenceRevision[]): SemanticEvidenceUnit[] {
  const byTime = (left: EvidenceRevision, right: EvidenceRevision) =>
    left.timeRange.startSecs - right.timeRange.startSecs;
  const of = (modality: EvidenceModality) =>
    evidence.filter((item) => item.modality === modality).sort(byTime);

  const descriptiveCandidates = [...of('visual'), ...of('computed')]
    .map((item) => ({
      id: item.id,
      modality: item.modality,
      startSecs: Math.max(0, item.timeRange.startSecs),
      endSecs: Math.max(0, item.timeRange.endSecs),
      text: evidenceTextOf(item).slice(0, MAX_UNIT_CHARS),
      evidenceIds: [item.id],
      verdict: evidenceClaimVerdict(item.payload),
    }))
    .filter((unit) => !isLowInformation(unit.modality, unit.text));

  // Repeated bounded inspections can add many readings of one minute. Give
  // every source minute a fixed share of the semantic index so a frequently
  // re-checked miss cannot crowd out untouched moments later in the source.
  const byMinute = new Map<number, typeof descriptiveCandidates>();
  for (const unit of descriptiveCandidates) {
    const bucket = Math.floor(unit.startSecs / 60);
    const values = byMinute.get(bucket) ?? [];
    values.push(unit);
    byMinute.set(bucket, values);
  }
  const descriptive: SemanticEvidenceUnit[] = [];
  for (const values of byMinute.values()) {
    const seen = new Set<string>();
    const selected = values
      .sort((left, right) => {
        const verdictWeight = (value: (typeof values)[number]) =>
          value.verdict === 'direct' ? 3 : value.verdict === 'partial' ? 2 : value.verdict ? 0 : 1;
        return (
          verdictWeight(right) - verdictWeight(left) ||
          Math.min(right.text.length, 500) - Math.min(left.text.length, 500)
        );
      })
      .filter((unit) => {
        const key = `${unit.modality}:${unit.text
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/\s+/g, ' ')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_DESCRIPTIVE_UNITS_PER_MINUTE);
    descriptive.push(...selected.map(({ verdict: _verdict, ...unit }) => unit));
  }

  const spoken = mergeWindows(of('transcript'), TRANSCRIPT_WINDOW_SECS, 'transcript');
  const onScreen = mergeWindows(of('ocr'), OCR_WINDOW_SECS, 'ocr');

  // A semantic reading of a moment is the highest-value locator, so it keeps
  // its place first when the budget forces a trim; speech and on-screen text
  // are then thinned evenly across the source rather than truncated at a
  // point in time, which would leave a whole stretch of it unsearchable.
  const remaining = Math.max(0, MAX_UNITS - descriptive.length);
  const thinned = [...spoken, ...onScreen].sort((a, b) => a.startSecs - b.startSecs);
  const step = thinned.length > remaining ? thinned.length / Math.max(1, remaining) : 1;
  const selected =
    step <= 1 ? thinned : thinned.filter((_, index) => Math.floor(index % step) === 0);

  return [...descriptive.slice(0, MAX_UNITS), ...selected]
    .slice(0, MAX_UNITS)
    .sort((a, b) => a.startSecs - b.startSecs);
}

function encodeVector(vector: ArrayLike<number>): string {
  const floats = Float32Array.from(vector);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).toString('base64');
}

function decodeVector(encoded: string): Float32Array {
  const buffer = Buffer.from(encoded, 'base64');
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

function cosine(query: Float32Array, candidate: Float32Array, queryNorm: number): number {
  if (candidate.length !== query.length) return 0;
  let dot = 0;
  let norm = 0;
  for (let index = 0; index < query.length; index += 1) {
    dot += query[index] * candidate[index];
    norm += candidate[index] * candidate[index];
  }
  const denominator = queryNorm * Math.sqrt(norm);
  return denominator > 0 ? dot / denominator : 0;
}

async function cachePath(create: boolean): Promise<string | null> {
  const dir = create ? await requireProjectDataDir() : await getProjectDataDir();
  return dir ? path.join(dir, 'video-semantic-index.json') : null;
}

async function readCache(): Promise<CacheEntry[]> {
  const file = await cachePath(false);
  if (!file) return [];
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as CacheEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let writeChain: Promise<unknown> = Promise.resolve();

async function writeCache(entry: CacheEntry): Promise<void> {
  const run = writeChain.then(async () => {
    const file = await cachePath(true);
    if (!file) return;
    // One entry per media asset: an older revision's vectors describe evidence
    // that is no longer active and would only rank stale moments.
    const assetId = entry.key.split(':')[0];
    const kept = (await readCache()).filter((existing) => existing.key.split(':')[0] !== assetId);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify([...kept, entry]), 'utf8');
    await fs.rename(temporary, file);
  });
  writeChain = run.catch(() => {});
  await run.catch(() => undefined);
}

/** In-process reuse across the several retrieval passes of one chat answer. */
const loaded = new Map<string, { units: SemanticEvidenceUnit[]; vectors: Float32Array[] }>();

/**
 * One chat answer searches the same question several times, and answering it
 * can append evidence in between -- which activates a new manifest and so
 * changes what the scores refer to. Caching the *scores* across that boundary
 * silently drops every record the refinement rewrote. The query's vector is
 * the part that does not change, so that is what is held.
 */
const queryVectors = new Map<string, Float32Array>();
const QUERY_VECTOR_CACHE_LIMIT = 64;

async function embedQueryCached(query: string, abortSignal?: AbortSignal) {
  const config = await readConfig();
  const key = `${config.embeddingModelId}\u0000${query}`;
  const cached = queryVectors.get(key);
  if (cached) return cached;
  const vector = Float32Array.from(await embedQuery(config, query, abortSignal));
  if (vector.length === 0) return undefined;
  if (queryVectors.size >= QUERY_VECTOR_CACHE_LIMIT) {
    queryVectors.delete(queryVectors.keys().next().value as string);
  }
  queryVectors.set(key, vector);
  return vector;
}

async function loadIndex(mediaAssetId: string, abortSignal?: AbortSignal) {
  abortSignal?.throwIfAborted();
  const state = await readVideoKnowledgeState();
  const manifest = state.manifests
    .filter((item) => item.mediaAssetId === mediaAssetId && item.activatedAt)
    .sort((left, right) => right.activatedAt!.localeCompare(left.activatedAt!))[0];
  if (!manifest) return null;
  const config = await readConfig();
  const key = `${mediaAssetId}:${manifest.id}:${SEMANTIC_INDEX_VERSION}:${config.embeddingModelId}`;
  const inProcess = loaded.get(key);
  if (inProcess) return inProcess;

  const entries = await readCache();
  const cached = entries.find((entry) => entry.key === key);
  if (cached) {
    const index = {
      units: cached.units,
      vectors: cached.vectors.map(decodeVector),
    };
    loaded.set(key, index);
    return index;
  }

  const activeIds = new Set(Object.values(manifest.activeEvidenceRevisionIds));
  const evidence = state.evidence.filter(
    (item) => item.mediaAssetId === mediaAssetId && activeIds.has(item.id),
  );
  const units = buildSemanticEvidenceUnits(evidence);
  if (units.length === 0) return null;

  // Answering a question can append refined evidence, which activates a new
  // manifest and so invalidates this key. Re-embedding an entire feature-length
  // source for the handful of readings that actually changed would make every
  // inspection permanently slower, so vectors are carried over by unit text and
  // only genuinely new text is sent to the provider.
  const reusable = new Map<string, string>();
  const previous = entries.find(
    (entry) =>
      entry.key.startsWith(`${mediaAssetId}:`) && entry.key.endsWith(`:${config.embeddingModelId}`),
  );
  if (previous) {
    previous.units.forEach((unit, position) => {
      const vector = previous.vectors[position];
      if (vector) reusable.set(unit.text, vector);
    });
  }

  const vectors: (number[] | Float32Array)[] = new Array(units.length);
  const pending: number[] = [];
  units.forEach((unit, position) => {
    const carried = reusable.get(unit.text);
    if (carried) vectors[position] = decodeVector(carried);
    else pending.push(position);
  });
  for (let offset = 0; offset < pending.length; offset += EMBED_BATCH) {
    abortSignal?.throwIfAborted();
    const batch = pending.slice(offset, offset + EMBED_BATCH);
    const { embeddings } = await embedTexts(
      config,
      batch.map((position) => units[position].text),
      abortSignal,
    );
    if (embeddings.length !== batch.length) return null;
    batch.forEach((position, index) => {
      vectors[position] = embeddings[index];
    });
  }
  if (vectors.some((vector) => !vector)) return null;

  const materialized = vectors.map((vector) => Float32Array.from(vector as ArrayLike<number>));
  const entry: CacheEntry = {
    key,
    dimensions: materialized[0]?.length ?? 0,
    units,
    vectors: materialized.map(encodeVector),
    builtAt: new Date().toISOString(),
  };
  await writeCache(entry);
  const index = { units, vectors: materialized };
  loaded.set(key, index);
  return index;
}

export interface SemanticEvidenceSearchOptions {
  topK?: number;
  modalities?: EvidenceModality[];
  timeRange?: { startSecs: number; endSecs: number };
  /** Drop weak matches so an unanswerable question returns nothing. */
  minimumScore?: number;
  /** Optional interactive deadline; lexical retrieval remains available if it expires. */
  abortSignal?: AbortSignal;
}

/**
 * Ranks active evidence against a free-text question in the embedding space,
 * so a question asked in one language still locates evidence recorded in
 * another. Any failure (missing credentials, a provider outage) degrades to an
 * empty result and leaves lexical retrieval in charge.
 */
export async function searchSemanticEvidence(
  mediaAssetId: string,
  query: string,
  options: SemanticEvidenceSearchOptions = {},
): Promise<SemanticEvidenceHit[]> {
  if (!query.trim()) return [];
  let index: Awaited<ReturnType<typeof loadIndex>>;
  let vector: Float32Array | undefined;
  try {
    index = await loadIndex(mediaAssetId, options.abortSignal);
    if (!index) return [];
    vector = await embedQueryCached(query, options.abortSignal);
  } catch {
    return [];
  }
  if (!vector || vector.length === 0) return [];
  let queryNorm = 0;
  for (const value of vector) queryNorm += value * value;
  queryNorm = Math.sqrt(queryNorm);
  if (queryNorm === 0) return [];

  const range = options.timeRange;
  const minimumScore = options.minimumScore ?? 0;
  const hits: SemanticEvidenceHit[] = [];
  for (let position = 0; position < index.units.length; position += 1) {
    const unit = index.units[position];
    if (options.modalities?.length && !options.modalities.includes(unit.modality)) continue;
    if (range && (unit.startSecs > range.endSecs || unit.endSecs < range.startSecs)) continue;
    const score = cosine(vector, index.vectors[position], queryNorm);
    if (score < minimumScore) continue;
    hits.push({ ...unit, score });
  }
  return hits.sort((left, right) => right.score - left.score).slice(0, options.topK ?? 8);
}

/**
 * Evidence id -> semantic score, for the hybrid ranker in `retrieval.ts`. A
 * merged unit shares its score with every evidence record it covers.
 *
 * Raw cosine over a general-purpose embedding model sits in a narrow band
 * (everything scores roughly 0.3-0.5), so the absolute value separates almost
 * nothing. Rescaling the returned set to its own spread is what turns it into
 * a usable ranking signal; the ordering is unchanged.
 */
export function semanticScoresByEvidenceId(hits: SemanticEvidenceHit[]): Map<string, number> {
  const scores = new Map<string, number>();
  if (hits.length === 0) return scores;
  const values = hits.map((hit) => hit.score);
  const highest = Math.max(...values);
  const lowest = Math.min(...values);
  const spread = highest - lowest;
  for (const hit of hits) {
    // Floor at 0.1 so the weakest returned hit still outranks evidence the
    // semantic pass never surfaced at all.
    const normalized = spread > 1e-6 ? 0.1 + 0.9 * ((hit.score - lowest) / spread) : 1;
    for (const evidenceId of hit.evidenceIds) {
      scores.set(evidenceId, Math.max(scores.get(evidenceId) ?? 0, normalized));
    }
  }
  return scores;
}

/** Warms the vectors for a freshly indexed asset so the first question is fast. */
export async function primeSemanticEvidenceIndex(mediaAssetId: string): Promise<boolean> {
  try {
    return Boolean(await loadIndex(mediaAssetId));
  } catch {
    return false;
  }
}
