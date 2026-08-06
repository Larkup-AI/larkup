import { tool } from 'ai';
import { z } from 'zod';
import { readConfig } from '@larkup/core/config-store';
import { createAdapter } from '@larkup/vector-stores/factory';
import { embedQuery } from '@larkup/core/indexing/embedder';
import { runWithServer } from '@larkup/core/workspace';
import { getTabularDataset, queryTabular } from '@larkup/core/tabular-store';
import {
  getCorpusDocuments,
  exportCorpusAsCSV,
  exportCorpusAsJSONL,
  type CorpusFilter,
} from '@larkup/core/corpus-retriever';
import { SandboxManager } from '@larkup/sandbox';
import { applyFieldEdits, applyContentEdits } from '@larkup/tool-doc-editor';
import { loadTool } from '@larkup/marketplace/loader';
import { getInstalledTools } from '@larkup/marketplace/installer';
import { readDocuments } from '@larkup/core/documents-store';
import { readMediaAssets } from '@larkup/core/media-store';
import {
  searchVideoKnowledge,
  videoKnowledgeRetrievalCapabilities,
} from '@larkup/core/video-knowledge/retrieval';
import { planVideoInvestigation as buildVideoInvestigationPlan } from '@larkup/core/video-knowledge/investigation';
import { verifyMediaEvidence } from '@larkup/core/video-knowledge/verification';
import { planVideoQuestion } from '@larkup/core/video-knowledge/query-planner';
import { decideInspection } from '@larkup/core/video-knowledge/inspection-policy';
import { trackUsageEvent } from '@larkup/core/analytics-store';
import { cacheImageAnalysis, getCachedImageAnalysis } from '@larkup/core/image-analysis-cache';
import {
  normalizeMediaCitationRange,
  queryAwareExcerpt,
  timestampMediaUrl,
} from '@/lib/media-knowledge';

const queryVideoKnowledgeCache = new Map<string, { expiresAt: number; value: any }>();

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
 * Retrieves documents from the knowledge base
 */
