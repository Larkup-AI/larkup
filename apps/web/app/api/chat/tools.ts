import { jsonSchema, tool } from 'ai';
import { z } from 'zod';
import type {
  AgentToolDefinition,
  AgentToolExecutionContext,
  AgentToolHandler,
} from '@larkup/marketplace/extension';
import { readConfig } from '@larkup/core/config-store';
import { createAdapter } from '@larkup/vector-stores/factory';
import { embedQuery } from '@larkup/core/indexing/embedder';
import { runWithProject } from '@larkup/core/project-store';
import { getTabularDataset, queryTabular } from '@larkup/core/tabular-store';
import {
  getCorpusDocuments,
  exportCorpusAsCSV,
  exportCorpusAsJSONL,
  type CorpusFilter,
} from '@larkup/core/corpus-retriever';
import { SandboxManager } from '@larkup/sandbox';
import type { SandboxBackend, SandboxFile } from '@larkup/sandbox/types';
import { applyFieldEdits, applyContentEdits } from '@larkup/tool-doc-editor';
import { loadTool } from '@larkup/marketplace/loader';
import { getInstalledTools } from '@larkup/marketplace/installer';
import { readDocuments } from '@larkup/core/documents-store';
import { readGroups } from '@larkup/core/groups-store';
import { readMediaAssets } from '@larkup/core/media-store';
import {
  searchVideoKnowledge,
  videoKnowledgeRetrievalCapabilities,
} from '@larkup/core/video-knowledge/retrieval';
import { planVideoInvestigation as buildVideoInvestigationPlan } from '@larkup/core/video-knowledge/investigation';
import { verifyMediaEvidence } from '@larkup/core/video-knowledge/verification';
import { planVideoQuestion } from '@larkup/core/video-knowledge/query-planner';
import { decideInspection, LIMITS } from '@larkup/core/video-knowledge/inspection-policy';
import { chunkTimeRange } from '@larkup/core/video-knowledge/inspection-chunking';
import { expandInvestigationRange } from '@larkup/core/video-knowledge/range-expansion';
import { queryVideoEmbeddings } from '@larkup/core/video-knowledge/video-embedding-index';
import {
  searchSemanticEvidence,
  semanticScoresByEvidenceId,
} from '@larkup/core/video-knowledge/evidence-semantic-index';
import {
  formatTimecode,
  fuseFocusRanges,
  type FocusSignal,
} from '@larkup/core/video-knowledge/focus-ranges';
import { trackUsageEvent } from '@larkup/core/analytics-store';
import { cacheImageAnalysis, getCachedImageAnalysis } from '@larkup/core/image-analysis-cache';
import {
  normalizeMediaCitationRange,
  queryAwareExcerpt,
  timestampMediaUrl,
} from '@/lib/media/knowledge';
import { hasVideoIntelligenceCapacity } from '@/lib/media/video-intelligence-adapter';
import {
  isUsableFinding,
  quickLook,
  resolveQuickLookSource,
  type QuickLookFinding,
} from '@/lib/media/video/quick-look';
import {
  buildQueryTermMatchers,
  countMatchesIn,
  rankKnowledgeHits,
} from '@/lib/chat/retrieval-ranking';
import {
  activeMediaFollowUpResult,
  clearlyTitleMatchedMediaAsset,
} from '@/lib/chat/media-source-routing';
import { createTabularVisualization } from '@/lib/chat/tabular-visualization';
import { inferTabularPlan } from '@/lib/chat/tabular-query-plan';
import { indexedVideoEvidenceIsSufficient } from '@/lib/chat/video-rag-routing';
import {
  inspectStoredPdf,
  readStoredPdfBytes,
  renderStoredPdfPage,
} from '@/lib/media/pdf-inspection';
import { canonicalMediaSourceUrl, newestEquivalentMediaAsset } from '@/lib/media/source-identity';
import {
  isDocumentAvailableInVideoRuntime,
  videoRuntimeScopeFromConfig,
  type VideoRuntimeScope,
} from '@/lib/media/video-runtime-scope';
import {
  executeEnterpriseTool,
  getEnterpriseTools,
  trackEnterpriseToolUsage,
} from '@/lib/enterprise-client';

const sandboxAvailabilityCache = new Map<string, { expiresAt: number; ready: boolean }>();

/** A compact, typed value captured from the source (for example a displayed
 * state, total, or counter). Unlike free-form OCR, it can be ranked and
 * cited without mistaking a clock or identifier for the answer. */
/**
 * Ceiling on all automatic source re-inspection for one chat turn. Past this,
 * the answer is composed from the evidence already gathered rather than
 * holding the turn open for another cold GPU worker.
 */
const CHAT_INSPECTION_BUDGET_MS = 150_000;
/**
 * Ceiling on the bounded re-watch. Its windows run together, so this bounds the
 * whole step rather than each window, and it is deliberately far below
 * `CHAT_INSPECTION_BUDGET_MS`: this path exists to answer while someone waits.
 */
const QUICK_LOOK_BUDGET_MS = 60_000;
/** Semantic ranking enriches RAG but must never hold an interactive lookup hostage. */
const CHAT_SEMANTIC_LOOKUP_BUDGET_MS = 2_500;

function structuredStateFromEvidence(
  evidence: any,
): { subject: string; property: string; value: string | number } | undefined {
  const payload = evidence?.payload;
  const text = payload && typeof payload === 'object' ? payload.text : undefined;
  if (!text || typeof text !== 'object' || Array.isArray(text)) return undefined;
  if (
    typeof text.subject !== 'string' ||
    typeof text.property !== 'string' ||
    (typeof text.value !== 'string' && typeof text.value !== 'number')
  ) {
    return undefined;
  }
  return { subject: text.subject, property: text.property, value: text.value };
}

function evidenceText(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const text = (payload as { text?: unknown }).text;
    return typeof text === 'string' ? text : JSON.stringify(text);
  }
  return JSON.stringify(payload) ?? '';
}

/**
 * Do not offer an unavailable sandbox to the model: a factual answer should
 * still use retrieval or tabular data when the local runtime is unavailable.
 */
async function isSandboxReady(config: any): Promise<boolean> {
  const { backend, credentials } = resolveSandboxConfig(config);
  const cacheKey = backend;
  const cached = sandboxAvailabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.ready;

  try {
    const health = await new SandboxManager({ backend, credentials }).healthCheck();
    const ready = health.status === 'ready';
    sandboxAvailabilityCache.set(cacheKey, { ready, expiresAt: Date.now() + 30_000 });
    return ready;
  } catch {
    sandboxAvailabilityCache.set(cacheKey, { ready: false, expiresAt: Date.now() + 30_000 });
    return false;
  }
}

function documentEditModelOutput({ output }: { output: any }) {
  return {
    type: 'json' as const,
    value: output?.success
      ? {
          success: true,
          action: output.action,
          sessionId: output.sessionId,
          updatedFields: output.updatedFields ?? [],
          fileName: output.fileName,
          totalPages: output.totalPages,
          message:
            'The document was updated successfully. Do not repeat the edit unless requested.',
        }
      : {
          success: false,
          error: output?.error ?? 'Document update failed',
        },
  };
}

/**
 * Re-watches candidate windows of an indexed source to settle the current
 * question, and reports only what that reading actually established.
 *
 * Speech already recorded for each window travels with it: a reader that can
 * both see the frames and read what was said over them resolves an identity or
 * a change that neither modality settles alone.
 */
async function reWatchSource(input: {
  asset: { id: string; storageUri: string; fileName: string; durationSecs?: number };
  question: string;
  ranges: Array<{ startSecs: number; endSecs: number; label?: string }>;
  subjectName?: string;
  knownEntities?: string[];
  mediaAssetId: string;
  maxWaitMs?: number;
}): Promise<{ findings: QuickLookFinding[]; elapsedMs: number } | undefined> {
  const startedAt = Date.now();
  let release: (() => Promise<void>) | undefined;
  try {
    const looks = input.ranges.map((range) => ({
      startSecs: Math.max(0, range.startSecs),
      endSecs: Math.min(
        input.asset.durationSecs ?? range.endSecs,
        Math.max(range.startSecs + 5, Math.min(range.endSecs, range.startSecs + 45)),
      ),
      lookingFor: [
        input.subjectName
          ? `Which visible person is "${input.subjectName}", and what the question asks about them.`
          : range.label,
        input.knownEntities?.length
          ? `Known source identities to ground from visible labels or aligned speech, never assume: ${input.knownEntities.join(', ')}.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    }));
    const speech = await Promise.all(
      looks.map((range) =>
        searchVideoKnowledge(input.mediaAssetId, '', 12, {
          modalities: ['transcript'],
          minimumRangeDistanceSecs: 0,
          videoDurationSecs: input.asset.durationSecs,
          timeRange: range,
        }).catch(() => []),
      ),
    );
    const transcriptByStart = new Map(
      looks.map((range, index) => [
        range.startSecs,
        speech[index]
          .sort((a, b) => a.evidence.timeRange.startSecs - b.evidence.timeRange.startSecs)
          .map((hit) => evidenceText(hit.evidence.payload))
          .filter(Boolean)
          .join(' ')
          .slice(0, 4_000),
      ]),
    );
    const source = await resolveQuickLookSource(input.asset.storageUri, input.asset.fileName);
    release = source.cleanup;
    const findings = await quickLook({
      mediaPath: source.mediaPath,
      question: input.question,
      ranges: looks,
      transcriptFor: (range) => transcriptByStart.get(range.startSecs) || undefined,
      signal: AbortSignal.timeout(
        Math.max(1_000, Math.min(QUICK_LOOK_BUDGET_MS, input.maxWaitMs ?? QUICK_LOOK_BUDGET_MS)),
      ),
    });
    const usable = findings.filter(isUsableFinding);
    return usable.length > 0 ? { findings: usable, elapsedMs: Date.now() - startedAt } : undefined;
  } catch (error) {
    console.warn('[chat] bounded re-watch of the source failed:', error);
    return undefined;
  } finally {
    await release?.();
  }
}

/**
 * Retrieves documents from the knowledge base
 */
function isMediaAssetAvailableInRuntime(
  asset: { videoRuntimeScope?: unknown },
  activeScope: VideoRuntimeScope,
) {
  return asset.videoRuntimeScope !== 'local' && asset.videoRuntimeScope !== 'cloud'
    ? true
    : asset.videoRuntimeScope === activeScope;
}

async function uniqueCompletedMediaFallback(query: string, activeScope: VideoRuntimeScope) {
  const assets = (await readMediaAssets()).filter(
    (asset) =>
      asset.processingStatus === 'completed' &&
      Boolean(asset.activeVideoKnowledgeRevisionId) &&
      isMediaAssetAvailableInRuntime(asset, activeScope) &&
      (asset.type === 'video' || asset.type === 'audio'),
  );
  // A retrieval miss must not strand a single, unambiguous active media
  // source. With several sources the host deliberately stays neutral and
  // lets ordinary retrieval disambiguate rather than guessing the asset.
  if (assets.length === 1) {
    return {
      query,
      hits: [],
      videoEvidence: {
        mediaAssetId: assets[0].id,
        retrievalFallback: 'single-active-media-source',
      },
    };
  }
  // A vector index can be temporarily unavailable while a completed video
  // remains perfectly usable through its evidence store. Recover an asset
  // only when its user-visible title has a clear lexical lead; otherwise
  // preserve the neutral no-result behavior for genuinely ambiguous media.
  const titleMatch = clearlyTitleMatchedMediaAsset(query, assets);
  if (!titleMatch) return { query, hits: [] };
  return {
    query,
    hits: [],
    videoEvidence: {
      mediaAssetId: titleMatch.id,
      retrievalFallback: 'title-matched-media-source',
    },
  };
}

export async function queryKnowledgeBase(query: string, topK: number, projectId: string | null) {
  const doRetrieve = async () => {
    const config = await readConfig();
    const activeVideoRuntimeScope = videoRuntimeScopeFromConfig(config);
    // Retrieve a small diverse pool. Sending a very large candidate set into
    // the answer model noticeably delays the first streamed token without
    // helping the user-facing source list.
    // Keep a wider candidate pool internal, then return only the compact,
    // diverse evidence set to the model. This substantially improves recall
    // for exact labels in visual PDFs without inflating prompt size.
    const candidateCount = Math.min(Math.max(topK * 16, 64), 100);
    // Document status is more precise than the last index-run summary: a later
    // partial run can be marked failed even though earlier uploaded and scraped
    // documents were successfully indexed and remain queryable.
    const [allDocuments, groups, mediaAssets] = await Promise.all([
      readDocuments(),
      readGroups(),
      readMediaAssets(),
    ]);
    const assistantDisabledGroups = new Set(
      groups.filter((group) => !group.assistantEnabled).map((group) => group.id),
    );
    const documents = allDocuments.filter(
      (document) =>
        document.enabled !== false &&
        isDocumentAvailableInVideoRuntime(document, activeVideoRuntimeScope) &&
        (!document.groupId || !assistantDisabledGroups.has(document.groupId)),
    );
    const directTitleMatchedAsset = clearlyTitleMatchedMediaAsset(
      query,
      mediaAssets.filter(
        (asset) =>
          asset.processingStatus === 'completed' &&
          Boolean(asset.activeVideoKnowledgeRevisionId) &&
          isMediaAssetAvailableInRuntime(asset, activeVideoRuntimeScope) &&
          (asset.type === 'video' || asset.type === 'audio'),
      ),
    );
    const titleMatchedAsset = directTitleMatchedAsset
      ? newestEquivalentMediaAsset(directTitleMatchedAsset, mediaAssets)
      : undefined;
    if (!documents.some((document) => document.status === 'indexed'))
      return uniqueCompletedMediaFallback(query, activeVideoRuntimeScope);

    try {
      const vector = await embedQuery(config, query);
      const adapter = await createAdapter(config);
      const indexedDocumentIds = new Set(documents.map((document) => document.id));
      const hits = (await adapter.query(vector, candidateCount, query)).filter((hit: any) =>
        indexedDocumentIds.has(hit.documentId),
      );
      // Pure vector similarity can leave out a document whose title is an
      // obvious literal match for the query -- a meta-referential question
      // ("what happened in my test video?") has little semantic overlap
      // with the video's actual transcript content, so a document titled
      // test-video.mp4 can miss the top-100 candidate pool entirely even
      // though "test video" names it almost verbatim. Reranking can only
      // reorder what's already in the pool, so supplement it here instead.
      const queryMatchers = buildQueryTermMatchers(query);
      const requiredTitleMatches = Math.min(2, queryMatchers.length);
      if (requiredTitleMatches > 0) {
        const presentDocumentIds = new Set(hits.map((hit: any) => hit.documentId));
        const titleMatched = documents
          .filter(
            (document) => document.status === 'indexed' && !presentDocumentIds.has(document.id),
          )
          .map((document) => ({ document, matches: countMatchesIn(queryMatchers, document.title) }))
          .filter(({ matches }) => matches >= requiredTitleMatches)
          .sort((left, right) => right.matches - left.matches)
          .slice(0, 8)
          .map(({ document }) => ({
            id: document.id,
            documentId: document.id,
            score: 0,
            title: document.title,
            text: document.content.slice(0, 1_200),
            url: document.url,
            metadata: document.metadata,
          }));
        if (titleMatched.length > 0) hits.push(...titleMatched);
      }
      const formatted = await formatKnowledgeHits(query, hits, topK, documents);
      if (formatted.hits.length === 0)
        return uniqueCompletedMediaFallback(query, activeVideoRuntimeScope);
      // A vector row created before the evidence-first media revision may
      // carry only a document id. Resolve it against the active media source
      // here, so the generic chat router can force whichever installed
      // evidence-query action owns that source before a model answers.
      const resolvedMediaAssetId =
        titleMatchedAsset?.id ??
        (await findEvidenceFirstVideoAssetId(formatted, activeVideoRuntimeScope));
      const resolvedMediaAsset = resolvedMediaAssetId
        ? mediaAssets.find((asset) => asset.id === resolvedMediaAssetId)
        : undefined;
      const mediaAssetId = resolvedMediaAsset
        ? newestEquivalentMediaAsset(resolvedMediaAsset, mediaAssets).id
        : resolvedMediaAssetId;
      const scopedHits = titleMatchedAsset
        ? formatted.hits.filter(
            (hit: any) =>
              hit.metadata?.mediaAssetId === titleMatchedAsset.id ||
              titleMatchedAsset.documentIds.includes(String(hit.documentId ?? '')),
          )
        : formatted.hits;
      const authoritativeHits = mediaAssetId
        ? scopedHits.map((hit: any) =>
            hit.metadata?.mediaAssetId
              ? { ...hit, metadata: { ...hit.metadata, mediaAssetId } }
              : hit,
          )
        : scopedHits;
      return mediaAssetId
        ? {
            ...formatted,
            hits: authoritativeHits,
            videoEvidence: { mediaAssetId, retrievalFallback: 'active-media-source' },
          }
        : formatted;
    } catch (error) {
      // A retrieval outage must not become a model/tool failure that exposes
      // implementation details. The chat policy handles an empty result with
      // its normal, user-facing uncertainty response.
      console.error('[chat] knowledge-base retrieval failed:', error);
      return uniqueCompletedMediaFallback(query, activeVideoRuntimeScope);
    }
  };

  return projectId ? runWithProject(projectId, doRetrieve) : doRetrieve();
}

async function formatKnowledgeHits(
  query: string,
  rawHits: any[],
  topK: number,
  indexedDocuments?: Awaited<ReturnType<typeof readDocuments>>,
) {
  const [storedDocuments, mediaAssets] = await Promise.all([readDocuments(), readMediaAssets()]);
  const documents = indexedDocuments ?? storedDocuments;
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const activeMediaDocumentIds = new Set(mediaAssets.flatMap((asset) => asset.documentIds));
  const hydrated = rankKnowledgeHits(
    query,
    rawHits.map((hit) => {
      const document = documentsById.get(hit.documentId);
      return {
        ...hit,
        title: hit.title || document?.title || 'Untitled',
        url: hit.url || document?.url || '',
        text: hit.text || document?.content || '',
        metadata: { ...document?.metadata, ...hit.metadata },
      };
    }),
  );

  const selected: any[] = [];
  const hitsPerDocument = new Map<string, number>();
  const selectedEvidenceSources = new Set<string>();
  for (const hit of hydrated) {
    // Never resurrect a vector whose document was deleted or which is no
    // longer indexed. This matters after a mixed scrape/upload index retry.
    if (
      !documentsById.has(hit.documentId) ||
      documentsById.get(hit.documentId)?.status !== 'indexed'
    ) {
      continue;
    }
    if (
      hit.metadata?.mediaAssetId &&
      (!documentsById.has(hit.documentId) || !activeMediaDocumentIds.has(hit.documentId))
    ) {
      continue;
    }
    // A re-upload or re-index can leave several assets for the same source.
    // Return one active evidence source per canonical upload so a generic
    // evidence action is never dispatched in parallel for duplicate copies.
    const mediaAsset = hit.metadata?.mediaAssetId
      ? mediaAssets.find((asset) => asset.id === hit.metadata.mediaAssetId)
      : undefined;
    const evidenceSourceKey = mediaAsset?.activeVideoKnowledgeRevisionId
      ? mediaAsset.originalUrl || mediaAsset.storageUri || mediaAsset.id
      : undefined;
    if (evidenceSourceKey && selectedEvidenceSources.has(evidenceSourceKey)) continue;
    const seen = hitsPerDocument.get(hit.documentId) ?? 0;
    const isTimestampedMedia =
      hit.metadata?.isMediaSummary === true ||
      hit.metadata?.contentKind === 'multimodal-segment' ||
      hit.metadata?.contentKind === 'audio-transcript-segment';
    // One strong hit per timestamped evidence document leaves room for other
    // moments instead of returning eight chunks from the same summary.
    if (seen >= (isTimestampedMedia ? 1 : 3)) continue;
    selected.push(hit);
    if (evidenceSourceKey) selectedEvidenceSources.add(evidenceSourceKey);
    hitsPerDocument.set(hit.documentId, seen + 1);
    if (selected.length >= topK) break;
  }
  const primaryMediaAssetId = selected.find((hit) => hit.metadata?.mediaAssetId)?.metadata
    .mediaAssetId;
  const mediaDocuments = primaryMediaAssetId
    ? documents.filter(
        (document) =>
          document.status === 'indexed' &&
          document.metadata?.mediaAssetId === primaryMediaAssetId &&
          activeMediaDocumentIds.has(document.id),
      )
    : [];
  const timestampedDocuments = mediaDocuments
    .filter((document) => Number.isFinite(Number(document.metadata?.endSecs)))
    .sort(
      (left, right) => Number(left.metadata?.endSecs ?? 0) - Number(right.metadata?.endSecs ?? 0),
    );
  const mediaDuration = Math.max(
    0,
    ...timestampedDocuments.map((document) =>
      Number(document.metadata?.durationSecs ?? document.metadata?.endSecs ?? 0),
    ),
  );
  const trailingHorizonSecs = Math.max(10 * 60, Math.min(30 * 60, mediaDuration * 0.2));
  const trailingDocuments = timestampedDocuments.filter(
    (document) => Number(document.metadata?.endSecs ?? 0) >= mediaDuration - trailingHorizonSecs,
  );
  const timestampedEnding = [
    ...new Map(trailingDocuments.slice(-4).map((document) => [document.id, document])).values(),
  ].sort(
    (left, right) => Number(left.metadata?.endSecs ?? 0) - Number(right.metadata?.endSecs ?? 0),
  );
  const mediaSummary = mediaDocuments.find(
    (document) => document.metadata?.isMediaSummary === true,
  );
  const legacyWholeTimeline =
    timestampedEnding.length === 0
      ? mediaDocuments.find((document) => document.metadata?.contentKind === 'multimodal-timeline')
      : undefined;
  // A compact ending context is returned for every primary media match. This
  // avoids depending on a brittle language-specific keyword gate for questions
  // whose answer is only established near the end of a source.
  const endingContext = primaryMediaAssetId
    ? [
        ...(mediaSummary
          ? [
              {
                role: 'summary',
                title: mediaSummary.title,
                url: mediaSummary.url,
                text: queryAwareExcerpt(mediaSummary.content, query, 6_000),
                startSecs: undefined,
                endSecs: undefined,
              },
            ]
          : []),
        ...timestampedEnding.map((document) => ({
          role: 'ending',
          title: document.title,
          url: document.url,
          text: queryAwareExcerpt(document.content, query, 3_200, true),
          startSecs: document.metadata?.startSecs,
          endSecs: document.metadata?.endSecs,
        })),
        ...(legacyWholeTimeline
          ? [
              {
                role: 'ending',
                title: legacyWholeTimeline.title,
                url: legacyWholeTimeline.url,
                // Legacy media was one giant document. Its ending is the tail,
                // never the beginning.
                text: queryAwareExcerpt(legacyWholeTimeline.content, query, 4_000, true),
                startSecs: undefined,
                endSecs: legacyWholeTimeline.metadata?.durationSecs,
              },
            ]
          : []),
      ]
    : undefined;

  return {
    query,
    hits: selected.map((hit, hitIndex) => {
      // Text chunks inherit their source-document ID but not necessarily the
      // document-level PDF image list. Recover it here so a question that
      // retrieves a routine name in text can still inspect or preview the
      // corresponding schema image.
      const sourceDocument = documents.find((document) => document.id === hit.documentId);
      const relatedDocumentImages = sourceDocument
        ? documents
            .filter(
              (document) =>
                document.status === 'indexed' &&
                document.metadata?.isImage === true &&
                document.metadata?.originalFile === sourceDocument.title,
            )
            .map((document) => ({
              imageUrl: document.metadata?.imageUrl,
              pageNumber: document.metadata?.pageNumber,
              index: document.metadata?.index,
              description: document.metadata?.description,
            }))
            .filter((image) => typeof image.imageUrl === 'string' && image.imageUrl.length > 0)
        : [];
      const sequence = Number(hit.metadata?.sequence);
      const startSecs = Number(hit.metadata?.startSecs);
      const activeVideoAsset = hit.metadata?.mediaAssetId
        ? mediaAssets.find((asset) => asset.id === hit.metadata.mediaAssetId)
        : undefined;
      const usesEvidenceFirstVideoKnowledge = Boolean(
        activeVideoAsset?.activeVideoKnowledgeRevisionId &&
        (activeVideoAsset.type === 'video' || activeVideoAsset.type === 'audio'),
      );
      const timelineContext =
        hit.metadata?.mediaAssetId && !usesEvidenceFirstVideoKnowledge
          ? documents
              .filter((document) => {
                const candidateSequence = Number(document.metadata?.sequence);
                const candidateStart = Number(document.metadata?.startSecs);
                return (
                  document.status === 'indexed' &&
                  activeMediaDocumentIds.has(document.id) &&
                  document.metadata?.mediaAssetId === hit.metadata.mediaAssetId &&
                  Number.isFinite(sequence) &&
                  Number.isFinite(candidateSequence) &&
                  Math.abs(candidateSequence - sequence) <= 1 &&
                  // Sequence is the authoritative adjacency marker. Fixed
                  // 90-second distance broke wider adaptive windows used for
                  // multi-hour camera and screen recordings.
                  (!Number.isFinite(startSecs) ||
                    !Number.isFinite(candidateStart) ||
                    Math.abs(candidateStart - startSecs) <=
                      Math.max(
                        90,
                        Number(hit.metadata?.endSecs ?? startSecs) - startSecs,
                        Number(document.metadata?.endSecs ?? candidateStart) - candidateStart,
                      ))
                );
              })
              .sort(
                (left, right) =>
                  Number(left.metadata?.startSecs ?? 0) - Number(right.metadata?.startSecs ?? 0),
              )
              .map((document) => ({
                role:
                  Number(document.metadata?.sequence) < sequence
                    ? 'before'
                    : Number(document.metadata?.sequence) > sequence
                      ? 'after'
                      : 'matched',
                title: document.title,
                url: document.url,
                text: queryAwareExcerpt(document.content, query, 3_200),
                startSecs: document.metadata?.startSecs,
                endSecs: document.metadata?.endSecs,
              }))
          : undefined;

      return {
        documentId: hit.documentId,
        title: hit.title ?? 'Untitled',
        url: hit.url ?? '',
        score: Number((hit.score ?? 0).toFixed(3)),
        // An active Video Knowledge revision replaces this disposable vector
        // projection as the factual source. Do not leak the old timeline
        // excerpt to the model: it can otherwise answer from a broad/dummy
        // window without running the evidence verification tool.
        text: usesEvidenceFirstVideoKnowledge
          ? 'Verified media evidence is available. Use the installed evidence-query action with this mediaAssetId before answering factual questions about this media.'
          : queryAwareExcerpt(hit.text ?? '', query, 1_600),
        // UI-only preview of the exact indexed chunk that matched. The model's
        // compact tool context intentionally ignores this field and answers
        // video questions from active evidence instead, while the user can
        // still inspect what the search actually found.
        context: queryAwareExcerpt(hit.text ?? sourceDocument?.content ?? '', query, 900),
        // PDF extraction stores its verified upload URLs on the source
        // document, rather than creating media-library assets. Expose those
        // URLs explicitly so the presentation tool can validate and render
        // them in chat.
        images:
          hit.metadata?.images ??
          sourceDocument?.metadata?.images ??
          (relatedDocumentImages.length > 0 ? relatedDocumentImages : undefined) ??
          (hit.metadata?.isImage && hit.metadata?.imageUrl
            ? [
                {
                  imageUrl: hit.metadata.imageUrl,
                  pageNumber: hit.metadata.pageNumber,
                  index: hit.metadata.index,
                  description: hit.metadata.description,
                },
              ]
            : undefined),
        metadata: {
          ...hit.metadata,
          usesEvidenceFirstVideoKnowledge,
        },
        timelineContext,
        endingContext:
          hitIndex === 0 && !usesEvidenceFirstVideoKnowledge ? endingContext : undefined,
      };
    }),
  };
}

/**
 * Vector rows created before Video Knowledge can be missing the derived
 * `usesEvidenceFirstVideoKnowledge` flag. Resolve against the source of
 * truth instead of allowing that stale projection to downgrade a video
 * question into ordinary RAG.
 */
async function findEvidenceFirstVideoAssetId(
  retrieval: { hits?: any[] },
  activeScope: VideoRuntimeScope,
  projectId?: string,
) {
  const readAssets = () => readMediaAssets();
  const activeVideoAssets = (
    projectId ? await runWithProject(projectId, readAssets) : await readAssets()
  ).filter(
    (asset) =>
      asset.processingStatus === 'completed' &&
      Boolean(asset.activeVideoKnowledgeRevisionId) &&
      isMediaAssetAvailableInRuntime(asset, activeScope) &&
      (asset.type === 'video' || asset.type === 'audio'),
  );
  const assetsById = new Map(activeVideoAssets.map((asset) => [asset.id, asset]));
  const assetIdByDocumentId = new Map(
    activeVideoAssets.flatMap((asset) =>
      asset.documentIds.map((documentId) => [documentId, asset.id] as const),
    ),
  );
  // Re-indexing/import retries can leave more than one completed asset for a
  // source. The most recently updated completed asset is authoritative: it is
  // the one the user most recently indexed, and choosing it is independent of
  // what kind of question happens to be asked. Seek/tracking URL variants are
  // grouped by canonicalMediaSourceUrl above.
  const preferredAssetByOriginalUrl = new Map<string, Promise<string>>();
  const preferEvidenceQuality = async (assetId: string) => {
    const originalUrl = canonicalMediaSourceUrl(assetsById.get(assetId)?.originalUrl ?? '');
    if (!originalUrl) return assetId;
    const existing = preferredAssetByOriginalUrl.get(originalUrl);
    if (existing) return existing;
    const candidates = activeVideoAssets.filter(
      (candidate) => canonicalMediaSourceUrl(candidate.originalUrl ?? '') === originalUrl,
    );
    const selection = Promise.resolve(
      candidates.sort(
        (left, right) =>
          Date.parse(right.updatedAt ?? right.createdAt ?? '') -
          Date.parse(left.updatedAt ?? left.createdAt ?? ''),
      )[0]?.id ?? assetId,
    );
    preferredAssetByOriginalUrl.set(originalUrl, selection);
    return selection;
  };

  for (const hit of retrieval.hits ?? []) {
    const directAssetId = hit.metadata?.mediaAssetId;
    if (typeof directAssetId === 'string' && assetsById.has(directAssetId)) {
      return preferEvidenceQuality(directAssetId);
    }
    const assetId = assetIdByDocumentId.get(String(hit.documentId ?? ''));
    if (assetId) return preferEvidenceQuality(assetId);
  }

  return undefined;
}

/** Builds the SandboxManager config from the workspace's configured default sandbox provider. */
function resolveSandboxConfig(config: any): {
  backend: SandboxBackend;
  credentials?: Record<string, string>;
} {
  const backend = (config?.defaultSandboxProvider as SandboxBackend) || 'local';
  return { backend, credentials: config?.sandboxProviderConfigs?.[backend] };
}

export async function getChatTools(context: {
  projectId?: string;
  docSessionId?: string;
  config?: any;
  requestText?: string;
  /** Public origin of the incoming chat request, used for local media URLs. */
  origin?: string;
  /** Media source from the immediately preceding evidence-backed turn. */
  preferredMediaAssetId?: string;
}) {
  const { projectId, docSessionId, config, origin, requestText, preferredMediaAssetId } = context;
  // Installed tools are shared, while their connection/runtime selection is
  // project-scoped. Resolve that configuration once before constructing any
  // dynamic client so Local and Cloud tools always receive the active
  // project's settings rather than the install-time defaults.
  const activeProjectConfig = projectId
    ? await runWithProject(projectId, () => readConfig())
    : config;
  const activeVideoRuntimeScope = videoRuntimeScopeFromConfig(activeProjectConfig);
  const scopedAsset = async (mediaAssetId: string) => {
    const read = async () => (await readMediaAssets()).find((asset) => asset.id === mediaAssetId);
    const asset = projectId ? await runWithProject(projectId, read) : await read();
    return asset && isMediaAssetAvailableInRuntime(asset, activeVideoRuntimeScope)
      ? asset
      : undefined;
  };
  const authoritativeMediaAssetId = async (mediaAssetId: string) => {
    const read = async () => {
      const assets = await readMediaAssets();
      const requested = assets.find((asset) => asset.id === mediaAssetId);
      return requested ? newestEquivalentMediaAsset(requested, assets).id : mediaAssetId;
    };
    return projectId ? runWithProject(projectId, read) : read();
  };
  const indexedMediaContext = async (mediaAssetId: string) => {
    const read = async () => {
      const observations = await searchVideoKnowledge(mediaAssetId, '', 2_000, {
        modalities: ['computed', 'visual'],
        minimumRangeDistanceSecs: 0,
      }).catch(() => []);
      const preferred =
        observations
          .filter((hit) => {
            const text = evidenceText(hit.evidence.payload).trim();
            return (
              /^(?:Reconciled|Indexed) overview:/i.test(text) &&
              !/bounded (?:interactive )?inspection/i.test(text)
            );
          })
          .sort(
            (left, right) =>
              evidenceText(right.evidence.payload).length -
              evidenceText(left.evidence.payload).length,
          )[0] ??
        observations.find((hit) => {
          const text = evidenceText(hit.evidence.payload).trim();
          return (
            hit.evidence.modality === 'visual' &&
            text.length >= 80 &&
            !text.startsWith('{') &&
            !/^Detected objects:/i.test(text)
          );
        });
      return evidenceText(preferred?.evidence.payload)
        .split(/\nClaim question:/i, 1)[0]
        .trim()
        .slice(0, 900);
    };
    return projectId ? runWithProject(projectId, read) : read();
  };
  const scopedDocument = async (documentId: string) => {
    const read = async () => (await readDocuments()).find((document) => document.id === documentId);
    return projectId ? runWithProject(projectId, read) : read();
  };
  const pdfPagePreviewUrl = (documentId: string, pageNumber: number) => {
    const query = new URLSearchParams({ documentId, page: String(pageNumber) });
    if (projectId) query.set('projectId', projectId);
    return `/api/pdf-page?${query.toString()}`;
  };
  // Embeddings and vector providers are the host's concern, so the host
  // supplies the semantic ranking signal and the installed tool stays
  // responsible for retrieval strategy. Without it, a question asked in one
  // language scores zero against a source recorded in another and the ranked
  // lookup returns whatever happened to share a character with the question.
  // Concurrent modality searches share one scoring pass. The entry is removed
  // as soon as that pass completes: an inspection can append evidence and
  // activate a new manifest, so a later wave must score the new index.
  const semanticScorePasses = new Map<string, Promise<Map<string, number> | undefined>>();
  const semanticScoresFor = async (mediaAssetId: string, query: string) => {
    const key = `${mediaAssetId}\u0000${query}`;
    const active = semanticScorePasses.get(key);
    if (active) return active;
    const pass = searchSemanticEvidence(mediaAssetId, query, {
      topK: 60,
      abortSignal: AbortSignal.timeout(CHAT_SEMANTIC_LOOKUP_BUDGET_MS),
    })
      .then((hits) => (hits.length > 0 ? semanticScoresByEvidenceId(hits) : undefined))
      .catch(() => undefined);
    semanticScorePasses.set(key, pass);
    try {
      return await pass;
    } finally {
      if (semanticScorePasses.get(key) === pass) semanticScorePasses.delete(key);
    }
  };

  // The host only routes a source handle to an installed capability. The
  // tool remains responsible for retrieval, inspection, and grounding.
  const mediaEvidence = {
    getAsset: scopedAsset,
    planQuestion: (question: string) => planVideoQuestion(question),
    planInvestigation: async (mediaAssetId: string, question: string) => {
      if (!(await scopedAsset(mediaAssetId))) return undefined;
      const plan = () => buildVideoInvestigationPlan(mediaAssetId, question);
      return projectId ? runWithProject(projectId, plan) : plan();
    },
    search: async (
      mediaAssetId: string,
      query: string,
      limit: number,
      options: Parameters<typeof searchVideoKnowledge>[3] = {},
    ) => {
      if (!(await scopedAsset(mediaAssetId))) return [];
      const search = async () =>
        searchVideoKnowledge(mediaAssetId, query, limit, {
          ...options,
          semanticScores: options.semanticScores ?? (await semanticScoresFor(mediaAssetId, query)),
        });
      return projectId ? runWithProject(projectId, search) : search();
    },
    /**
     * Re-reads bounded windows of the original source for this question. The
     * host owns source access and the vision capability; the tool decides when
     * a claim is worth re-reading and what to do with the result.
     */
    reWatch: async (
      mediaAssetId: string,
      question: string,
      ranges: Array<{ startSecs: number; endSecs: number; lookingFor?: string }>,
      options?: { maxWaitMs?: number; knownEntities?: string[] },
    ) => {
      const asset = await scopedAsset(mediaAssetId);
      if (!asset || asset.type !== 'video' || asset.processingStatus !== 'completed') return [];
      const run = async () => {
        const outcome = await reWatchSource({
          asset,
          question,
          mediaAssetId,
          ranges: ranges.map((range) => ({ ...range, label: range.lookingFor })),
          maxWaitMs: options?.maxWaitMs,
          knownEntities: options?.knownEntities,
        });
        return (outcome?.findings ?? []).map((finding) => ({
          range: finding.range,
          at: finding.at,
          found: finding.found,
          read: finding.read,
          confidence: finding.confidence,
          settlesQuestion: finding.settlesQuestion,
        }));
      };
      return projectId ? runWithProject(projectId, run) : run();
    },
    /**
     * Ranked windows worth looking at, fused from every timestamped signal the
     * host holds. An installed tool decides what to do with them; this only
     * says where the agreement is.
     */
    locate: async (
      mediaAssetId: string,
      query: string,
      options: { maxRanges?: number; maxWindowSecs?: number } = {},
    ) => {
      if (!(await scopedAsset(mediaAssetId))) return [];
      const run = async () => {
        const [semanticEvidence, clipMatches] = await Promise.all([
          searchSemanticEvidence(mediaAssetId, query, {
            topK: 12,
            abortSignal: AbortSignal.timeout(CHAT_SEMANTIC_LOOKUP_BUDGET_MS),
          }).catch(() => []),
          queryVideoEmbeddings(mediaAssetId, query, 6).catch(() => []),
        ]);
        return fuseFocusRanges(
          [
            ...semanticEvidence.map((hit) => ({
              kind: 'semantic' as const,
              startSecs: hit.startSecs,
              endSecs: hit.endSecs,
              score: hit.score,
            })),
            ...clipMatches.map((match) => ({
              kind: 'clip-embedding' as const,
              startSecs: match.startSecs,
              endSecs: match.endSecs,
              score: match.score,
            })),
          ],
          options,
        );
      };
      return projectId ? runWithProject(projectId, run) : run();
    },
  };
  const sandboxReady = await isSandboxReady(config);
  const builtInTools: Record<string, any> = {
    searchKnowledgeBase: tool({
      description:
        "HIGHEST PRIORITY TOOL — Search the user's private RAG knowledge base. ALWAYS use this FIRST before webSearch or any other tool when the user asks a question. Search once with a focused query. If a result has a mediaAssetId and the question concerns media, call an installed evidence-query action with that exact id before answering. DO NOT call presentMedia automatically; only call it when the user explicitly asks to preview a moment.",
      inputSchema: z.object({
        query: z.string().describe('The search query for the knowledge base.'),
      }),
      execute: async ({ query }) => {
        const continuingAsset = preferredMediaAssetId
          ? await mediaEvidence.getAsset(preferredMediaAssetId)
          : undefined;
        if (continuingAsset?.processingStatus === 'completed') {
          return activeMediaFollowUpResult(
            query,
            continuingAsset,
            await indexedMediaContext(continuingAsset.id),
          );
        }
        // RAG is a locator, never an answer cache.  The chat route turns a
        // matched mediaAssetId into a separate, visible evidence-query tool
        // call. That action can then fall back to bounded live analysis.
        const retrieval = await queryKnowledgeBase(query, 4, projectId ?? null);
        return retrieval;
      },
    }),

    inspectPdfPages: tool({
      description:
        'Inspect pages from the original indexed PDF locally. Use the exact documentId returned by searchKnowledgeBase when the answer may depend on a PDF page that was not visual-indexed. This ranks nearby pages from local page text, extracts bounded page text and tables, and returns validated page-preview URLs. It never sends the PDF outside this workspace.',
      inputSchema: z.object({
        documentId: z.string().describe('Exact documentId returned by searchKnowledgeBase.'),
        question: z.string().describe('The focused user question used to select nearby PDF pages.'),
        pageNumbers: z
          .array(z.number().int().positive())
          .max(3)
          .optional()
          .describe('Optional exact PDF page numbers when the evidence already identifies them.'),
      }),
      execute: async ({ documentId, question, pageNumbers }) => {
        try {
          const document = await scopedDocument(documentId);
          if (!document) return { success: false, error: 'That PDF document is not available.' };
          const result = await inspectStoredPdf(document, question, pageNumbers, (pageNumber) =>
            pdfPagePreviewUrl(document.id, pageNumber),
          );
          return {
            success: true,
            documentId: document.id,
            title: document.title,
            ...result,
            ui: {
              kind: 'card',
              title: `Inspected ${document.title}`,
              facts: [
                {
                  label: 'Pages selected',
                  value: result.pages.map((page) => String(page.pageNumber)).join(', '),
                },
                { label: 'Total pages', value: String(result.totalPages) },
              ],
            },
          };
        } catch (error: any) {
          return { success: false, error: error.message ?? 'Could not inspect the PDF locally.' };
        }
      },
    }),

    analyzePdfPages: tool({
      description:
        'Analyze locally rendered pages from the original indexed PDF. Use after inspectPdfPages when the answer depends on a diagram, chart, image, equation layout, or other visual content. Pass the exact documentId and the selected page numbers. The source PDF stays local; only the bounded rendered pages are sent to the configured vision capability when one is enabled.',
      inputSchema: z.object({
        documentId: z.string().describe('Exact documentId returned by inspectPdfPages.'),
        pageNumbers: z
          .array(z.number().int().positive())
          .max(3)
          .optional()
          .describe(
            'Optional one to three page numbers returned by inspectPdfPages. Omit to reuse the local question-based selection.',
          ),
        prompt: z.string().describe('Precisely what to read or verify in the rendered PDF pages.'),
      }),
      execute: async ({ documentId, pageNumbers, prompt }) => {
        try {
          const document = await scopedDocument(documentId);
          if (!document) return { success: false, error: 'That PDF document is not available.' };
          const inspection = await inspectStoredPdf(document, prompt, pageNumbers, (pageNumber) =>
            pdfPagePreviewUrl(document.id, pageNumber),
          );
          const pages = await Promise.all(
            inspection.pages.map(async (page) => {
              const rendered = await renderStoredPdfPage(document, page.pageNumber);
              const response = await fetch(
                new URL(
                  `/api/describe-image${
                    projectId ? `?serverId=${encodeURIComponent(projectId)}` : ''
                  }`,
                  origin ?? 'http://127.0.0.1:4567',
                ),
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ base64: rendered.data.toString('base64'), prompt }),
                },
              );
              const data = await response.json().catch(() => ({}));
              return {
                ...page,
                analysis: response.ok ? data.description : undefined,
                error: response.ok
                  ? undefined
                  : (data.error ?? 'Visual analysis failed for this page.'),
              };
            }),
          );
          return {
            success: pages.some((page) => Boolean(page.analysis)),
            documentId: document.id,
            title: document.title,
            totalPages: inspection.totalPages,
            pages,
            ui: {
              kind: 'card',
              title: `Analyzed pages from ${document.title}`,
              facts: [
                { label: 'Pages', value: pages.map((page) => String(page.pageNumber)).join(', ') },
              ],
            },
          };
        } catch (error: any) {
          return { success: false, error: error.message ?? 'Could not analyze PDF pages.' };
        }
      },
    }),

    queryVideoKnowledge: tool({
      description:
        'Use this for every factual question about an indexed video or audio asset after searchKnowledgeBase identifies its mediaAssetId. It performs a fresh hierarchical investigation (chapters → scenes → events/states → active source evidence) on every call, returns seekable ranges, and highlights unresolved conflicts. Treat only returned active evidence as source truth. Use it for simple, temporal, comparative, exact-text, counting, and outcome questions before answering; do not infer a claim beyond these records. When verification says evidence is insufficient or inspection is required, inspect the bounded candidate range and query again before saying the answer is unknown.',
      inputSchema: z.object({
        mediaAssetId: z.string().describe('Exact mediaAssetId returned by searchKnowledgeBase.'),
        query: z.string().describe('The user’s focused question or sub-question about this media.'),
        limit: z.number().int().min(1).max(12).optional(),
      }),
      execute: async ({ mediaAssetId, query, limit }, { toolCallId }) => {
        mediaAssetId = await authoritativeMediaAssetId(mediaAssetId);
        const run = async (allowAutomaticInspection = true): Promise<any> => {
          const asset = await scopedAsset(mediaAssetId);
          if (!asset || asset.processingStatus !== 'completed') {
            return { success: false, error: 'That indexed media asset is no longer available.' };
          }
          const plan = planVideoQuestion(query);
          // These four locators are independent and each costs a network round
          // trip or a full state scan. Running them concurrently is most of the
          // difference between a chat answer that feels immediate and one that
          // reads as hung before any evidence has even been ranked.
          const [investigation, semantic, visualMatches, semanticEvidence, groupOverviewEvidence] =
            await Promise.all([
              buildVideoInvestigationPlan(mediaAssetId, query),
              // The regular RAG retriever owns embeddings/vector providers. Join
              // its media projection hits back to active Core evidence so video
              // answers get hybrid semantic + lexical retrieval without treating
              // vector documents as source truth.
              queryKnowledgeBase(query, 24, null),
              // Video-clip embeddings catch visual actions no caption/OCR/
              // transcript ever put into words. There is no existing evidence
              // record to join these to (the embedding IS the signal), so they
              // surface as candidate ranges for the agent to inspect via
              // watch_original/read_evidence, not as evidence themselves.
              queryVideoEmbeddings(mediaAssetId, query, 6),
              // Evidence-granular semantic retrieval. The corpus above matches
              // chapter-sized documents, which locates a fifteen-minute span
              // rather than a moment, and lexical scoring finds nothing at all
              // when the question and the source are in different languages.
              // This ranks the individual readings at their own timestamps.
              searchSemanticEvidence(mediaAssetId, query, { topK: 60 }),
              plan.kinds.includes('person-attribute') && !plan.subjectName
                ? searchVideoKnowledge(mediaAssetId, '', 2_000, {
                    modalities: ['visual', 'computed'],
                    minimumRangeDistanceSecs: 0,
                    videoDurationSecs: asset.durationSecs,
                  }).then((candidates) => {
                    const groupMoments = candidates.filter((candidate) => {
                      const range = candidate.evidence.timeRange;
                      const span = range.endSecs - range.startSecs;
                      if (span < 15 || span > 90) return false;
                      const text = evidenceText(candidate.evidence.payload);
                      return /\b(?:two|three|four|five|six|seven|eight|\d+)\s+(?:people|persons|participants|contestants|men|women|speakers|hosts|guests)\b|(?:اثنان|اثنين|ثلاثة|ثلاث|أربعة|اربعة|خمسة|ستة|سبعة|ثمانية|\d+)\s+(?:أشخاص|اشخاص|مشاركين|مشاركون|متنافسين|متنافسون|رجال|سيدات)/iu.test(
                        text,
                      );
                    });
                    // Opening title cards and fast-cut introductions often show
                    // everyone but are poor evidence for individual attributes.
                    // Prefer a later stable group view when one exists, without
                    // excluding the opening of genuinely short sources.
                    const stable = groupMoments.filter(
                      (candidate) => candidate.evidence.timeRange.startSecs >= 60,
                    );
                    const pool = stable.length > 0 ? stable : groupMoments;
                    const selected: typeof pool = [];
                    for (const candidate of pool.sort(
                      (left, right) =>
                        left.evidence.timeRange.startSecs - right.evidence.timeRange.startSecs,
                    )) {
                      if (
                        selected.some(
                          (existing) =>
                            Math.abs(
                              existing.evidence.timeRange.startSecs -
                                candidate.evidence.timeRange.startSecs,
                            ) < 20,
                        )
                      )
                        continue;
                      selected.push(candidate);
                      if (selected.length >= 4) break;
                    }
                    return selected;
                  })
                : Promise.resolve([]),
            ]);
          const semanticDocumentIds = semantic.hits
            .filter((hit: any) => hit.metadata?.mediaAssetId === mediaAssetId)
            .map((hit: any) => String(hit.documentId));
          const semanticScores = semanticEvidence.length
            ? semanticScoresByEvidenceId(semanticEvidence)
            : undefined;
          let hits = await searchVideoKnowledge(mediaAssetId, query, limit ?? 8, {
            modalities: plan.modalities,
            minimumRangeDistanceSecs: 2,
            semanticDocumentIds,
            semanticScores,
            queryPlan: plan,
            videoDurationSecs: asset.durationSecs,
          });
          // A question about a named person cannot be answered by describing
          // the scene generically. Ground the name to a transcript mention
          // before falling back to whole-scene evidence.
          const subjectMentions = plan.subjectName
            ? await searchVideoKnowledge(mediaAssetId, plan.subjectName, 3, {
                modalities: ['transcript'],
                minimumRangeDistanceSecs: 4,
                videoDurationSecs: asset.durationSecs,
              })
            : [];
          const subjectRange = subjectMentions[0]
            ? {
                // Identity is usually established over an exchange rather
                // than a single spoken token. Keep enough context on both
                // sides for a vision model to correlate who is addressed,
                // speaking, or camera-focused, while retaining a bounded
                // single-pass inspection.
                startSecs: Math.max(0, subjectMentions[0].evidence.timeRange.startSecs - 15),
                endSecs: subjectMentions[0].evidence.timeRange.endSecs + 15,
              }
            : undefined;
          const overlapsSubjectRange = (hit: (typeof hits)[number]) =>
            Boolean(
              subjectRange &&
              hit.evidence.timeRange.startSecs < subjectRange.endSecs &&
              hit.evidence.timeRange.endSecs > subjectRange.startSecs,
            );
          // Every video question receives a compact tail view. It lets the
          // agent reason about an ending/state transition when relevant,
          // without encoding a sports, meeting, surveillance, or language
          // specific workflow in the runtime.
          const tailRange = asset.durationSecs
            ? {
                // Keep the terminal view large enough to contain a complete
                // closing exchange/result. It matches the one-minute
                // interactive inspection cap, so a likely outcome can be
                // verified in one sparse semantic worker pass.
                startSecs: Math.max(0, asset.durationSecs - LIMITS.durationSecs),
                endSecs: asset.durationSecs,
              }
            : undefined;
          // How a source concludes is rarely confined to its final minute -- a
          // result is announced, shown, and discussed, and then the recording
          // runs on through reactions and sign-off. Reading the closing *phase*
          // rather than the closing minute is what makes a concluding state
          // findable at all; `tailRange` stays narrow because it also sizes a
          // bounded re-decode, which this does not.
          const closingRange = asset.durationSecs
            ? {
                startSecs: Math.max(
                  0,
                  asset.durationSecs -
                    Math.min(900, Math.max(LIMITS.durationSecs, asset.durationSecs * 0.2)),
                ),
                endSecs: asset.durationSecs,
              }
            : undefined;
          // Two views of the closing phase, because they fail in opposite ways.
          // Descriptive readings state a concluding value plainly but are
          // sparse; speech is dense but, on conversational audio, is mostly
          // fragments. Ranking them together lets whichever is noisier for this
          // source crowd the other out, so each is retrieved to its own quota.
          const [closingDescriptive, closingAny] = closingRange
            ? await Promise.all([
                searchVideoKnowledge(mediaAssetId, query, 8, {
                  modalities: ['visual', 'computed'],
                  minimumRangeDistanceSecs: 0,
                  semanticScores,
                  queryPlan: plan,
                  videoDurationSecs: asset.durationSecs,
                  timeRange: closingRange,
                }),
                searchVideoKnowledge(mediaAssetId, query, 6, {
                  modalities: plan.modalities,
                  minimumRangeDistanceSecs: 0,
                  semanticScores,
                  queryPlan: plan,
                  videoDurationSecs: asset.durationSecs,
                  timeRange: closingRange,
                }),
              ])
            : [[], []];
          const closingEvidence = [
            ...closingDescriptive,
            ...closingAny.filter(
              (candidate) =>
                !closingDescriptive.some(
                  (existing) => existing.evidence.id === candidate.evidence.id,
                ),
            ),
          ];
          // Lexical OCR often outranks a VLM observation on an empty tail
          // lookup. Outcome evidence must still include the bounded visual
          // interpretation of that terminal range, otherwise chat silently
          // falls back to text fragments despite a completed GPU analysis.
          const terminalSemanticEvidence =
            closingRange && plan.kinds.includes('outcome')
              ? await searchVideoKnowledge(mediaAssetId, query, 4, {
                  modalities: ['visual', 'computed'],
                  minimumRangeDistanceSecs: 0,
                  semanticScores,
                  queryPlan: plan,
                  videoDurationSecs: asset.durationSecs,
                  timeRange: closingRange,
                })
              : [];
          if (terminalSemanticEvidence.length > 0) {
            const terminalEvidenceIds = new Set(
              terminalSemanticEvidence.map((hit) => hit.evidence.id),
            );
            hits = [
              ...terminalSemanticEvidence,
              ...hits.filter((hit) => !terminalEvidenceIds.has(hit.evidence.id)),
            ].slice(0, limit ?? 8);
          }
          const closingEvidenceWithSemantics = [
            ...closingEvidence,
            ...terminalSemanticEvidence.filter(
              (candidate) =>
                !closingEvidence.some((existing) => existing.evidence.id === candidate.evidence.id),
            ),
          ];
          // Typed state evidence records short text that recurred on screen,
          // kept distinct from free-form OCR. It locates where a display was
          // present and when it changed, for any question about how a source
          // ends up; it never establishes what that text refers to.
          const structuredOutcomeHit = plan.kinds.includes('outcome')
            ? hits.find((hit) => structuredStateFromEvidence(hit.evidence))
            : undefined;
          const structuredOutcomeState = structuredOutcomeHit
            ? structuredStateFromEvidence(structuredOutcomeHit.evidence)
            : undefined;
          // A named-person appearance answer must be anchored to a visual
          // observation from the range where that identity was grounded.
          // Otherwise a generic scene caption can silently attach another
          // person's clothing or action to the requested name.
          if (plan.subjectName && subjectRange) {
            const groundedVisualHits = hits.filter(
              (hit) => hit.evidence.modality === 'visual' && overlapsSubjectRange(hit),
            );
            hits = groundedVisualHits;
          }
          const verification = await verifyMediaEvidence({
            mediaAssetId,
            evidenceIds: hits.map((hit) => hit.evidence.id),
            requiresFramePrecision: /\b(exact|precisely|frame|at\s+\d{1,2}:\d{2})\b/i.test(query),
          });
          const requiresCorroboration = plan.kinds.some((kind) =>
            [
              'outcome',
              'state-change',
              'comparison',
              'counting',
              'computation',
              'person-attribute',
            ].includes(kind),
          );
          // Where to look is decided by fusing every timestamped signal
          // retrieval produced -- semantic evidence, cross-modal clip vectors,
          // lexical hits, the indexed hierarchy, and the source's own ending --
          // rather than by a fixed rule per claim kind. A conclusion is often
          // stated before the last minute of a recording, and the moment that
          // answers a question is frequently nowhere near the top-ranked
          // chapter, so agreement between independent signals locates it far
          // more reliably than any single one of them.
          const focusSignals: FocusSignal[] = [
            ...groupOverviewEvidence.slice(0, 3).map((hit) => ({
              kind: 'lexical' as const,
              startSecs: hit.evidence.timeRange.startSecs,
              endSecs: hit.evidence.timeRange.endSecs,
              score: 2,
              label: 'bounded multi-subject view',
            })),
            ...semanticEvidence
              .filter((hit) => hit.endSecs - hit.startSecs <= 180)
              .slice(0, 12)
              .map((hit) => ({
                kind: 'semantic' as const,
                startSecs: hit.startSecs,
                endSecs: hit.endSecs,
                score: hit.score,
              })),
            ...visualMatches.map((match) => ({
              kind: 'clip-embedding' as const,
              startSecs: match.startSecs,
              endSecs: match.endSecs,
              score: match.score,
            })),
            ...hits
              .filter(
                (hit) => hit.evidence.timeRange.endSecs - hit.evidence.timeRange.startSecs <= 180,
              )
              .slice(0, 8)
              .map((hit) => ({
                kind: 'lexical' as const,
                startSecs: hit.evidence.timeRange.startSecs,
                endSecs: hit.evidence.timeRange.endSecs,
                score: hit.score,
              })),
            ...(investigation?.candidateRanges ?? []).slice(0, 6).map((range, position) => ({
              kind: 'hierarchy' as const,
              startSecs: range.startSecs,
              endSecs: range.endSecs,
              score: 1 - position * 0.15,
              label: range.reason,
            })),
            // How a source concludes is a prior, never an instruction: it only
            // ever competes with the other signals for a question whose answer
            // is a resolution or a final state. Where in the closing phase to
            // look is itself decided by relevance -- the best semantic match
            // inside that phase -- rather than by pointing blindly at the last
            // minute, which is usually sign-off rather than substance.
            ...(closingRange &&
            (plan.kinds.includes('outcome') || plan.kinds.includes('state-change'))
              ? (() => {
                  const closing = semanticEvidence
                    .filter(
                      (hit) =>
                        hit.startSecs <= closingRange.endSecs &&
                        hit.endSecs >= closingRange.startSecs,
                    )
                    .slice(0, 3);
                  return closing.length > 0
                    ? closing.map((hit) => ({
                        kind: 'ending' as const,
                        startSecs: hit.startSecs,
                        endSecs: hit.endSecs,
                        score: hit.score,
                      }))
                    : [
                        {
                          kind: 'ending' as const,
                          startSecs: tailRange?.startSecs ?? closingRange.startSecs,
                          endSecs: closingRange.endSecs,
                          score: 1,
                        },
                      ];
                })()
              : []),
          ];
          const allFocusRanges = fuseFocusRanges(focusSignals, {
            maxRanges: 8,
            maxWindowSecs: LIMITS.durationSecs,
          });
          // A recurring on-screen state looks identical to a semantic ranker
          // wherever it occurs, so a mid-source reading of it can outrank the
          // concluding one on similarity alone. When the question is explicitly
          // about how the source ended, time is the only thing that separates
          // them: keep the closing phase in front, and fall back to the full
          // list only when nothing there matched at all.
          const closingFocusRanges =
            closingRange && plan.kinds.includes('outcome')
              ? allFocusRanges.filter(
                  (range) =>
                    range.startSecs <= closingRange.endSecs &&
                    range.endSecs >= closingRange.startSecs,
                )
              : [];
          const focusRanges = (
            closingFocusRanges.length > 0
              ? [
                  ...closingFocusRanges,
                  ...allFocusRanges.filter((range) => !closingFocusRanges.includes(range)),
                ]
              : allFocusRanges
          ).slice(0, 5);
          // A named-person claim is still verified from where that person is
          // named or addressed -- identity grounding outranks topical signal.
          const requestedRange = subjectRange ?? focusRanges[0] ?? tailRange;
          const recommendedInspection = requestedRange
            ? {
                startSecs: requestedRange.startSecs,
                endSecs: Math.min(
                  requestedRange.endSecs,
                  requestedRange.startSecs +
                    (plan.kinds.includes('outcome') ? LIMITS.durationSecs : 30),
                ),
                purpose: plan.kinds.includes('counting')
                  ? 'count'
                  : plan.kinds.includes('exact-ocr')
                    ? 'high-res-ocr'
                    : plan.kinds.includes('comparison') || plan.kinds.includes('state-change')
                      ? 'compare'
                      : 'verify-visual',
                ...(plan.subjectName
                  ? {
                      focusHint: `Multiple people may be visible in this range. Identify which visible person is "${plan.subjectName}" (named or addressed near this moment) and describe that specific person, not the scene in general.`,
                    }
                  : {}),
              }
            : undefined;
          // Outcome claims need a short semantic read of the ending, not just
          // an object/OCR anchor that happens to overlap it. A whole-video
          // summary is navigation context only: it cannot establish what
          // happened at the end. Counts, computed answers, comparisons, and
          // state changes always need deliberate bounded coverage too.
          const hasTerminalSemanticEvidence = closingEvidenceWithSemantics.some(
            (hit) =>
              hit.evidence.modality === 'visual' &&
              hit.evidence.confidence.score >= 0.5 &&
              hit.evidence.timeRange.endSecs - hit.evidence.timeRange.startSecs <= 180 &&
              hit.evidence.confidence.uncertaintyReasons.some((reason) =>
                reason.includes('Semantic VLM interpretation'),
              ),
          );
          const hasTerminalDirectVerdict = closingEvidenceWithSemantics.some(
            (hit) =>
              hit.evidence.modality === 'visual' &&
              /Claim verdict:\s*direct/i.test(evidenceText(hit.evidence.payload)),
          );
          // Re-decoding the source is the single slowest thing this tool can
          // do. The shared gate evaluates indexed provenance, confidence,
          // temporal coverage, and locator agreement before any live read.
          const topFocusRange = focusRanges[0];
          const sufficiencyCandidates = [
            ...hits,
            ...closingEvidenceWithSemantics.filter(
              (candidate) =>
                !hits.some((existing) => existing.evidence.id === candidate.evidence.id),
            ),
          ];
          const indexAlreadyAnswers = indexedVideoEvidenceIsSufficient({
            verificationStatus: verification.status,
            questionKinds: plan.kinds,
            evidence: sufficiencyCandidates.map((hit) => ({
              modality: hit.evidence.modality,
              text: evidenceText(hit.evidence.payload),
              confidenceScore: hit.evidence.confidence.score,
              startSecs: hit.evidence.timeRange.startSecs,
              endSecs: hit.evidence.timeRange.endSecs,
              conflict: hit.conflict,
            })),
            focusSources: topFocusRange?.sources,
            durationSecs: asset.durationSecs,
            hierarchyRanges: investigation?.coverage?.representedRanges,
          });
          const requiresFreshInspection =
            !indexAlreadyAnswers &&
            (verification.status !== 'supported' ||
              plan.kinds.some((kind) =>
                [
                  'state-change',
                  'comparison',
                  'counting',
                  'computation',
                  'person-attribute',
                ].includes(kind),
              ) ||
              (plan.kinds.includes('outcome') &&
                (!hasTerminalSemanticEvidence || !hasTerminalDirectVerdict)));
          // Device entitlements are evaluated by the managed cloud control
          // plane. An unlimited plan may inspect the bounded range directly;
          // every other installation keeps the conservative browser budget.
          const videoRuntimeConfig = activeProjectConfig?.toolConfigs?.['video-intelligence'];
          const usesManagedCloudRuntime =
            (videoRuntimeConfig?.runtimeMode ?? 'managed-cloud') === 'managed-cloud';
          // A RAG-complete answer must stay entirely local to the index. Even
          // checking remote inspection capacity adds avoidable chat latency
          // and makes the fast path look like analysis was involved.
          const hasManagedCloudCapacity =
            usesManagedCloudRuntime && requiresFreshInspection && recommendedInspection
              ? await hasVideoIntelligenceCapacity().catch(() => false)
              : false;
          const inspectionDecision = hasManagedCloudCapacity
            ? {
                decision:
                  requiresCorroboration && requiresFreshInspection
                    ? ('required' as const)
                    : ('optional' as const),
                reason: 'managed-cloud-entitlement',
                committed: {
                  durationSecs: recommendedInspection
                    ? recommendedInspection.endSecs - recommendedInspection.startSecs
                    : 30,
                  bytes: 64 * 1024 * 1024,
                  sandboxSeconds: 30,
                  spendUsd: 0,
                },
              }
            : decideInspection({
                required:
                  (requiresCorroboration && requiresFreshInspection) ||
                  (plan.requiresInspectionWhenInsufficient &&
                    ['insufficient', 'needs_inspection'].includes(verification.status)) ||
                  false,
                plausibleRange: Boolean(recommendedInspection),
                estimate: {
                  // A wide recommendedInspection (up to 180s for an outcome
                  // claim) is never dispatched as one request -- it's
                  // chunked into <=LIMITS.durationSecs pieces below. Budget
                  // against one chunk's real cost, not the full range, or
                  // this always trips exceedsPerBundle and gets downgraded
                  // to background-refinement before a single chunk ever runs.
                  durationSecs: recommendedInspection
                    ? Math.min(
                        recommendedInspection.endSecs - recommendedInspection.startSecs,
                        LIMITS.durationSecs,
                      )
                    : 30,
                  bytes: 64 * 1024 * 1024,
                  sandboxSeconds: 30,
                  spendUsd: 0,
                  lowerResolutionProbability: hits.length > 0 ? 0.65 : 0,
                },
                budget: {
                  remainingDurationSecs: 180,
                  remainingBytes: 1024 * 1024 * 1024,
                  remainingSandboxSeconds: 600,
                  remainingSpendUsd: 0.5,
                  usedBundleRuns: 0,
                },
              });
          let autoInspection:
            | {
                status: 'completed' | 'failed';
                range: { startSecs: number; endSecs: number };
                purpose: string;
                evidenceCount?: number;
                chunksInspected?: number;
                error?: string;
                rule?: string;
              }
            | undefined;
          // Before paying for a dispatched re-index, re-watch the candidate
          // windows directly. Sampling frames off the source and reading them
          // in one request settles most questions in seconds, where the
          // dispatched path spends minutes on a cold worker and routinely
          // outlives the turn -- which is what makes an answerable question
          // come back as "the video does not show this".
          const rewatch =
            allowAutomaticInspection && requiresFreshInspection && recommendedInspection
              ? await reWatchSource({
                  asset,
                  question: query,
                  ranges:
                    groupOverviewEvidence.length > 0
                      ? groupOverviewEvidence.slice(0, 1).map((hit) => ({
                          startSecs: hit.evidence.timeRange.startSecs,
                          endSecs: hit.evidence.timeRange.endSecs,
                          label: 'bounded multi-subject view',
                        }))
                      : plan.kinds.includes('person-attribute') && !plan.subjectName
                        ? [recommendedInspection]
                        : (focusRanges.length > 0 ? focusRanges : [recommendedInspection]).slice(
                            0,
                            3,
                          ),
                  subjectName: plan.subjectName,
                  mediaAssetId,
                })
              : undefined;
          // A re-watch reads the source; it does not add to the index. So there
          // is nothing to re-retrieve, and the reading simply travels with the
          // evidence already gathered below.
          const settledByReWatch = Boolean(rewatch?.findings.length);
          if (
            !settledByReWatch &&
            allowAutomaticInspection &&
            inspectionDecision.decision === 'required' &&
            recommendedInspection &&
            origin
          ) {
            const inspectionUrl = new URL('/api/media/inspect', origin);
            if (projectId) inspectionUrl.searchParams.set('projectId', projectId);
            // A single request wider than LIMITS.durationSecs always gets
            // downgraded to background-refinement by decideInspection (see
            // inspection-policy.ts) instead of running now -- an outcome
            // question's recommended range can be up to 180s, so it must be
            // dispatched as sequential <=LIMITS.durationSecs chunks, not one
            // call, or the automatic inspection silently never happens.
            // Ordered by whatever signal already exists (a visual-embedding
            // match scores higher relevance to the actual question than a
            // blind guess), tail-first as the fallback tiebreak since a
            // concluding state is often near the end: stop as soon as
            // a chunk actually resolves the claim instead of always
            // spending the full budget. This is claim/signal-driven, not
            // tied to any particular language, domain, or video.
            const chunkSignalScore = (chunk: { startSecs: number; endSecs: number }) =>
              visualMatches.reduce(
                (sum, match) =>
                  sum +
                  (match.startSecs < chunk.endSecs && match.endSecs > chunk.startSecs
                    ? match.score
                    : 0),
                0,
              );
            const chunks = chunkTimeRange(
              recommendedInspection.startSecs,
              recommendedInspection.endSecs,
              LIMITS.durationSecs,
            ).sort(
              (a, b) => chunkSignalScore(b) - chunkSignalScore(a) || b.startSecs - a.startSecs,
            );
            let evidenceCount = 0;
            let chunksCompleted = 0;
            let refined: any;
            let chunkError: string | undefined;
            let workerTimedOut = false;
            // Chunks are signal-ordered, not necessarily chronological, so
            // the covered span has to be tracked explicitly rather than
            // read off however many were visited from one end.
            let coveredStartSecs = recommendedInspection.endSecs;
            let coveredEndSecs = recommendedInspection.startSecs;
            // A person is watching this answer arrive. Each chunk may wait out
            // a cold worker, so without a ceiling across the whole loop a
            // multi-chunk range can hold one chat turn open for many minutes.
            // Spend the budget on the best-ranked chunks and then answer from
            // what was gathered, rather than making the wait unbounded.
            const inspectionDeadline = Date.now() + CHAT_INSPECTION_BUDGET_MS;
            let budgetExhausted = false;
            for (const chunk of chunks) {
              if (Date.now() >= inspectionDeadline) {
                budgetExhausted = true;
                break;
              }
              try {
                const response = await fetch(inspectionUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    mediaAssetId,
                    startSecs: chunk.startSecs,
                    endSecs: chunk.endSecs,
                    purpose: recommendedInspection.purpose,
                    queryId: `chat-verification:${mediaAssetId}:${query}:${chunk.startSecs}`.slice(
                      0,
                      128,
                    ),
                    question: recommendedInspection.focusHint
                      ? `${query}\n\n${recommendedInspection.focusHint}`
                      : query,
                    ...(plan.subjectName ? { knownEntities: [plan.subjectName] } : {}),
                    maxFrames: 24,
                    toolCallId,
                    // Never let one chunk consume the whole interactive budget.
                    maxWaitMs: Math.max(30_000, inspectionDeadline - Date.now()),
                  }),
                });
                const inspectionResult = await response.json().catch(() => ({}));
                if (!response.ok) {
                  chunkError =
                    typeof inspectionResult.error === 'string'
                      ? inspectionResult.error
                      : `Inspection returned HTTP ${response.status}.`;
                  // The analysis service itself didn't respond -- trying more
                  // chunks just means more multi-minute waits for the same
                  // outcome, so stop immediately rather than after every
                  // remaining chunk times out too.
                  if (response.status === 504 || inspectionResult.workerTimeout) {
                    workerTimedOut = true;
                  }
                  break;
                }
                chunksCompleted += 1;
                coveredStartSecs = Math.min(coveredStartSecs, chunk.startSecs);
                coveredEndSecs = Math.max(coveredEndSecs, chunk.endSecs);
                evidenceCount += Array.isArray(inspectionResult.evidence)
                  ? inspectionResult.evidence.length
                  : 0;
                refined = await run(false);
                if (!refined?.claimVerification?.requiresCorroboration) break;
              } catch (error) {
                chunkError = error instanceof Error ? error.message : 'Cloud inspection failed.';
                break;
              }
            }
            if (chunksCompleted > 0) {
              // Every available chunk was actually inspected (not deferred,
              // not timed out) and the claim still isn't fully corroborated
              // -- more bounded inspection of this same range won't change
              // that. Rather than leave requiresCorroboration true forever
              // (which reads to the model as "keep trying" indefinitely,
              // producing either an infinite tool-call loop or a refusal to
              // answer), tell it plainly that the search budget for this
              // claim is exhausted and a best-effort, confidence-qualified
              // answer from the gathered evidence is expected now.
              // Exhausted either by running out of candidate chunks, or by a
              // chunk failing partway through (chunkError) -- either way, at
              // least one real inspection already ran and no further
              // automatic one will follow, so the same instruction applies.
              const exhausted =
                (chunksCompleted >= chunks.length || Boolean(chunkError) || budgetExhausted) &&
                refined?.claimVerification?.requiresCorroboration;
              return {
                ...refined,
                ...(exhausted
                  ? {
                      claimVerification: {
                        ...refined.claimVerification,
                        requiresCorroboration: false,
                        rule: 'Every available bounded range for this claim has now been inspected; no further inspection of this range is possible. Answer from the gathered evidence, stating your confidence level and citing the specific evidence (or its absence) rather than declining to answer or claiming the video does not show it.',
                      },
                    }
                  : {}),
                autoInspection: {
                  status: 'completed' as const,
                  range: { startSecs: coveredStartSecs, endSecs: coveredEndSecs },
                  purpose: recommendedInspection.purpose,
                  evidenceCount,
                  chunksInspected: chunksCompleted,
                },
              };
            }
            autoInspection = {
              status: 'failed',
              range: {
                startSecs: recommendedInspection.startSecs,
                endSecs: recommendedInspection.endSecs,
              },
              purpose: recommendedInspection.purpose,
              ...(workerTimedOut
                ? {
                    rule: "The video analysis service didn't respond -- this range was never actually checked. Tell the user the check couldn't run right now; never phrase this as the video not showing the answer.",
                  }
                : {}),
              error: chunkError ?? 'Cloud inspection failed.',
            };
          }
          void trackUsageEvent({
            type: 'media_processing',
            mediaOperation: 'investigation',
            mediaAssetId,
            queryKind: plan.kinds.join(','),
            evidenceCount: hits.length,
            timestamp: new Date().toISOString(),
          });
          const sourceUrl = `/api/media/${asset.id}${
            projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
          }`;
          const buildSeekUrl = (startSecs: number): string | undefined => {
            if (asset.originalUrl) {
              try {
                const url = new URL(asset.originalUrl);
                if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
                  url.searchParams.set('t', String(Math.floor(startSecs)));
                  return url.toString();
                }
              } catch {}
            }
            return `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}t=${startSecs}`;
          };
          const modalityLabel = (modality: string) =>
            modality === 'transcript'
              ? 'Speech'
              : modality === 'ocr'
                ? 'On-screen text'
                : modality === 'visual'
                  ? 'Visual'
                  : modality === 'audio-event'
                    ? 'Audio'
                    : modality === 'computed'
                      ? 'Timeline'
                      : 'Evidence';
          // Renders through the host's generic output.ui.kind contract
          // (message-item.tsx / chat-citations.tsx) -- the same mechanism
          // any marketplace tool's result can use, nothing video-specific
          // hardcoded on the chat-UI side. A clip is only offered when
          // verification actually supports the claim being cited.
          const primarySupportingHit =
            plan.subjectName && subjectRange
              ? hits.find(
                  (hit) =>
                    hit.evidence.modality === 'visual' &&
                    overlapsSubjectRange(hit) &&
                    !hit.conflict &&
                    Number.isFinite(hit.evidence.timeRange.startSecs),
                )
              : hits.find(
                  (hit) => !hit.conflict && Number.isFinite(hit.evidence.timeRange.startSecs),
                );
          const ui = {
            kind: 'citations' as const,
            title: asset.fileName,
            fileName: asset.fileName,
            mediaType: 'video' as const,
            ...(verification.status === 'supported' && primarySupportingHit
              ? {
                  mediaUrl: sourceUrl,
                  primaryTimestampSecs: primarySupportingHit.evidence.timeRange.startSecs,
                }
              : {}),
            items: hits.map((hit) => ({
              label: modalityLabel(hit.evidence.modality),
              detail: evidenceText(hit.evidence.payload),
              timestampSecs: hit.evidence.timeRange.startSecs,
              seekUrl: buildSeekUrl(hit.evidence.timeRange.startSecs),
              conflicted: hit.conflict,
            })),
          };
          const result = {
            success: true,
            mediaAssetId: asset.id,
            fileName: asset.fileName,
            sourceUrl,
            originalUrl: asset.originalUrl,
            ui,
            verification,
            plan,
            // The full hierarchy is chapter and scene summaries running to
            // tens of thousands of characters. Streaming that into every
            // answer crowds out the evidence itself and slows the turn down
            // for no gain, so what ships here is a navigable map: timecodes
            // and titles only. `planVideoInvestigation` still returns the
            // detail when the model deliberately asks for it.
            ...(investigation
              ? {
                  timeline: {
                    strategy: investigation.strategy,
                    coverage: investigation.coverage,
                    chapters: investigation.timeline.map((chapter) => ({
                      at: `${formatTimecode(chapter.startSecs)}–${formatTimecode(chapter.endSecs)}`,
                      startSecs: chapter.startSecs,
                      endSecs: chapter.endSecs,
                      title: chapter.title,
                    })),
                    rule: 'A map of the source for navigation only. It never establishes a fact; call read_evidence on a range to read what is actually recorded there.',
                  },
                }
              : {}),
            // The ranked answer to "where should I look?", fused from every
            // timestamped signal. This is what the model should navigate by.
            ...(focusRanges.length > 0
              ? {
                  focusRanges: {
                    ranges: focusRanges.map((range) => ({
                      at: `${formatTimecode(range.startSecs)}–${formatTimecode(range.endSecs)}`,
                      startSecs: range.startSecs,
                      endSecs: range.endSecs,
                      score: range.score,
                      agreedBy: range.sources,
                      ...(range.label ? { label: range.label } : {}),
                    })),
                    rule: 'Ranked by how strongly independent retrieval signals agree that the answer is in the window, not by evidence content. When the evidence below is not enough, call read_evidence on the top range first, and watch_original only if reading it still leaves the question open.',
                  },
                }
              : {}),
            ...(plan.subjectName
              ? {
                  entityGrounding: subjectRange
                    ? {
                        resolved: true,
                        subjectName: plan.subjectName,
                        range: subjectRange,
                        rule: "Describe this named person only from visual evidence overlapping the grounded range. Do not assign another visible person's clothing, action, or appearance based on a generic scene caption.",
                      }
                    : {
                        resolved: false,
                        subjectName: plan.subjectName,
                        rule: `No transcript mention of "${plan.subjectName}" was found, so no visible person could be linked to that name. Say plainly that this person couldn't be identified in the video rather than describing the scene generically as if it answered the question.`,
                      },
                }
              : {}),
            ...(closingRange
              ? {
                  claimVerification: {
                    // The window `closingEvidence` was actually drawn from.
                    // Reporting the narrower inspection-sized tail here made
                    // the model treat evidence from the closing phase as
                    // out-of-range and discard it.
                    closingRange: {
                      ...closingRange,
                      at: `${formatTimecode(closingRange.startSecs)}–${formatTimecode(
                        closingRange.endSecs,
                      )}`,
                    },
                    claimKinds: plan.kinds,
                    // The source itself was just read for this question, so
                    // asking for corroboration would only send the turn back
                    // for evidence it already has.
                    requiresCorroboration:
                      requiresCorroboration && requiresFreshInspection && !settledByReWatch,
                    ...(recommendedInspection && !settledByReWatch
                      ? { recommendedInspection }
                      : {}),
                    rule: settledByReWatch
                      ? 'The source was re-watched for this question; answer from what the readings in directObservation established, and cite their timestamps.'
                      : structuredOutcomeState
                        ? 'A structured source state establishes only its displayed value. Do not assign the value to an identity, owner, or category unless evidence from the same source range explicitly identifies that mapping. Match the evidence range to the claim being made; never promote a local observation into a broader conclusion.'
                        : 'Match the evidence range to the claim being made. When requiresCorroboration is true, run the recommended bounded inspection before answering, then query this tool again. Never promote a local observation into a broader conclusion.',
                    closingEvidence: closingEvidenceWithSemantics.map((hit) => ({
                      evidenceId: hit.evidence.id,
                      modality: hit.evidence.modality,
                      at: formatTimecode(hit.evidence.timeRange.startSecs),
                      text: evidenceText(hit.evidence.payload),
                      startSecs: hit.evidence.timeRange.startSecs,
                      endSecs: hit.evidence.timeRange.endSecs,
                      confidence: hit.evidence.confidence,
                    })),
                  },
                }
              : {}),
            ...(structuredOutcomeHit && structuredOutcomeState
              ? {
                  structuredOutcomeState: {
                    ...structuredOutcomeState,
                    startSecs: structuredOutcomeHit.evidence.timeRange.startSecs,
                    endSecs: structuredOutcomeHit.evidence.timeRange.endSecs,
                    confidence: structuredOutcomeHit.evidence.confidence,
                    rule: 'This is a compact value read from the source. It establishes the displayed value, but not the identity or meaning of either side unless that mapping is also present in the cited evidence.',
                  },
                }
              : {}),
            retrievalCapabilities: videoKnowledgeRetrievalCapabilities(),
            inspectionDecision,
            ...(rewatch
              ? {
                  directObservation: {
                    findings: rewatch.findings,
                    elapsedMs: rewatch.elapsedMs,
                    rule:
                      'These are direct readings taken by re-watching the source just now, for ' +
                      'this question. Answer from them and cite the timestamps they came from, ' +
                      'and do not report that the source fails to show something a reading here ' +
                      'establishes. Weigh them against each other and against the indexed ' +
                      'evidence rather than taking each at face value: a reading is strongest ' +
                      'where several readings and the index agree. A lone reading that ' +
                      'contradicts both the other readings and the index -- naming someone or ' +
                      'something that appears nowhere else -- is a misreading, whatever ' +
                      'confidence it carries; leave it out rather than reporting it.',
                  },
                }
              : {}),
            ...(autoInspection ? { autoInspection } : {}),
            ...(visualMatches.length > 0
              ? {
                  visualMatches: {
                    matches: visualMatches,
                    rule: 'Ranked by visual similarity only, not evidence. If the transcript/OCR/caption evidence above does not answer the question, call watch_original (inspectVideoKnowledge) or read_evidence on the highest-scoring range here before answering.',
                  },
                }
              : {}),
            evidence: hits.map((hit) => {
              const rawText = evidenceText(hit.evidence.payload);
              return {
                evidenceId: hit.evidence.id,
                modality: hit.evidence.modality,
                text: rawText,
                startSecs: hit.evidence.timeRange.startSecs,
                endSecs: hit.evidence.timeRange.endSecs,
                precision: hit.evidence.timeRange.precision,
                confidence: hit.evidence.confidence,
                conflicted: hit.conflict,
              };
            }),
          };
          // Video questions deliberately do not reuse answer or miss memory.
          // A later turn always starts from current indexed evidence and may
          // request a fresh bounded analysis when that evidence is incomplete.
          return result;
        };
        return projectId ? runWithProject(projectId, run) : run();
      },
    }),

    planVideoInvestigation: tool({
      description:
        'Plan a complex video investigation before source inspection. It searches the active time hierarchy (chapters, scenes, events, states) and returns the best candidate ranges. Use this when queryVideoKnowledge has weak or no direct evidence, or when the question requires before/after reasoning, tracking, counting, or a chain of events. Then inspect only the returned range(s), never the entire video.',
      inputSchema: z.object({
        mediaAssetId: z.string().describe('Exact mediaAssetId returned by searchKnowledgeBase.'),
        question: z.string().describe('The full user question, including any temporal conditions.'),
      }),
      execute: async ({ mediaAssetId, question }) => {
        const run = async () => {
          const asset = await scopedAsset(mediaAssetId);
          if (!asset || asset.processingStatus !== 'completed') {
            return { success: false, error: 'That indexed media asset is no longer available.' };
          }
          const investigation = await buildVideoInvestigationPlan(mediaAssetId, question);
          if (!investigation)
            return { success: false, error: 'No active video knowledge revision is available.' };
          void trackUsageEvent({
            type: 'media_processing',
            mediaOperation: 'investigation',
            mediaAssetId,
            queryKind: 'planner',
            timestamp: new Date().toISOString(),
          });
          return { success: true, ...investigation };
        };
        return projectId ? runWithProject(projectId, run) : run();
      },
    }),

    read_evidence: tool({
      description:
        'Read every recorded piece of evidence (transcript, OCR, visual, computed) whose timestamp falls inside a specific window, in chronological order — no relevance ranking or query terms. Use this once queryVideoKnowledge or planVideoInvestigation has narrowed to a candidate range and you need the full, literal record of what is known there, not a search over it.',
      inputSchema: z.object({
        mediaAssetId: z.string().describe('Exact mediaAssetId returned by searchKnowledgeBase.'),
        startSecs: z.number().nonnegative(),
        endSecs: z.number().nonnegative(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ mediaAssetId, startSecs, endSecs, limit }) => {
        const run = async () => {
          const asset = await scopedAsset(mediaAssetId);
          if (!asset || asset.processingStatus !== 'completed') {
            return { success: false, error: 'That indexed media asset is no longer available.' };
          }
          const hits = await searchVideoKnowledge(mediaAssetId, '', limit ?? 30, {
            minimumRangeDistanceSecs: 0,
            videoDurationSecs: asset.durationSecs,
            timeRange: { startSecs, endSecs },
          });
          const chronological = [...hits].sort(
            (a, b) => a.evidence.timeRange.startSecs - b.evidence.timeRange.startSecs,
          );
          return {
            success: true,
            mediaAssetId: asset.id,
            range: { startSecs, endSecs },
            evidence: chronological.map((hit) => {
              const rawText =
                typeof hit.evidence.payload === 'object' &&
                hit.evidence.payload &&
                'text' in hit.evidence.payload
                  ? String((hit.evidence.payload as { text?: unknown }).text ?? '')
                  : JSON.stringify(hit.evidence.payload);
              return {
                evidenceId: hit.evidence.id,
                modality: hit.evidence.modality,
                text: rawText,
                startSecs: hit.evidence.timeRange.startSecs,
                endSecs: hit.evidence.timeRange.endSecs,
                precision: hit.evidence.timeRange.precision,
                confidence: hit.evidence.confidence,
                conflicted: hit.conflict,
              };
            }),
          };
        };
        return projectId ? runWithProject(projectId, run) : run();
      },
    }),

    expand_range: tool({
      description:
        'Widen a candidate time range for further investigation. Prefers the smallest indexed scene or chapter that fully encloses the given range (a real structural boundary in the video) over an arbitrary pad, falling back to a fixed pad only when nothing indexed encloses it yet. Use this when read_evidence or queryVideoKnowledge found too little inside a range to answer, before calling watch_original (inspectVideoKnowledge) on the widened range.',
      inputSchema: z.object({
        mediaAssetId: z.string().describe('Exact mediaAssetId returned by searchKnowledgeBase.'),
        startSecs: z.number().nonnegative(),
        endSecs: z.number().nonnegative(),
      }),
      execute: async ({ mediaAssetId, startSecs, endSecs }) => {
        const run = async () => {
          const asset = await scopedAsset(mediaAssetId);
          if (!asset || asset.processingStatus !== 'completed') {
            return { success: false, error: 'That indexed media asset is no longer available.' };
          }
          const expanded = await expandInvestigationRange(
            mediaAssetId,
            { startSecs, endSecs },
            asset.durationSecs,
          );
          if (!expanded) {
            return { success: false, error: 'No active video knowledge revision is available.' };
          }
          return { success: true, ...expanded };
        };
        return projectId ? runWithProject(projectId, run) : run();
      },
    }),

    presentMedia: tool({
      description:
        'Embed one indexed image, video segment, or audio segment as a compact citation in the chat. Use the exact mediaAssetId for Media-library assets, or the exact images[].imageUrl returned by searchKnowledgeBase for an image extracted from a PDF. Call this when the user asks to see, watch, play, or hear the media. Set extractFrame=true with a specific startSecs to show "what was on screen at X:XX" as a single frame preview instead of a video player. Prefer one best citation and do not call this for every search hit.',
      inputSchema: z.object({
        assetId: z
          .string()
          .optional()
          .describe('Exact mediaAssetId returned by searchKnowledgeBase.'),
        imageUrl: z
          .string()
          .optional()
          .describe(
            'Exact images[].imageUrl returned by searchKnowledgeBase for an extracted PDF image.',
          ),
        documentId: z
          .string()
          .optional()
          .describe(
            'Exact PDF documentId returned by searchKnowledgeBase for an on-demand page preview.',
          ),
        pageNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Preferred PDF page number to render when documentId is provided.'),
        question: z
          .string()
          .optional()
          .describe(
            'Optional user intent used to choose the nearest PDF page when pageNumber is omitted.',
          ),
        startSecs: z
          .number()
          .nonnegative()
          .optional()
          .describe('Exact segment start time returned by searchKnowledgeBase.'),
        endSecs: z
          .number()
          .nonnegative()
          .optional()
          .describe('Exact segment end time returned by searchKnowledgeBase.'),
        extractFrame: z
          .boolean()
          .optional()
          .describe(
            'When true, extract and show a single frame at startSecs instead of embedding the video player. Use this to answer "show me what was on screen at X:XX".',
          ),
      }),
      execute: async ({
        assetId,
        imageUrl,
        documentId,
        pageNumber,
        question,
        startSecs,
        endSecs,
        extractFrame,
      }) => {
        const resolvePresentation = async () => {
          if (documentId) {
            const document = await scopedDocument(documentId);
            if (!document) return { success: false, error: 'That PDF document is not available.' };
            const selectedPage =
              pageNumber ??
              (await inspectStoredPdf(document, question ?? '', undefined)).pages[0]?.pageNumber;
            if (!selectedPage)
              return { success: false, error: 'No renderable PDF page was found.' };
            await renderStoredPdfPage(document, selectedPage, 960);
            const mediaUrl = pdfPagePreviewUrl(document.id, selectedPage);
            return {
              success: true,
              assetId: `pdf-page-${document.id}-${selectedPage}`,
              mediaType: 'image' as const,
              fileName: `${document.title} — Page ${selectedPage}`,
              mediaUrl,
              sourceUrl: document.url || mediaUrl,
            };
          }
          if (imageUrl) {
            const documents = await readDocuments();
            const source = documents.find(
              (document) =>
                Array.isArray(document.metadata?.images) &&
                document.metadata.images.some((image: any) => image?.imageUrl === imageUrl),
            );
            const image = source?.metadata?.images?.find(
              (candidate: any) => candidate?.imageUrl === imageUrl,
            );
            if (!image) {
              return {
                success: false,
                error: 'That extracted document image is no longer available.',
              };
            }
            return {
              success: true,
              // The preview uses mediaUrl when supplied; this stable sentinel
              // only satisfies its shared media citation shape.
              assetId: `document-image-${image.index ?? 0}`,
              mediaType: 'image' as const,
              fileName: `${source?.title ?? 'Document'} — Image ${(image.index ?? 0) + 1}`,
              mediaUrl: imageUrl,
              sourceUrl: source?.url || imageUrl,
            };
          }

          if (!assetId) {
            return { success: false, error: 'Choose a media asset or extracted document image.' };
          }
          const asset = await scopedAsset(assetId);
          if (!asset || asset.processingStatus !== 'completed') {
            return {
              success: false,
              error: 'That indexed media asset is not available in the selected runtime.',
            };
          }

          const range = normalizeMediaCitationRange(
            asset.type,
            asset.durationSecs,
            startSecs,
            endSecs,
          );
          const serverQuery = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
          const mediaUrl = `/api/media/${asset.id}${serverQuery}`;
          const sourceUrl =
            range.startSecs !== undefined
              ? timestampMediaUrl(asset.originalUrl || mediaUrl, range.startSecs)
              : asset.originalUrl || mediaUrl;

          // Frame preview: extract a single frame at the timestamp instead
          // of embedding the full video player. This answers "show me what
          // was on screen at X:XX" with a precise image.
          let framePreviewUrl: string | undefined;
          if (extractFrame && asset.type === 'video' && range.startSecs !== undefined) {
            const frameQuery = new URLSearchParams();
            frameQuery.set('t', String(range.startSecs));
            if (projectId) frameQuery.set('projectId', projectId);
            framePreviewUrl = `/api/media/${asset.id}/frame?${frameQuery.toString()}`;
          }

          return {
            success: true,
            assetId: asset.id,
            mediaType: framePreviewUrl ? ('frame-preview' as const) : asset.type,
            fileName: asset.fileName,
            mediaUrl: framePreviewUrl || mediaUrl,
            sourceUrl,
            startSecs: range.startSecs,
            endSecs: range.endSecs,
            framePreviewUrl,
          };
        };

        return projectId ? runWithProject(projectId, resolvePresentation) : resolvePresentation();
      },
    }),

    queryTabularData: tool({
      description:
        'Query a tabular dataset (CSV/Excel/JSON) for exact values, filtering, grouping, and aggregations. Use this when the user asks about specific data values, comparisons, averages, sums, counts, highest/lowest, or any numerical question about uploaded data.',
      inputSchema: z.object({
        datasetId: z
          .string()
          .describe(
            'The ID of the dataset to query. Get this from the available datasets list in the system prompt.',
          ),
        filters: z
          .array(
            z.object({
              column: z.string(),
              op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']),
              value: z.any(),
            }),
          )
          .optional()
          .describe('Filters to apply to the data.'),
        groupBy: z.array(z.string()).optional().describe('Columns to group by for aggregations.'),
        aggregations: z
          .array(
            z.object({
              column: z.string(),
              op: z.enum(['sum', 'avg', 'count', 'min', 'max', 'median']),
            }),
          )
          .optional()
          .describe('Aggregation operations to perform.'),
        sortBy: z.string().optional().describe('Column to sort results by.'),
        sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort direction.'),
        limit: z.number().optional().describe('Max number of rows to return.'),
        columns: z.array(z.string()).optional().describe('Specific columns to include in results.'),
        timeBucket: z
          .object({
            column: z.string(),
            grain: z.enum(['month', 'quarter', 'year']),
          })
          .optional()
          .describe('Optional calendar grouping for a date column.'),
      }),
      execute: async (params) => {
        try {
          const dataset = await getTabularDataset(params.datasetId);
          if (!dataset) throw new Error('Dataset not found');
          const plan = inferTabularPlan(requestText, dataset, params);
          const result = await queryTabular(plan.request);
          const visualization = createTabularVisualization(requestText, result);
          if (visualization && plan.chartTitle) visualization.title = plan.chartTitle;
          return visualization ? { ...result, visualization } : result;
        } catch (err: any) {
          return {
            columns: [],
            rows: [],
            totalRows: 0,
            error: err.message ?? 'Query failed',
          };
        }
      },
    }),

    generateVisualization: tool({
      description:
        'Generate an interactive chart visualization. Use this when the user asks to see trends, comparisons, distributions, or any visual representation of data. The UI will render this as an interactive Recharts chart automatically. CRITICAL: Do NOT attempt to embed a markdown image (e.g. ![chart](url)) after calling this tool. The UI handles the rendering. Simply summarize the chart verbally.',
      inputSchema: z.object({
        chartType: z
          .enum(['bar', 'area', 'line', 'pie', 'scatter', 'radar'])
          .describe('The type of chart to create.'),
        title: z.string().describe('Chart title.'),
        subtitle: z.string().optional().describe('Chart subtitle for additional context.'),
        data: z
          .array(z.record(z.string(), z.any()))
          .describe(
            "Array of data points to plot. You MUST provide the data here. Example: [{'name': 'North', 'value': 3206}, {'name': 'East', 'value': 2492}]",
          ),
        xAxisKey: z
          .string()
          .describe("The key in data objects to use for the X axis (usually 'name')."),
        series: z
          .array(
            z.object({
              dataKey: z.string().describe('The key in data objects for this series values.'),
              label: z.string().optional().describe('Display label for this series in the legend.'),
              color: z
                .string()
                .optional()
                .describe('Color for this series (hex). If omitted, theme colors are used.'),
            }),
          )
          .describe('Data series to plot.'),
        colors: z
          .array(z.string())
          .optional()
          .describe(
            'Array of hex colors to use for the chart palette. The AI should decide and pick elegant, classy colors that contrast beautifully against a soft, muted background. Make it dynamic and appropriate for the data.',
          ),
        stacked: z.boolean().optional().describe('Whether to stack bar/area charts.'),
        showLegend: z.boolean().optional().default(true).describe('Whether to show the legend.'),
        xAxisLabel: z.string().optional().describe('Label for the X axis.'),
        yAxisLabel: z.string().optional().describe('Label for the Y axis.'),
      }),
      execute: async (config) => {
        // Pass through — the UI renders this directly
        return config;
      },
    }),

    executeAnalysis: tool({
      description:
        'Execute Python code in a secure sandbox for deep data analysis. Use this for complex statistical computations (correlations, regressions, clustering), data transformations, or when creating custom matplotlib visualizations. The code has access to pandas, numpy, matplotlib, scipy, scikit-learn, and seaborn. Always print results to stdout and use plt.show() for charts.',
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            'Python code to execute. Has pandas (2.0+), numpy, matplotlib, scipy, sklearn, seaborn available. ALWAYS use "ME" instead of "M" for resample frequency. Print results and use plt.show() for charts.',
          ),
        datasetId: z
          .string()
          .optional()
          .describe(
            "If provided, the dataset CSV will be available as 'data.csv' in the working directory.",
          ),
        pdfDocumentId: z
          .string()
          .optional()
          .describe(
            "Optional exact PDF documentId. Its original local file will be mounted as 'source.pdf' for pypdf/Pillow analysis.",
          ),
      }),
      execute: async ({ code, datasetId, pdfDocumentId }) => {
        try {
          const sandboxManager = new SandboxManager(resolveSandboxConfig(config));
          const files: SandboxFile[] = [];

          if (datasetId) {
            const dataset = await getTabularDataset(datasetId);
            if (dataset && dataset.rows.length > 0) {
              const cols = dataset.columns.map((c) => c.name);
              const csvLines = [cols.join(',')];
              for (const row of dataset.rows) {
                csvLines.push(
                  cols
                    .map((c) => {
                      const v = row[c];
                      const s = String(v ?? '');
                      return s.includes(',') || s.includes('"') || s.includes('\n')
                        ? `"${s.replace(/"/g, '""')}"`
                        : s;
                    })
                    .join(','),
                );
              }
              files.push({
                name: 'data.csv',
                content: csvLines.join('\n'),
              });
            }
          }

          if (pdfDocumentId) {
            const document = await scopedDocument(pdfDocumentId);
            if (!document) throw new Error('That PDF document is not available.');
            const bytes = await readStoredPdfBytes(document);
            files.push({ name: 'source.pdf', content: bytes.toString('base64'), isBase64: true });
          }

          let finalCode = code;
          // Clean up any markdown blocks LLMs might mistakenly wrap the code in
          finalCode = finalCode.replace(/^```python\s*\n?/m, '');
          finalCode = finalCode.replace(/^```\s*\n?/m, '');
          finalCode = finalCode.replace(/```\s*$/m, '');

          let result = await sandboxManager.execute({
            code: finalCode,
            language: 'python',
            files,
            timeout: 30_000,
          });

          // Auto-retry once if code crashes
          if (result.exitCode !== 0) {
            // Apply regex patches for common LLM mistakes
            finalCode = finalCode.replace(/resample\((['"])M(['"])\)/g, 'resample($1ME$2)');
            finalCode = finalCode.replace(/resample\((['"])Q(['"])\)/g, 'resample($1QE$2)');
            finalCode = finalCode.replace(/resample\((['"])Y(['"])\)/g, 'resample($1YE$2)');
            finalCode = finalCode.replace(/freq=(['"])M(['"])/g, 'freq=$1ME$2');

            result = await sandboxManager.execute({
              code: finalCode,
              language: 'python',
              files,
              timeout: 30_000,
            });
          }

          return {
            stdout: result.stdout.slice(0, 5000),
            stderr: result.stderr.slice(0, 2000),
            exitCode: result.exitCode,
            artifacts: result.artifacts.map((a) => ({
              name: a.name,
              mimeType: a.mimeType,
              data: a.data.slice(0, 500_000), // cap at around 375KB base64
            })),
            executionTimeMs: result.executionTimeMs,
          };
        } catch (err: any) {
          return {
            stdout: '',
            stderr: err.message ?? 'Sandbox execution failed',
            exitCode: 1,
            artifacts: [],
            executionTimeMs: 0,
          };
        }
      },
    }),

    analyzeImageDeeply: tool({
      description:
        'Use this tool when you need to answer a detailed question about an image (like a diagram, chart, or schema) found in the knowledge base. Pass the exact imageUrl found in the document metadata, along with specific instructions on what you need to extract from it.',
      inputSchema: z.object({
        imageUrl: z
          .string()
          .describe('The URL of the image to analyze (from metadata.images.imageUrl)'),
        prompt: z
          .string()
          .describe(
            'Specific instructions on what to extract or analyze from this image. Be as detailed as possible to get the best result.',
          ),
      }),
      execute: async ({ imageUrl, prompt }) => {
        const analyzeIndexedImage = async () => {
          try {
            // A model may only inspect an image that is actually part of the
            // active corpus. This prevents guessed URLs from becoming a chat
            // preview or an image-analysis request.
            const documents = await readDocuments();
            const isIndexedImage = documents.some(
              (document) =>
                document.status === 'indexed' &&
                (document.metadata?.imageUrl === imageUrl ||
                  (Array.isArray(document.metadata?.images) &&
                    document.metadata.images.some((image: any) => image?.imageUrl === imageUrl))),
            );
            if (!isIndexedImage) {
              return { error: 'That image is not available in the indexed material.' };
            }

            const cached = await getCachedImageAnalysis(imageUrl, prompt);
            if (cached) return { analysis: cached, cached: true };

            const fetchUrl = imageUrl.startsWith('/')
              ? new URL(
                  imageUrl,
                  context.origin ?? `http://127.0.0.1:${process.env.PORT || 3000}`,
                ).toString()
              : imageUrl;
            const res = await fetch(fetchUrl);
            if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
            const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');

            const descRes = await fetch(
              new URL(
                '/api/describe-image',
                context.origin ?? `http://127.0.0.1:${process.env.PORT || 3000}`,
              ).toString(),
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base64, prompt }),
              },
            );

            if (!descRes.ok) throw new Error(`Vision API error: ${descRes.statusText}`);
            const data = await descRes.json();
            await cacheImageAnalysis(imageUrl, prompt, data.description);
            return { analysis: data.description, cached: false };
          } catch (err: any) {
            return { error: `Failed to analyze image: ${err.message}` };
          }
        };

        return projectId ? runWithProject(projectId, analyzeIndexedImage) : analyzeIndexedImage();
      },
    }),

    getIndexedData: tool({
      description:
        'Get structured access to ALL indexed source documents. Use this for counting, listing, filtering, and overview questions about the knowledge base. Returns document metadata (title, source type, status, custom metadata fields, dates). Use this when the user asks "how many documents?", "list all X", "show progress", "what sources?", or any structural question about the corpus.',
      inputSchema: z.object({
        filter: z
          .object({
            source: z
              .enum(['text', 'files', 'website', 'media', 'integrations'])
              .optional()
              .describe('Filter by document source type.'),
            status: z
              .enum(['indexed', 'unindexed'])
              .optional()
              .describe('Filter by indexing status.'),
            metadataKey: z.string().optional().describe('Filter by metadata key existence.'),
            metadataValue: z
              .string()
              .optional()
              .describe('Filter by metadata key=value (requires metadataKey).'),
            titleContains: z.string().optional().describe('Case-insensitive text search in title.'),
            createdAfter: z
              .string()
              .optional()
              .describe('Only docs created on or after this ISO date.'),
            createdBefore: z
              .string()
              .optional()
              .describe('Only docs created on or before this ISO date.'),
          })
          .optional()
          .describe('Optional filters to narrow down documents.'),
        limit: z
          .number()
          .optional()
          .default(200)
          .describe('Max number of document summaries to return (default 200).'),
        offset: z.number().optional().default(0).describe('Pagination offset.'),
        includeContent: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'Whether to include truncated document content. Default false for performance. Set true only when you need the actual text.',
          ),
      }),
      execute: async ({ filter, limit, offset, includeContent }) => {
        try {
          const maxLimit = includeContent ? 20 : 100;
          const actualLimit = Math.min(limit ?? (includeContent ? 20 : 100), maxLimit);

          return await getCorpusDocuments(
            filter as CorpusFilter | undefined,
            actualLimit,
            offset ?? 0,
            includeContent ?? false,
          );
        } catch (err: any) {
          return {
            documents: [],
            total: 0,
            summary: {
              totalDocuments: 0,
              bySource: {},
              byStatus: {},
              topMetadataKeys: [],
              totalCharacters: 0,
              dateRange: null,
            },
            error: err.message ?? 'Failed to retrieve corpus data',
          };
        }
      },
    }),

    analyzeCorpusWithCode: tool({
      description:
        'Run Python code in a sandbox with the FULL indexed corpus available as a file. Use this for complex analysis of documents: parsing fields from content, computing progress percentages, grouping by patterns, detecting duplicates, generating charts from corpus data, or any question that requires programmatic processing of hundreds/thousands of documents. The corpus is available as "corpus.csv" (or "corpus.jsonl" if format is jsonl). CSV columns: id, title, source, url, charCount, status, createdAt, content, plus any metadata_* columns.',
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            'Python code to execute. The corpus file is in the working directory. Use pandas to load it: df = pd.read_csv("corpus.csv") or for JSONL: df = pd.read_json("corpus.jsonl", lines=True). Has pandas (2.0+), numpy, matplotlib, scipy, sklearn, seaborn available. ALWAYS use "ME" instead of "M" for resample frequency. Print results and use plt.show() for charts.',
          ),
        format: z
          .enum(['csv', 'jsonl'])
          .optional()
          .default('csv')
          .describe('Format of the corpus file. Default is CSV.'),
      }),
      execute: async ({ code, format }) => {
        try {
          const sandboxManager = new SandboxManager(resolveSandboxConfig(config));

          // Export corpus in the requested format
          const corpusData =
            format === 'jsonl' ? await exportCorpusAsJSONL() : await exportCorpusAsCSV();

          if (!corpusData) {
            return {
              stdout: 'No documents found in the corpus.',
              stderr: '',
              exitCode: 0,
              artifacts: [],
              executionTimeMs: 0,
            };
          }

          const fileName = format === 'jsonl' ? 'corpus.jsonl' : 'corpus.csv';
          const files = [{ name: fileName, content: corpusData }];

          let finalCode = code;
          let result = await sandboxManager.execute({
            code: finalCode,
            language: 'python',
            files,
            timeout: 30_000,
          });

          // Auto-retry once if code crashes
          if (result.exitCode !== 0) {
            // Apply regex patches for common LLM mistakes
            finalCode = finalCode.replace(/resample\((['"])M(['"])\)/g, 'resample($1ME$2)');
            finalCode = finalCode.replace(/resample\((['"])Q(['"])\)/g, 'resample($1QE$2)');
            finalCode = finalCode.replace(/resample\((['"])Y(['"])\)/g, 'resample($1YE$2)');
            finalCode = finalCode.replace(/freq=(['"])M(['"])/g, 'freq=$1ME$2');

            result = await sandboxManager.execute({
              code: finalCode,
              language: 'python',
              files,
              timeout: 30_000,
            });
          }

          return {
            stdout: result.stdout.slice(0, 5000),
            stderr: result.stderr.slice(0, 2000),
            exitCode: result.exitCode,
            artifacts: result.artifacts.map((a) => ({
              name: a.name,
              mimeType: a.mimeType,
              data: a.data.slice(0, 500_000),
            })),
            executionTimeMs: result.executionTimeMs,
          };
        } catch (err: any) {
          return {
            stdout: '',
            stderr: err.message ?? 'Corpus analysis failed',
            exitCode: 1,
            artifacts: [],
            executionTimeMs: 0,
          };
        }
      },
    }),

    fillDocumentForm: tool({
      description:
        'Fill form fields, text inputs, or checkboxes in the currently active document. Use this when the user asks to "fill the form", "add data to fields", or "fill with dummy data". You should use the searchKnowledgeBase tool to find answers to form questions if you do not know them. The available fields are provided in your system prompt.',
      inputSchema: z.object({
        edits: z
          .array(
            z.object({
              fieldId: z
                .string()
                .describe('The ID of the field to fill (from the active document context)'),
              value: z.string().describe('The value to set for the field'),
            }),
          )
          .describe('List of fields to fill and their new values'),
      }),
      execute: async ({ edits }) => {
        if (!docSessionId)
          return {
            success: false,
            error:
              'Document not loaded yet. Please wait a moment or ask the user to click the document to open it in the canvas before filling it.',
          };

        try {
          const fieldEdits = edits.map((edit) => ({
            ...edit,
            type: 'fill' as const,
          }));
          const result = await applyFieldEdits(docSessionId, fieldEdits);
          if (!result.success) {
            return { success: false, error: result.error };
          }

          return {
            success: true,
            action: 'fill_document',
            sessionId: docSessionId,
            edits,
            updatedFields: result.updatedFields,
            fileName: result.parsed.fileName,
            mimeType: result.parsed.mimeType,
            fields: result.parsed.fields,
            pages: result.parsed.pages.map((p) => ({
              index: p.index,
              text: p.text.slice(0, 2000),
              html: p.html,
              fields: p.fields,
              dimensions: p.dimensions,
            })),
            totalPages: result.parsed.totalPages,
            fileBase64: result.fileBase64,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
      toModelOutput: documentEditModelOutput,
    }),

    editDocument: tool({
      description:
        'Edit the content (text) of the currently active document. Use this when the user asks to modify paragraphs, rewrite text, or change slides (not form fields).',
      inputSchema: z.object({
        edits: z
          .array(
            z.object({
              pageIndex: z.number().default(0).describe('Page or slide index (0-based)'),
              type: z.enum(['replace_text', 'insert_text']).describe('Type of edit'),
              search: z.string().optional().describe('Text to search for (if replacing)'),
              text: z.string().describe('Replacement text or text to insert'),
            }),
          )
          .describe('List of content edits to apply'),
      }),
      execute: async ({ edits }) => {
        if (!docSessionId)
          return {
            success: false,
            error:
              'Document not loaded yet. Please wait a moment or ask the user to click the document to open it in the canvas before editing it.',
          };

        try {
          const result = await applyContentEdits(docSessionId, edits);
          if (!result.success) {
            return { success: false, error: result.error };
          }

          return {
            success: true,
            action: 'edit_document',
            sessionId: docSessionId,
            edits,
            updatedFields: result.updatedFields,
            fileName: result.parsed.fileName,
            mimeType: result.parsed.mimeType,
            pages: result.parsed.pages.map((p) => ({
              index: p.index,
              text: p.text.slice(0, 2000),
              html: p.html,
              fields: p.fields,
              dimensions: p.dimensions,
            })),
            totalPages: result.parsed.totalPages,
            fileBase64: result.fileBase64,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
      toModelOutput: documentEditModelOutput,
    }),

    requestDocumentSignature: tool({
      description:
        'STRICTLY ONLY use this when the user explicitly asks to "sign" the currently active document or asks for a "signature". CRITICAL: Do NOT use this tool for filling forms, answering questions, or adding dummy data. CRITICAL: NEVER call this tool more than once per user request. Yields a UI widget for the user to confirm the placement and provide their signature.',
      inputSchema: z.object({
        detectedLocations: z
          .array(
            z.object({
              pageIndex: z.number(),
              context: z.string(),
            }),
          )
          .optional()
          .describe('Optional. The detected signature locations in the document.'),
      }),
    }),

    webSearch: tool({
      description:
        'Search the public internet for current information, news, or facts. Use it first for clearly current/public requests, or once after an irrelevant local search. If it fails or returns no useful results, searchKnowledgeBase is available once as a fallback. Never repeat either search tool in the same turn.',
      inputSchema: z.object({
        query: z.string().describe('The search query.'),
      }),
      execute: async ({ query }) => {
        const knowledgeBaseFallback = async (error: string) => {
          try {
            const knowledge = await queryKnowledgeBase(query, 5, projectId ?? null);
            return {
              error,
              results: [],
              fallback: {
                source: 'knowledge-base',
                attemptedBecause: 'Public web search failed or returned no results.',
                ...knowledge,
              },
            };
          } catch (fallbackError: any) {
            return {
              error,
              results: [],
              fallback: {
                source: 'knowledge-base',
                error: fallbackError?.message || 'Knowledge-base fallback failed.',
                hits: [],
              },
            };
          }
        };
        const provider = config?.webSearchProvider || 'tavily';
        const req = new Request('http://localhost/api/search', {
          method: 'POST',
          body: JSON.stringify({ query }),
        });

        let res: any;
        try {
          switch (provider) {
            case 'google':
            case 'serper':
              const { POST: searchGoogle } = await import('../search/google/route');
              res = await searchGoogle(req);
              break;
            case 'tavily':
              const { POST: searchTavily } = await import('../search/tavily/route');
              res = await searchTavily(req);
              break;
            case 'brave':
              const { POST: searchBrave } = await import('../search/brave/route');
              res = await searchBrave(req);
              break;
            case 'bing':
              const { POST: searchBing } = await import('../search/bing/route');
              res = await searchBing(req);
              break;
            case 'exa':
              const { POST: searchExa } = await import('../search/exa/route');
              res = await searchExa(req);
              break;
            case 'local':
            default:
              const { POST: searchLocal } = await import('../search/route');
              res = await searchLocal(req);
              break;
          }

          if (res.status >= 400) {
            const err = await res.json();
            return knowledgeBaseFallback(err.error || 'Search failed');
          }

          const data = await res.json();
          const items = data.items || data.results || [];
          if (items.length === 0) {
            return knowledgeBaseFallback('Public search returned no results.');
          }
          return {
            results: items.slice(0, 10).map((i: any) => ({
              title: i.title,
              url: i.url,
              snippet: i.description || i.snippet || '',
            })),
          };
        } catch (e: any) {
          return knowledgeBaseFallback(e.message || 'Search failed');
        }
      },
    }),
  };

  const enabledTools = config?.enabledTools || [];
  const finalTools: Record<string, any> = {};

  // Core chat capabilities below remain available by their generic category.
  // Optional first-party actions must be explicitly enabled; installed
  // Marketplace tools retain the historical "all when unset" behavior.
  const isBuiltInEnabled = (id: string) => enabledTools.includes(id);
  const isMarketplaceEnabled = (id: string) =>
    enabledTools.length === 0 || enabledTools.includes(id);

  // 1. Add enabled built-in tools
  for (const [id, toolDef] of Object.entries(builtInTools)) {
    if (id === 'webSearch') continue; // Handled separately
    if ((id === 'executeAnalysis' || id === 'analyzeCorpusWithCode') && !sandboxReady) continue;

    if (
      isBuiltInEnabled(id) ||
      [
        // Retrieval is core chat behavior, not an optional marketplace action.
        // Keeping it available prevents an enabled web-search configuration
        // from silently removing the user's local knowledge base.
        'searchKnowledgeBase',
        // Data analysis and visualizations are part of the first-party chat
        // experience. Keep them available even when a legacy enabled-tools
        // configuration only lists marketplace tools.
        'queryTabularData',
        'generateVisualization',
        'executeAnalysis',
        // PDF/image hits can require one visual pass after retrieval. This is
        // available only to a follow-up tool step, never auto-run on chat.
        'analyzeImageDeeply',
        'presentMedia',
        'fillDocumentForm',
        'editDocument',
        'requestDocumentSignature',
      ].includes(id)
    ) {
      finalTools[id] = toolDef;
    }
  }

  // Add webSearch tool if explicitly enabled globally
  if (config?.webSearchEnabled === true) {
    finalTools['webSearch'] = builtInTools['webSearch'];
  }

  // 2. Add enabled marketplace tools, generically — for ANY tool implementing
  // the ToolExtension v1 + AGENT_TOOL(S) contract (packages/marketplace's
  // `defineAgentTool`), a new tool becomes chat-callable purely by publishing
  // a manifest and an AGENT_TOOL export. Nothing here may name a specific
  // tool's id, schema, or behavior.
  const dynamicToolNames: string[] = [];
  const dynamicToolWorkflows: Record<string, NonNullable<AgentToolDefinition['workflow']>> = {};
  const promptFragments: string[] = [];

  try {
    const installed = await getInstalledTools();
    for (const t of installed) {
      if (!isMarketplaceEnabled(t.id)) continue;
      const mod = await loadTool<Record<string, unknown>>(t.id);
      if (!mod) continue;

      const extension = (mod.TOOL_EXTENSION ?? mod.default) as
        { id?: string; apiVersion?: string; createClient?: (ctx: unknown) => unknown } | undefined;
      const agentDefs: AgentToolDefinition[] = Array.isArray(mod.AGENT_TOOLS)
        ? (mod.AGENT_TOOLS as AgentToolDefinition[])
        : mod.AGENT_TOOL
          ? [mod.AGENT_TOOL as AgentToolDefinition]
          : [];

      if (
        extension?.apiVersion === '1' &&
        typeof extension.createClient === 'function' &&
        agentDefs.length > 0
      ) {
        const toolContext = {
          config: {
            ...(t.config ?? {}),
            ...(activeProjectConfig?.toolConfigs?.[t.id] ?? {}),
          },
          fetch: globalThis.fetch,
          trackUsage: (event: { meter: string; quantity: number; unit: string }) =>
            trackEnterpriseToolUsage(config, t.id, event),
        };
        const client = extension.createClient(toolContext) as Record<string, AgentToolHandler>;
        for (const def of agentDefs) {
          if (!isValidAgentToolDefinition(def) || typeof client[def.method] !== 'function') {
            console.warn(`[marketplace] Skipping invalid agent action from "${t.id}".`);
            continue;
          }
          // Marketplace packages cannot replace first-party tools or each
          // other. A collision is a package error, not an override mechanism.
          if (finalTools[def.name]) {
            console.warn(
              `[marketplace] Skipping colliding agent action "${def.name}" from "${t.id}".`,
            );
            continue;
          }
          finalTools[def.name] = tool({
            description: def.description,
            inputSchema: jsonSchema(def.parameters as Parameters<typeof jsonSchema>[0]),
            execute: (input: unknown, options: { toolCallId: string }) =>
              client[def.method](input, {
                origin,
                projectId,
                toolCallId: options.toolCallId,
                mediaEvidence,
              } satisfies AgentToolExecutionContext),
          });
          dynamicToolNames.push(def.name);
          if (def.workflow) dynamicToolWorkflows[def.name] = def.workflow;
          if (def.systemPromptFragment) promptFragments.push(def.systemPromptFragment);
        }
        continue;
      }

      // Legacy shapes some marketplace tools still export directly.
      if (typeof mod.default === 'function') {
        finalTools[t.id] = (mod.default as (ctx: unknown) => unknown)(context);
        dynamicToolNames.push(t.id);
      } else if (typeof mod.tool === 'function') {
        finalTools[t.id] = (mod.tool as (ctx: unknown) => unknown)(context);
        dynamicToolNames.push(t.id);
      }
    }
  } catch (err) {
    console.error('[marketplace] Failed to load marketplace tools for chat:', err);
  }

  // Enterprise tools never touch the public Marketplace catalog. Their
  // descriptors and handlers stay in the private EE dashboard, and only an
  // enrolled client with an explicitly installed tool receives them here.
  // (Generic already: `enterpriseTool.id`/`.description` always come from
  // whatever the EE server currently returns, never a hardcoded tool.)
  for (const enterpriseTool of await getEnterpriseTools(config)) {
    finalTools[enterpriseTool.id] = tool({
      description: `${enterpriseTool.description} Use this only when it directly helps the Enterprise user's request.`,
      inputSchema: z.object({
        query: z.string().describe('The focused request for this private tool.'),
      }),
      execute: async ({ query }) => executeEnterpriseTool(config, enterpriseTool.id, { query }),
    });
    dynamicToolNames.push(enterpriseTool.id);
  }

  return { tools: finalTools, promptFragments, dynamicToolNames, dynamicToolWorkflows };
}

function isValidAgentToolDefinition(definition: AgentToolDefinition): boolean {
  return (
    typeof definition.name === 'string' &&
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(definition.name) &&
    typeof definition.description === 'string' &&
    definition.description.length > 0 &&
    typeof definition.method === 'string' &&
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(definition.method) &&
    typeof definition.parameters === 'object' &&
    definition.parameters !== null &&
    !Array.isArray(definition.parameters)
  );
}