export async function queryKnowledgeBase(query: string, topK: number, serverId: string | null) {
  const doRetrieve = async () => {
    const config = await readConfig();
    // Retrieve a small diverse pool. Sending a very large candidate set into
    // the answer model noticeably delays the first streamed token without
    // helping the user-facing source list.
    const candidateCount = Math.max(topK * 6, 24);
    // Document status is more precise than the last index-run summary: a later
    // partial run can be marked failed even though earlier uploaded and scraped
    // documents were successfully indexed and remain queryable.
    const documents = await readDocuments();
    if (!documents.some((document) => document.status === 'indexed')) {
      return { query, hits: [] };
    }

    try {
      const vector = await embedQuery(config, query);
      const adapter = await createAdapter(config);
      const hits = await adapter.query(vector, candidateCount, query);
      return formatKnowledgeHits(query, hits, topK, documents);
    } catch (error) {
      // A retrieval outage must not become a model/tool failure that exposes
      // implementation details. The chat policy handles an empty result with
      // its normal, user-facing uncertainty response.
      console.error('[chat] knowledge-base retrieval failed:', error);
      return { query, hits: [] };
    }
  };

  return serverId ? runWithServer(serverId, doRetrieve) : doRetrieve();
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
  const hydrated = rawHits.map((hit) => {
    const document = documentsById.get(hit.documentId);
    return {
      ...hit,
      title: hit.title || document?.title || 'Untitled',
      url: hit.url || document?.url || '',
      text: hit.text || document?.content || '',
      metadata: { ...document?.metadata, ...hit.metadata },
    };
  });

  const selected: any[] = [];
  const hitsPerDocument = new Map<string, number>();
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
    const seen = hitsPerDocument.get(hit.documentId) ?? 0;
    const isTimestampedMedia =
      hit.metadata?.isMediaSummary === true ||
      hit.metadata?.contentKind === 'multimodal-segment' ||
      hit.metadata?.contentKind === 'audio-transcript-segment';
    // One strong hit per timestamped evidence document leaves room for other
    // moments instead of returning eight chunks from the same summary.
    if (seen >= (isTimestampedMedia ? 1 : 3)) continue;
    selected.push(hit);
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
  // avoids depending on a brittle English/Arabic keyword gate for formulations
  // such as "which team became champion?" or equivalent questions in any language.
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
          ? 'Smart video evidence is available. Call queryVideoKnowledge with this mediaAssetId before answering any factual question about this media.'
          : queryAwareExcerpt(hit.text ?? '', query, 1_600),
        // PDF extraction stores its verified upload URLs on the source
        // document, rather than creating media-library assets. Expose those
        // URLs explicitly so the presentation tool can validate and render
        // them in chat.
        images:
          hit.metadata?.images ??
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

export async function getChatTools(context: {
  serverId?: string;
  docSessionId?: string;
  config?: any;
  /** Public origin of the incoming chat request, used for local media URLs. */
  origin?: string;
}) {
  const { serverId, docSessionId, config, origin } = context;

  const builtInTools: Record<string, any> = {
    searchKnowledgeBase: tool({
      description:
        "HIGHEST PRIORITY TOOL — Search the user's private RAG knowledge base. ALWAYS use this FIRST before webSearch or any other tool when the user asks a question. You MUST use this tool if you are asked a question and do not already have the exact answer in your context. Even if the question seems like personal trivia, general knowledge, or random facts (e.g., 'what is my favorite food?', 'what is X?'), you MUST search the knowledge base because the user's uploaded documents likely contain the answer. Search once with a focused query. If it returns no relevant evidence and the question asks for public/current info, webSearch is available once as a fallback. When a result has a mediaAssetId and the user asks a factual video/audio question, you MUST call queryVideoKnowledge before answering; cite only its returned active evidence ranges. DO NOT call presentMedia automatically. Only call presentMedia with exact mediaAssetId/startSecs/endSecs values if the user EXPLICITLY asks to preview or see the video/moment.",
      inputSchema: z.object({
        query: z.string().describe('The search query for the knowledge base.'),
      }),
      execute: async ({ query }) => {
        return queryKnowledgeBase(query, 4, serverId ?? null);
      },
    }),

    queryVideoKnowledge: tool({
      description:
        'Use this for every factual question about an indexed video or audio asset after searchKnowledgeBase identifies its mediaAssetId. It performs a fresh hierarchical investigation (chapters → scenes → events/states → active source evidence) on every call, returns seekable ranges, and highlights unresolved conflicts. Use it for simple, temporal, comparative, exact-text, counting, and outcome questions before answering; do not infer a claim beyond these records.',
      inputSchema: z.object({
        mediaAssetId: z.string().describe('Exact mediaAssetId returned by searchKnowledgeBase.'),
        query: z.string().describe('The user’s focused question or sub-question about this media.'),
        limit: z.number().int().min(1).max(12).optional(),
      }),
      execute: async ({ mediaAssetId, query, limit }) => {
        const run = async () => {
          const asset = (await readMediaAssets()).find(
            (candidate) => candidate.id === mediaAssetId,
          );
          if (!asset || asset.processingStatus !== 'completed') {
            return { success: false, error: 'That indexed media asset is no longer available.' };
          }
          const cacheKey = `${serverId ?? 'default'}:${mediaAssetId}:${query
            .normalize('NFKC')
            .toLocaleLowerCase()
            .trim()}`;
          const cached = queryVideoKnowledgeCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
          }
          const plan = planVideoQuestion(query);
          const investigation = await buildVideoInvestigationPlan(mediaAssetId, query);
          // The regular RAG retriever owns embeddings/vector providers. Join
          // its media projection hits back to active Core evidence so video
          // answers get hybrid semantic + lexical retrieval without treating
          // vector documents as source truth.
          const semantic = await queryKnowledgeBase(query, 24, null);
          const semanticDocumentIds = semantic.hits
            .filter((hit: any) => hit.metadata?.mediaAssetId === mediaAssetId)
            .map((hit: any) => String(hit.documentId));
          const hits = await searchVideoKnowledge(mediaAssetId, query, limit ?? 8, {
            modalities: plan.modalities,
            minimumRangeDistanceSecs: 2,
            semanticDocumentIds,
            queryPlan: plan,
            videoDurationSecs: asset.durationSecs,
          });
          const verification = await verifyMediaEvidence({
            mediaAssetId,
            evidenceIds: hits.map((hit) => hit.evidence.id),
            requiresFramePrecision: /\b(exact|precisely|frame|at\s+\d{1,2}:\d{2})\b/i.test(query),
          });
          const inspectionDecision = decideInspection({
            required:
              plan.requiresInspectionWhenInsufficient &&
              ['insufficient', 'needs_inspection'].includes(verification.status),
            plausibleRange: hits.length > 0 || Boolean(asset.durationSecs),
            estimate: {
              durationSecs: 30,
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
          void trackUsageEvent({
            type: 'media_processing',
            mediaOperation: 'investigation',
            mediaAssetId,
            queryKind: plan.kinds.join(','),
            cache: investigation?.cache ?? 'miss',
            evidenceCount: hits.length,
            timestamp: new Date().toISOString(),
          });
          const result = {
            success: true,
            mediaAssetId: asset.id,
            fileName: asset.fileName,
            sourceUrl: `/api/media/${asset.id}${
              serverId ? `?serverId=${encodeURIComponent(serverId)}` : ''
            }`,
            originalUrl: asset.originalUrl,
            verification,
            plan,
            investigation,
            retrievalCapabilities: videoKnowledgeRetrievalCapabilities(),
            inspectionDecision,
            evidence: hits.map((hit) => {
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
          queryVideoKnowledgeCache.set(cacheKey, {
            expiresAt: Date.now() + 5 * 60_000,
            value: result,
          });
          return result;
        };
        return serverId ? runWithServer(serverId, run) : run();
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
          const asset = (await readMediaAssets()).find(
            (candidate) => candidate.id === mediaAssetId,
          );
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
            cache: investigation.cache,
            timestamp: new Date().toISOString(),
          });
          return { success: true, ...investigation };
        };
        return serverId ? runWithServer(serverId, run) : run();
      },
    }),

    inspectVideoKnowledge: tool({
      description:
        'Use only after queryVideoKnowledge returns needs_inspection or a required/optional inspection decision. This performs one bounded, authorized source rewind and persists only validated OCR/visual evidence. After a successful inspection, call queryVideoKnowledge again with the same focused sub-question to verify the newly active evidence before answering. Never request an unbounded whole-video scan.',
      inputSchema: z.object({
        mediaAssetId: z.string(),
        startSecs: z.number().nonnegative(),
        endSecs: z.number().nonnegative(),
        purpose: z.enum(['verify-visual', 'high-res-ocr', 'compare', 'count', 'track', 'code']),
        queryId: z.string().min(1).max(128),
        maxFrames: z.number().int().min(1).max(24).optional(),
      }),
      execute: async ({ mediaAssetId, startSecs, endSecs, purpose, queryId, maxFrames }) => {
        if (!origin)
          return {
            success: false,
            error: 'Source inspection is unavailable without a request origin.',
          };
        const url = new URL('/api/media/inspect', origin);
        if (serverId) url.searchParams.set('serverId', serverId);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaAssetId, startSecs, endSecs, purpose, queryId, maxFrames }),
        });
        const result = await response
          .json()
          .catch(() => ({ error: 'Inspection returned an invalid response.' }));
        return response.ok ? { success: true, ...result } : { success: false, ...result };
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
      execute: async ({ assetId, imageUrl, startSecs, endSecs, extractFrame }) => {
        const resolvePresentation = async () => {
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
          const assets = await readMediaAssets();
          const asset = assets.find((candidate) => candidate.id === assetId);
          if (!asset || asset.processingStatus !== 'completed') {
            return {
              success: false,
              error: 'That indexed media asset is no longer available.',
            };
          }

          const range = normalizeMediaCitationRange(
            asset.type,
            asset.durationSecs,
            startSecs,
            endSecs,
          );
          const serverQuery = serverId ? `?serverId=${encodeURIComponent(serverId)}` : '';
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
            if (serverId) frameQuery.set('serverId', serverId);
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

        return serverId ? runWithServer(serverId, resolvePresentation) : resolvePresentation();
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
      }),
      execute: async (params) => {
        try {
          return await queryTabular(params);
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
      }),
      execute: async ({ code, datasetId }) => {
        try {
          const sandboxManager = new SandboxManager({ backend: 'docker' });
          const files: { name: string; content: string }[] = [];

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
                      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
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

        return serverId ? runWithServer(serverId, analyzeIndexedImage) : analyzeIndexedImage();
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
          const sandboxManager = new SandboxManager({ backend: 'docker' });

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
            const knowledge = await queryKnowledgeBase(query, 5, serverId ?? null);
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

  // If empty, default to all built-in tools (backwards compatibility)
  const isEnabled = (id: string) => enabledTools.length === 0 || enabledTools.includes(id);

  // 1. Add enabled built-in tools
  for (const [id, toolDef] of Object.entries(builtInTools)) {
    if (id === 'webSearch') continue; // Handled separately

    if (
      isEnabled(id) ||
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
        // A video match must be verified against immutable evidence rather
        // than answered from an ordinary vector chunk. These are first-party
        // retrieval capabilities, so legacy enabled-tools settings may not
        // silently remove them.
        'queryVideoKnowledge',
        'planVideoInvestigation',
        'inspectVideoKnowledge',
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

  // 2. Add enabled marketplace tools
  // We fetch installed tools to see which ones are available
  try {
    const installed = await getInstalledTools();
    for (const t of installed) {
      if (isEnabled(t.id)) {
        const mod = await loadTool(t.id);
        if (mod && mod.default) {
          finalTools[t.id] = mod.default(context);
        } else if (mod && mod.tool) {
          finalTools[t.id] = mod.tool(context);
        }
      }
    }
  } catch (err) {
    console.error('[marketplace] Failed to load marketplace tools for chat:', err);
  }

  return finalTools;
}
