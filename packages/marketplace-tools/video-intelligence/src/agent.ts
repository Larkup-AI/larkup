import type { AgentToolDefinition, AgentToolExecutionContext } from '@larkup/marketplace/extension';
import { trackUsageEvent } from '@larkup/core/analytics-store';
import type { VideoInvestigationDirective } from '@larkup/core/video-knowledge/query-planner';
import type { VideoIntelligenceClient } from './client.js';

const MAX_INSPECTION_CHUNK_SECS = 60;
const OUTCOME_RESOLUTION_WINDOW_SECS = 30;
/** How much source a single targeted look covers on each side of a located moment. */
const TARGET_PADDING_SECS = 8;
/** Independent looks dispatched together before the next wave starts. */
const MAX_PARALLEL_INSPECTIONS = 4;
/** The whole evidence-query fallback shares one deadline, including re-watch. */
const INTERACTIVE_INSPECTION_BUDGET_MS = 30_000;
/** Leave part of the shared deadline for a provider-backed inspection if needed. */
const INTERACTIVE_REWATCH_BUDGET_MS = 12_000;

type InspectionPurpose = 'verify-visual' | 'high-res-ocr' | 'compare' | 'count' | 'track' | 'code';
type AnalysisMode = 'fast' | 'balanced' | 'thorough';
type TimeRange = { startSecs: number; endSecs: number };
/** Ranges just watched for the current question, and when that look began. */
type WatchedRanges = { ranges: TimeRange[]; since: string };

interface InspectVideoKnowledgeInput {
  mediaAssetId: string;
  startSecs: number;
  endSecs: number;
  purpose: InspectionPurpose;
  queryId: string;
  question?: string;
  maxFrames?: number;
  analysisMode?: AnalysisMode;
  knownEntities?: string[];
  continuousSequence?: boolean;
  includeSpeech?: boolean;
  maxWaitMs?: number;
}

interface QueryVideoEvidenceInput {
  mediaAssetId: string;
  query: string;
  /**
   * Optional semantic instruction produced by the chat model. The evidence
   * action still has a safe focused retrieval path when a weak model cannot
   * construct the richer directive.
   */
  investigation?: VideoInvestigationDirective;
  limit?: number;
  exhaustive?: boolean;
  cursor?: number;
}

export interface VideoIntelligenceAgentClient extends VideoIntelligenceClient {
  queryVideoEvidence(
    input: QueryVideoEvidenceInput,
    context: AgentToolExecutionContext,
  ): Promise<unknown>;
  inspectVideoKnowledge(
    input: InspectVideoKnowledgeInput,
    context: AgentToolExecutionContext,
  ): Promise<unknown>;
}

/** Chat actions stay inside the installed tool; the host only sees workflow roles. */
export const AGENT_TOOLS = [
  {
    name: 'queryVideoEvidence',
    description:
      'Answer a question about an indexed video. It uses ranked evidence for focused questions, a chronological scan for source-authored or observed inventories, and a durable aggregate for a whole-source account. Perform a bounded direct re-watch only when returned evidence is genuinely incomplete or conflicting. For a full-source request, follow continuation.nextCursor until hasMore=false.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaAssetId', 'query'],
      properties: {
        mediaAssetId: { type: 'string', minLength: 1 },
        query: { type: 'string', minLength: 1, maxLength: 2_000 },
        investigation: {
          type: 'object',
          additionalProperties: false,
          required: ['scope', 'goal'],
          properties: {
            scope: { type: 'string', enum: ['focused', 'temporal', 'source'] },
            goal: {
              type: 'string',
              enum: ['answer', 'compare', 'trace', 'enumerate', 'synthesize'],
            },
            evidence: {
              type: 'array',
              maxItems: 4,
              items: { type: 'string', enum: ['speech', 'visible-text', 'visual', 'computed'] },
            },
            recordSet: {
              type: 'string',
              enum: ['all', 'source-authored', 'source-questions', 'observed'],
            },
            timeRange: {
              type: 'object',
              additionalProperties: false,
              required: ['startSecs', 'endSecs'],
              properties: {
                startSecs: { type: 'number', minimum: 0 },
                endSecs: { type: 'number', minimum: 0 },
              },
            },
          },
        },
        limit: { type: 'integer', minimum: 1, maximum: 48 },
        exhaustive: { type: 'boolean' },
        cursor: { type: 'integer', minimum: 0 },
      },
    },
    method: 'queryVideoEvidence',
    workflow: 'evidence-query',
    evidenceInput: 'media-asset',
    systemPromptFragment:
      'Use this action for media questions. On every call, derive investigation from the user’s meaning in their own language: use focused for one local moment, temporal for a relationship or development across moments, and source when the answer must account for the recording as a whole. Set answer, compare, trace, enumerate, or synthesize according to the reasoning operation—not the video genre or a word list. If the user supplies a specific source time or range, put its resolved seconds in investigation.timeRange; otherwise omit it. For a source enumeration, set recordSet to source-authored for units authored in the recording, source-questions for only authored questions and their answers, observed for time-grounded observed facts, or all when both are needed. Choose source plus synthesize for the overall narrative. Focused questions use ranked evidence; source enumerations use a chronological database scan; source explanations use a durable navigation aggregate. Never turn a complete-source request into top-K retrieval. For an exhaustive result, follow continuation.nextCursor until hasMore=false; do not mistake one page for the complete answer. Never say you do not know or that the source lacks an answer before this action has attempted its available fallback. State a value, identity, count, or exact visible fact only when established. observedSubjects, when present, is the reconciled frame-grounded visibility ledger: use its ranges for visible-presence and timing claims, never speech, titles, or a source name. Its durations are observed intervals, not inferred continuous screen time. Answer as a viewer who remembers the material: lead with the answer itself, and when natural say "I saw" or "I heard" rather than describing a system. Do not say "the video shows", "the analysis indicates", or "according to retrieved evidence". Never mention retrieval, search, indexing, frames, tools, or analysis unless the user asks how the answer was found.',
  },
  {
    name: 'inspectVideoKnowledge',
    description:
      'Inspect a bounded source range when another evidence action asks for corroboration. Do not scan an entire video.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaAssetId', 'startSecs', 'endSecs', 'purpose', 'queryId'],
      properties: {
        mediaAssetId: { type: 'string' },
        startSecs: { type: 'number', minimum: 0 },
        endSecs: { type: 'number', minimum: 0 },
        purpose: {
          type: 'string',
          enum: ['verify-visual', 'high-res-ocr', 'compare', 'count', 'track', 'code'],
        },
        queryId: { type: 'string', minLength: 1, maxLength: 128 },
        question: { type: 'string', minLength: 1, maxLength: 2000 },
        maxFrames: { type: 'integer', minimum: 1, maximum: 24 },
        continuousSequence: { type: 'boolean' },
        includeSpeech: { type: 'boolean' },
      },
    },
    method: 'inspectVideoKnowledge',
    workflow: 'evidence-refinement',
    systemPromptFragment:
      'When this action returns fresh evidence, query the relevant evidence source again before making the claim.',
  },
] satisfies AgentToolDefinition[];

export function attachVideoIntelligenceAgentClient(
  client: VideoIntelligenceClient,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): VideoIntelligenceAgentClient {
  const inspectVideoKnowledge = createInspector(fetcher);
  return Object.assign(client, {
    inspectVideoKnowledge,
    async queryVideoEvidence(input: QueryVideoEvidenceInput, context: AgentToolExecutionContext) {
      if (!isValidQueryInput(input))
        return { success: false, error: 'A media asset and question are required.' };
      const mediaEvidence = context.mediaEvidence;
      if (!mediaEvidence)
        return { success: false, error: 'The host has not provided scoped media evidence access.' };
      const startedAt = Date.now();
      const asset = await mediaEvidence.getAsset(input.mediaAssetId);
      if (!asset || asset.processingStatus !== 'completed')
        return { success: false, error: 'A completed video asset is required.' };

      const focusedQuery = focusQuestion(input.query, asset.fileName);
      const directive = validInvestigation(input.investigation)
        ? input.investigation
        : // If the conversational planner is unavailable, preserving the full
          // source is safer than silently reducing an arbitrary question to a
          // Top-K local match. A later planner result may optimize this, but the
          // evidence capability must have a source-complete fallback for every
          // language and kind of recording.
          { scope: 'source' as const, goal: 'synthesize' as const };
      const plan: VideoPlan = mediaEvidence.planQuestion(focusedQuery, directive);
      const focusedInput = {
        ...input,
        query: focusedQuery,
        investigation: directive,
        // Requests that span a whole recording need deterministic pagination
        // through the index. Callers should not need to know this tool's query
        // planner well enough to opt into exhaustive retrieval themselves.
        exhaustive: input.exhaustive ?? plan.requiresBroadCoverage === true,
      };
      const durationSecs = asset.durationSecs;
      // Complete inventories are a deterministic database scan, never an
      // expanded Top-K query. The chat route follows the opaque cursor itself,
      // so a model cannot stop early or mistake its context window for source
      // coverage.
      if (plan.route === 'scan' && mediaEvidence.scan) {
        const sourceInventory =
          focusedInput.investigation.recordSet === 'source-authored' ||
          focusedInput.investigation.recordSet === 'source-questions';
        const scanned = await mediaEvidence.scan(input.mediaAssetId, {
          kind: sourceInventory ? 'source-inventory' : 'all-evidence',
          cursor: input.cursor,
          limit: input.limit,
        });
        if (scanned) {
          // A source inventory can contain headings, slides, and literal list
          // items too. A question table must contain only source questions;
          // the cursor still follows every raw record so coverage remains an
          // exact chronological scan rather than a filtered Top-K search.
          const scanRecords =
            focusedInput.investigation.recordSet === 'source-questions'
              ? scanned.records.filter(
                  (record) =>
                    record.kind === 'question' &&
                    record.questionRole !== 'interactional' &&
                    record.questionRole !== 'rhetorical',
                )
              : scanned.records;
          const evidence = scanRecords.map(scanRecordToEvidence);
          // Inventory rows are a source-data contract, not prose for the
          // answer model to interpret. The host can aggregate every cursor
          // page and render/search/export the complete result without putting
          // a long recording's authored units in an LLM context window.
          const rows = scanRecords.map(scanRecordToRow);
          // A page is directly grounded when the indexed source coverage is
          // complete. The chat host owns cursor-following and will withhold a
          // final exhaustive rendering until the final page arrives.
          const complete = scanned.coverage.complete;
          void trackUsageEvent({
            type: 'media_processing',
            mediaType: asset.type === 'audio' ? 'audio' : 'video',
            mediaOperation: 'investigation',
            mediaAssetId: input.mediaAssetId,
            queryKind: plan.kinds.join(','),
            cache: 'hit',
            evidenceCount: evidence.length,
            frameCount: 0,
            durationSecs: 0,
            latencyMs: Date.now() - startedAt,
            timestamp: new Date().toISOString(),
          });
          return {
            success: true,
            mediaAssetId: input.mediaAssetId,
            fileName: asset.fileName,
            evidence,
            inventory: {
              recordSet: focusedInput.investigation.recordSet ?? 'all',
              coverage: {
                complete,
                ...(scanned.coverage.reason ? { reason: scanned.coverage.reason } : {}),
              },
            },
            columns: SOURCE_INVENTORY_COLUMNS,
            rows,
            totalRows: rows.length,
            resultHandle: scanned.resultHandle,
            claimVerification: {
              status: complete ? 'directly-established' : 'needs-corroboration',
              directlyEstablished: complete,
              rule: complete
                ? scanned.continuation.hasMore
                  ? `This is a chronological page from complete active ${
                      sourceInventory ? 'source inventory' : 'source evidence'
                    }. Follow the cursor before presenting a complete answer.`
                  : `This result is a complete chronological scan of active ${
                      sourceInventory ? 'source inventory' : 'source evidence'
                    }. Preserve every returned item and its timestamp.`
                : (scanned.coverage.reason ??
                  'The active index does not prove complete source coverage, so present these items as partial rather than complete.'),
            },
            investigation: {
              answerPath: 'deterministic-scan',
              responseTimeMs: Date.now() - startedAt,
              analyzedRanges: [],
              broadCoverage: true,
              coverage: {
                mode: 'broad',
                totalChapters: 0,
                totalScenes: 0,
                representedRanges: scanned.coverage.scannedRecords,
              },
            },
            continuation: {
              exhaustive: true,
              hasMore: scanned.continuation.hasMore,
              ...(scanned.continuation.nextCursor !== undefined
                ? { nextCursor: scanned.continuation.nextCursor }
                : {}),
              totalItems: scanned.continuation.totalRecords,
              resultHandle: scanned.resultHandle,
            },
          };
        }
      }
      // The compact aggregate is revision-cached and carries protocol-backed
      // source questions and visual sightings that ranked snippets can split
      // apart. It is navigation material, not a substitute for source truth.
      const aggregate = mediaEvidence.aggregate
        ? await mediaEvidence.aggregate(input.mediaAssetId)
        : undefined;
      // Start with the index alone. Planning and visual locating are useful
      // fallbacks, but waiting for both before checking an already-complete RAG
      // answer made simple questions feel like analysis jobs.
      // A source position supplied by the user is a retrieval boundary, not
      // merely another ranking signal.  Read that bounded part of the index
      // first so a whole-recording overview cannot displace its evidence.
      const explicitRanges = directiveTimeRange(directive, durationSecs);
      const [rankedHits, explicitlyScopedHits] = await Promise.all([
        retrieve(mediaEvidence, focusedInput, plan, durationSecs),
        explicitRanges.length > 0
          ? retrieveEvidenceInRanges(
              mediaEvidence,
              focusedInput,
              plan,
              durationSecs,
              explicitRanges,
            )
          : Promise.resolve([]),
      ]);
      let hits = mergeHits(
        explicitlyScopedHits,
        rankedHits,
        aggregate ? aggregateToHits(aggregate) : [],
      );
      let investigation: VideoInvestigation;
      let locatedRanges: Array<{ startSecs: number; endSecs: number }> = explicitRanges;
      let assessment = assessEvidence(hits, focusedInput.query, plan, durationSecs, undefined);

      if (!assessment.sufficient) {
        const [plannedInvestigation, semanticRanges] = await Promise.all([
          mediaEvidence.planInvestigation?.(
            input.mediaAssetId,
            focusedInput.query,
            focusedInput.investigation,
          ),
          // Where independent indexed signals agree the answer is. This is
          // measured navigation, not evidence, and only runs after the fast
          // indexed answer test has failed.
          mediaEvidence.locate?.(input.mediaAssetId, focusedInput.query, {
            maxRanges: 4,
            maxWindowSecs: MAX_INSPECTION_CHUNK_SECS,
          }) ?? Promise.resolve([]),
        ]);
        investigation = plannedInvestigation;
        const additionalRanges = uniqueRanges(semanticRanges);
        locatedRanges = uniqueRanges([...explicitRanges, ...additionalRanges]);
        const locatedEvidence = await retrieveEvidenceInRanges(
          mediaEvidence,
          focusedInput,
          plan,
          durationSecs,
          additionalRanges,
        );
        hits = mergeHits(locatedEvidence, hits);
        assessment = assessEvidence(hits, focusedInput.query, plan, durationSecs, investigation);
      }
      let analyzedRanges: TimeRange[] = [];
      let inspection: unknown;
      let analysisUnavailable: string | undefined;
      const responseDeadline = startedAt + INTERACTIVE_INSPECTION_BUDGET_MS;

      // Retrieval locates; it does not decide that something is unknowable.
      // When the index cannot answer, the agent goes and watches the moments
      // the index pointed at rather than reporting that the source is silent.
      if (!assessment.sufficient && plan.requiresInspectionWhenInsufficient) {
        const targets = inspectionTargets(
          hits,
          focusedInput.query,
          plan,
          assessment,
          durationSecs,
          investigation,
          locatedRanges,
        );
        // Re-reading the source directly is the cheap way to settle this, so it
        // goes first. Dispatching a re-index below costs minutes on a cold
        // worker and frequently outlives the turn, which is what turns an
        // answerable question into an unconfirmed one.
        if (targets.length > 0 && mediaEvidence.reWatch) {
          const readings = await mediaEvidence
            .reWatch(
              input.mediaAssetId,
              focusedInput.query,
              // The host reads these windows together, so a fourth costs
              // little wall time and a progression usually needs more than two.
              targets.slice(0, 4).map((range) => ({
                ...range,
                lookingFor: windowObjective(plan),
              })),
              {
                maxWaitMs: Math.max(
                  1_000,
                  Math.min(INTERACTIVE_REWATCH_BUDGET_MS, responseDeadline - Date.now()),
                ),
                knownEntities: inspectionEntityHints(hits, plan),
              },
            )
            .catch(() => []);
          const established = readings.filter(
            (reading) => reading.settlesQuestion && reading.found.trim(),
          );
          if (established.length > 0) {
            const supportingClip = established[0].range;
            const indexedEvidence = evidenceHitsFor(
              hits,
              assessment,
              plan,
              focusedInput,
              durationSecs,
            );
            return {
              success: true,
              mediaAssetId: input.mediaAssetId,
              fileName: asset.fileName,
              evidence: indexedEvidence,
              supportingClip,
              ui: citationSurface(
                asset,
                context,
                established.map((reading) => ({
                  modality: 'visual',
                  timeRange: { ...reading.range, precision: 'estimated' },
                })),
                supportingClip,
              ),
              directObservation: {
                readings: established,
                rule:
                  'These are direct readings taken by re-watching the source just now, for this ' +
                  'question. Answer from them and cite the timestamps they came from, and do not ' +
                  'report that the source fails to show something a reading here establishes. ' +
                  'Weigh them against each other and against the indexed evidence rather than ' +
                  'taking each at face value: a reading is strongest where several readings and ' +
                  'the index agree. A lone reading that contradicts both the other readings and ' +
                  'the index -- naming someone or something that appears nowhere else -- is a ' +
                  'misreading, whatever confidence it carries; leave it out rather than reporting ' +
                  'it. IMPORTANT: If a reading states that a detail (e.g. names, identities) is missing, ' +
                  'unclear, or not explicitly shown in its limited clip, but that detail IS established ' +
                  'by the indexed evidence, rely on the indexed evidence. Do not let an isolated reading ' +
                  'erase established timeline facts. Where the readings genuinely conflict, say what is certain and what is not.',
              },
              ...temporalContextResult(hits, plan),
              claimVerification: {
                status: 'directly-established',
                directlyEstablished: true,
                rule: 'The source was re-watched for this question; answer from what it established.',
              },
              investigation: {
                answerPath: 'rag+rewatch',
                responseTimeMs: Date.now() - startedAt,
                analyzedRanges: established.map((reading) => reading.range),
                broadCoverage: plan.requiresBroadCoverage === true,
                coverage: investigation?.coverage,
                directive: investigationDirectiveForOutput(focusedInput.investigation),
              },
              ...(shouldIncludeObservedSubjects(aggregate, focusedInput.investigation, plan)
                ? { observedSubjects: aggregate!.visibleSubjects }
                : {}),
              ...(focusedInput.exhaustive
                ? { continuation: exhaustiveContinuation(hits, assessment, focusedInput) }
                : {}),
            };
          }
        }
        if (targets.length > 0) {
          const outcome = await inspectRanges({
            targets,
            input: focusedInput,
            plan,
            context,
            inspectVideoKnowledge,
            knownEntities: inspectionEntityHints(hits, plan),
            deadline: responseDeadline,
            onWaveComplete: async (watched) => {
              // An inspection appends evidence asynchronously to the same
              // index used by normal RAG.  A broad outcome lookup can still
              // rank an older overview ahead of that new record, especially
              // when it expands into a source-wide timeline.  Read each
              // range we just watched explicitly first, then merge it with
              // normal retrieval.  This is provenance-based rather than
              // question-specific: every live inspection must be able to
              // contribute its own observations to the answer.
              const [freshWatchedEvidence, retrieved] = await Promise.all([
                retrieveEvidenceInRanges(
                  mediaEvidence,
                  focusedInput,
                  plan,
                  durationSecs,
                  watched.ranges,
                ),
                retrieve(mediaEvidence, focusedInput, plan, durationSecs),
              ]);
              hits = mergeHits(freshWatchedEvidence, retrieved);
              assessment = assessEvidence(
                hits,
                focusedInput.query,
                plan,
                durationSecs,
                investigation,
                watched,
              );
              return assessment.sufficient;
            },
          });
          analyzedRanges = outcome.analyzed;
          inspection = outcome.lastResult;
          // Watching the source is how a claim gets confirmed, so a service
          // that cannot run leaves the claim unconfirmed -- but it does not
          // erase what the index already found. Fail the turn only when
          // there is nothing to show; otherwise return the indexed evidence
          // and say plainly that it could not be checked against the source.
          if (outcome.failure) {
            analysisUnavailable = outcome.failure;
            if (hits.length === 0) {
              return {
                success: false,
                mediaAssetId: input.mediaAssetId,
                error: `${outcome.failure} This is an analysis-service issue, not missing video evidence; do not answer the factual question as unconfirmed.`,
              };
            }
          }
        }
      }

      const evidence = evidenceHitsFor(hits, assessment, plan, focusedInput, durationSecs);
      const supportingClip = plan.kinds.includes('outcome')
        ? evidence.at(-1)?.timeRange
        : evidence[0]?.timeRange;
      // A complete visibility ledger is useful for a source-wide or temporal
      // question, but it is dangerous extra context for a single requested
      // moment: a renderer can accidentally combine a remote appearance with
      // that moment.  The selected evidence already carries any ledger entry
      // whose explicit interval overlaps the focused request.
      const includeObservedSubjects = shouldIncludeObservedSubjects(
        aggregate,
        focusedInput.investigation,
        plan,
      );
      const responseTimeMs = Date.now() - startedAt;
      const answerPath = analyzedRanges.length > 0 ? 'rag+analysis' : 'rag';
      void trackUsageEvent({
        type: 'media_processing',
        mediaType: asset.type === 'audio' ? 'audio' : 'video',
        mediaOperation: 'investigation',
        mediaAssetId: input.mediaAssetId,
        queryKind: plan.kinds.join(','),
        cache: answerPath === 'rag' ? 'hit' : 'miss',
        evidenceCount: evidence.length,
        frameCount: analyzedRanges.length,
        durationSecs: analyzedRanges.reduce(
          (total, range) => total + range.endSecs - range.startSecs,
          0,
        ),
        latencyMs: responseTimeMs,
        timestamp: new Date().toISOString(),
      });
      return {
        success: true,
        mediaAssetId: input.mediaAssetId,
        fileName: asset.fileName,
        evidence,
        ...(supportingClip ? { supportingClip } : {}),
        ...(assessment.sufficient && supportingClip
          ? {
              // The UI contract is generic and tool-owned. The host only
              // renders a citations surface; it does not know why this
              // source range was selected or expose extraction details.
              ui: citationSurface(asset, context, evidence, supportingClip),
            }
          : {}),
        claimVerification: {
          status: assessment.establishedByTrail
            ? 'established-by-trail'
            : assessment.sufficient
              ? 'directly-established'
              : 'needs-corroboration',
          directlyEstablished: assessment.sufficient && !assessment.establishedByTrail,
          rule: answeringRule(assessment, plan, analysisUnavailable),
        },
        investigation: {
          answerPath,
          responseTimeMs,
          analyzedRanges,
          broadCoverage: plan.requiresBroadCoverage === true,
          coverage: investigation?.coverage,
          directive: investigationDirectiveForOutput(focusedInput.investigation),
        },
        ...(includeObservedSubjects ? { observedSubjects: aggregate!.visibleSubjects } : {}),
        ...(focusedInput.exhaustive
          ? { continuation: exhaustiveContinuation(hits, assessment, focusedInput) }
          : {}),
        ...(inspection ? { inspection } : {}),
        ...temporalContextResult(hits, plan),
      };
    },
  });
}

/**
 * What one re-watched window has to establish.
 *
 * The reader receives the user's whole question, which for a question spanning
 * several moments describes the answer as a whole rather than the part this
 * window can settle. Saying what this window is for is the difference between
 * a reader summarising the passage and one reading the label off a shirt.
 * Phrased from the question's shape, so it carries no assumption about subject
 * matter.
 */
function windowObjective(plan: VideoPlan): string | undefined {
  if (plan.subjectName) {
    return `Which visible person is "${plan.subjectName}", and what the question asks about them.`;
  }
  if (plan.kinds.includes('state-change') || plan.kinds.includes('outcome')) {
    return (
      'What changes during this window, what it changed from and to, and who or what brought it ' +
      'about. Name whoever is responsible if anything on screen or in the speech names them -- a ' +
      'caption, a label, a number worn or displayed, an announcement -- and say which of those ' +
      'established the name. If nothing names them, say so instead of guessing.'
    );
  }
  if (plan.kinds.includes('counting')) {
    return 'How many of the thing being asked about are visible here, and how you counted them.';
  }
  if (plan.kinds.includes('evaluation')) {
    return 'For each identified person, record only observable contributions or participation in this window, with what identifies the person. Do not rank them from this window alone.';
  }
  if (plan.kinds.includes('person-attribute') || plan.requiresIdentityContext) {
    return 'Who is visible here, what identifies each of them, and the attribute being asked about.';
  }
  return undefined;
}

/** The evidence a reply cites, in the shape the host renders. */
function evidenceHitsFor(
  hits: VideoKnowledgeSearchHit[],
  assessment: EvidenceAssessment,
  plan: VideoPlan,
  input: QueryVideoEvidenceInput,
  durationSecs: number | undefined,
) {
  // A request can both name a source position and ask for a relationship to
  // the rest of the recording. Keep a direct account of that named position
  // beside the broader trail: otherwise a renderer can attach a remote named
  // subject to the local, merely described subject. This relies only on the
  // typed time boundary, so it applies to any language and kind of media.
  const localAnchor = explicitlyRequestedMomentEvidence(hits, plan, durationSecs);
  return mergeHits(
    localAnchor,
    selectAnswerEvidence(hits, assessment, plan, input, durationSecs),
  ).map((hit) => toEvidence(hit, plan));
}

function explicitlyRequestedMomentEvidence(
  hits: VideoKnowledgeSearchHit[],
  plan: VideoPlan,
  durationSecs: number | undefined,
) {
  const requestedRanges = directiveTimeRange(plan.investigation, durationSecs);
  if (requestedRanges.length === 0) return [];
  const scoped = hits.filter((hit) =>
    requestedRanges.some(
      (range) =>
        hit.evidence.timeRange.startSecs < range.endSecs &&
        hit.evidence.timeRange.endSecs > range.startSecs,
    ),
  );
  return mergeHits(
    scoped.filter((hit) => hit.evidence.modality === 'visual' && isAccountOfMoment(hit)),
    scoped.filter((hit) => {
      const text = evidenceText(hit.evidence.payload);
      return /^Reconciled visible subject:\s*[^\n]+\nIdentity basis:/im.test(text);
    }),
    scoped.filter(isAccountOfMoment),
  ).slice(0, 4);
}

type VideoPlan = {
  kinds: string[];
  route?: 'search' | 'temporal' | 'aggregate' | 'scan' | 'export';
  requiresBothRanges?: boolean;
  requiresBroadCoverage?: boolean;
  requiresIdentityContext?: boolean;
  requiresInspectionWhenInsufficient: boolean;
  subjectName?: string;
  investigation?: VideoInvestigationDirective;
};
type MediaEvidence = NonNullable<AgentToolExecutionContext['mediaEvidence']>;
type VideoKnowledgeSearchHit = Awaited<ReturnType<MediaEvidence['search']>>[number];
type VideoInvestigation = Awaited<ReturnType<NonNullable<MediaEvidence['planInvestigation']>>>;

/**
 * Keep the source-navigation decision alongside the evidence it governed.
 * The renderer uses this typed provenance to distinguish a local sighting
 * from a request that also asks how that sighting relates to the full source.
 */
function investigationDirectiveForOutput(directive: VideoInvestigationDirective) {
  return {
    scope: directive.scope,
    goal: directive.goal,
    ...(directive.recordSet ? { recordSet: directive.recordSet } : {}),
    ...(directive.timeRange ? { timeRange: directive.timeRange } : {}),
  };
}

function shouldIncludeObservedSubjects(
  aggregate: Awaited<ReturnType<NonNullable<MediaEvidence['aggregate']>>> | undefined,
  directive: VideoInvestigationDirective,
  plan: VideoPlan,
): boolean {
  return Boolean(
    aggregate?.visibleSubjects &&
    (directive.recordSet === 'observed' ||
      directive.scope !== 'focused' ||
      plan.requiresBroadCoverage === true),
  );
}

function scanRecordToEvidence(
  record: NonNullable<Awaited<ReturnType<NonNullable<MediaEvidence['scan']>>>>['records'][number],
) {
  const prefix =
    record.kind === 'question'
      ? `Source question (${record.channel ?? 'spoken'}${
          record.questionRole ? `, ${record.questionRole}` : ''
        }): ${record.text}`
      : record.kind === 'evidence'
        ? record.text
        : `Source item (${record.kind}, ${record.channel ?? 'visible'}): ${record.text}`;
  const text = [
    prefix,
    ...(record.taskId ? [`Source task id: ${record.taskId}`] : []),
    ...(record.answer ? [`Source answer: ${record.answer}`] : []),
    ...(record.respondent ? [`Source respondent: ${record.respondent}`] : []),
  ].join('\n');
  return {
    id: record.id,
    evidenceId: record.sourceEvidenceId,
    modality: record.modality,
    timeRange: record.timeRange,
    payload: { text },
    confidence: record.confidence,
  };
}

const SOURCE_INVENTORY_COLUMNS = [
  'Timestamp',
  'Content',
  'Answer',
  'Respondent',
  'Channel',
  'Record type',
] as const;

/** Keep the scan's original authored fields intact for generic data-table rendering. */
function scanRecordToRow(
  record: NonNullable<Awaited<ReturnType<NonNullable<MediaEvidence['scan']>>>>['records'][number],
) {
  return {
    // This stable key is intentionally not a displayed column. It lets the
    // host de-duplicate opaque cursor pages without guessing from content.
    id: record.id,
    Timestamp: formatSourceTimestamp(record.timeRange.startSecs),
    Content: record.text,
    Answer: record.answer ?? '',
    Respondent: record.respondent ?? '',
    Channel: record.channel ?? '',
    'Record type': record.kind,
  };
}

function formatSourceTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function aggregateToHits(
  aggregate: NonNullable<Awaited<ReturnType<NonNullable<MediaEvidence['aggregate']>>>>,
): VideoKnowledgeSearchHit[] {
  const createdAt = new Date().toISOString();
  return [
    ...aggregate.participants.map((participant, index) => ({
      evidence: {
        id: `${aggregate.resultHandle}:participant:${index}`,
        modality: 'computed',
        timeRange: participant.timeRange,
        payload: {
          text: `Reconciled participant: ${participant.name} — ${participant.description}`,
        },
        source: { kind: 'provider', provider: 'video-intelligence-index' },
        confidence: { score: 0.8 },
        createdAt,
      },
      score: 1,
      conflict: false,
    })),
    ...aggregate.timeline.map((entry, index) => ({
      evidence: {
        id: `${aggregate.resultHandle}:timeline:${index}`,
        modality: 'computed',
        timeRange: entry.timeRange,
        payload: { text: entry.text },
        source: { kind: 'provider', provider: 'video-intelligence-index' },
        confidence: { score: 0.75 },
        createdAt,
      },
      score: 0.7,
      conflict: false,
    })),
    ...aggregate.sourceItems.map((item, index) => ({
      evidence: {
        id: `${aggregate.resultHandle}:source-item:${index}`,
        modality: 'computed',
        timeRange: item.timeRange,
        payload: {
          text:
            item.kind === 'question'
              ? `Source question (${item.channel ?? 'spoken'}${
                  item.questionRole ? `, ${item.questionRole}` : ''
                }): ${item.text}${item.answer ? `\nSource answer: ${item.answer}` : ''}${
                  item.respondent ? `\nSource respondent: ${item.respondent}` : ''
                }`
              : item.kind === 'structure'
                ? `Source structure: ${item.text}${
                    item.promptSlots === undefined
                      ? ''
                      : `\nSource prompt slots: ${item.promptSlots}`
                  }`
                : `Source item (${item.kind}): ${item.text}`,
        },
        source: { kind: 'provider', provider: 'video-intelligence-index' },
        confidence: { score: 0.82 },
        createdAt,
      },
      score: 0.8,
      conflict: false,
    })),
    ...aggregate.visibleSubjects.map((subject, index) => ({
      evidence: {
        id: `${aggregate.resultHandle}:visible-subject:${index}`,
        modality: 'computed',
        timeRange: {
          startSecs: subject.appearances[0]?.startSecs ?? 0,
          endSecs: subject.appearances.at(-1)?.endSecs ?? subject.appearances[0]?.endSecs ?? 0,
          precision: 'estimated',
        },
        payload: {
          text:
            `Reconciled visible subject: ${subject.identity}\n` +
            `Identity basis: ${subject.identityBasis}\n` +
            `Observed appearances: ${subject.appearances
              .map((range) => `${range.startSecs}-${range.endSecs}s`)
              .join('; ')}\n` +
            `Observed visible duration: ${subject.observedDurationSecs}s`,
        },
        source: { kind: 'provider', provider: 'video-intelligence-index' },
        confidence: { score: subject.identityBasis === 'source-named' ? 0.8 : 0.6 },
        createdAt,
      },
      score: 0.8,
      conflict: false,
    })),
  ] as VideoKnowledgeSearchHit[];
}

/**
 * What the question needs from the evidence, and whether the evidence has it.
 *
 * `breadth` questions ask the answer to represent the source, so the test is
 * how much of the source the evidence touches. Every other question asks for
 * something specific, so the test is whether any single piece of evidence
 * actually establishes it. Both tests are about the shape of the request, not
 * about what the video contains.
 */
interface EvidenceAssessment {
  sufficient: boolean;
  /** Several independent readings of the same moment jointly establish it. */
  establishedByTrail?: boolean;
  needsBreadth: boolean;
  established: VideoKnowledgeSearchHit[];
  /** Fraction of the source the useful evidence spans, for breadth questions. */
  coverageRatio: number;
  /**
   * Records that bear on the claim without stating it outright -- readings
   * over time, a state and the change to it, the two sides of a comparison.
   * A conclusion, a count, and a comparison are answered by reading across
   * several records; requiring one record to contain the whole answer treats
   * that as an unanswerable question, which is why a source whose closing
   * state was plainly indexed still came back as "could not be confirmed".
   */
  corroborating: VideoKnowledgeSearchHit[];
}

async function retrieve(
  mediaEvidence: MediaEvidence,
  input: QueryVideoEvidenceInput,
  plan: VideoPlan,
  durationSecs: number | undefined,
) {
  const options = { queryPlan: plan, videoDurationSecs: durationSecs };
  // A named person and an identity anchor are extra retrieval handles for the
  // same index, not separate strategies. Issuing them alongside the ranked
  // lookup costs one round trip instead of three.
  const crossEvidence = isCrossEvidenceClaim(plan);
  const [ranked, subjectHits, identityHits, visualHits, computedHits] = await Promise.all([
    mediaEvidence.search(input.mediaAssetId, input.query, 16, options),
    plan.subjectName
      ? mediaEvidence.search(input.mediaAssetId, plan.subjectName, 12, options)
      : Promise.resolve([]),
    plan.requiresIdentityContext
      ? mediaEvidence.search(
          input.mediaAssetId,
          'participant names roster lineup name labels captions speaker identities',
          8,
          options,
        )
      : Promise.resolve([]),
    crossEvidence
      ? mediaEvidence.search(input.mediaAssetId, input.query, 16, {
          ...options,
          modalities: ['visual'],
        })
      : Promise.resolve([]),
    crossEvidence
      ? mediaEvidence.search(input.mediaAssetId, input.query, 16, {
          ...options,
          modalities: ['computed'],
        })
      : Promise.resolve([]),
  ]);
  if (!needsSourceWideView(plan)) {
    return mergeHits(ranked, visualHits, computedHits, subjectHits, identityHits);
  }
  // A question about breadth or order cannot be served by the top matches
  // alone: the relevant moment may share no words with the question. Scanning
  // the immutable observations stays local and avoids a blind analysis pass.
  const transitionTimeline = plan.kinds.includes('outcome') || plan.kinds.includes('state-change');
  const timeline = await mediaEvidence.search(
    input.mediaAssetId,
    '',
    input.exhaustive ? 2_000 : 500,
    {
      ...options,
      // A long transcript can contain more than 500 distinct moments before
      // the source reaches its conclusion. For transition questions, read the
      // compact reconciled accounts first so the final state cannot be cut off
      // by hundreds of earlier speech/OCR records. Older indexes with no
      // computed account fall back to the ordinary all-modality pass below.
      ...(transitionTimeline ? { modalities: ['computed'] as const } : {}),
      // Keep independent modalities at one moment, but diversify repeated
      // readings inside each modality. Re-inspecting a range can otherwise fill
      // the whole timeline with near-identical records from that one minute.
      minimumRangeDistanceSecs: 2,
    },
  );
  const sourceTimeline =
    transitionTimeline && timeline.length < CORROBORATION_FLOOR
      ? await mediaEvidence.search(input.mediaAssetId, '', input.exhaustive ? 2_000 : 500, {
          ...options,
          minimumRangeDistanceSecs: 2,
        })
      : timeline;
  return plan.requiresIdentityContext
    ? mergeHits(
        ranked.slice(0, 3),
        identityHits.slice(0, 3),
        visualHits,
        computedHits,
        ranked,
        subjectHits,
        sourceTimeline,
      )
    : mergeHits(ranked, visualHits, computedHits, subjectHits, sourceTimeline);
}

/**
 * Fetch observations emitted by the immediately preceding live inspection.
 *
 * This deliberately uses the ordinary evidence API, scoped to the watched
 * time range. It avoids coupling the tool to a host-specific job payload and
 * makes a newly indexed direct observation visible before relevance/diversity
 * ranking can favour an older whole-video summary.
 */
async function retrieveEvidenceInRanges(
  mediaEvidence: MediaEvidence,
  input: QueryVideoEvidenceInput,
  plan: VideoPlan,
  durationSecs: number | undefined,
  ranges: TimeRange[],
) {
  if (ranges.length === 0) return [];
  const options = {
    queryPlan: plan,
    videoDurationSecs: durationSecs,
    modalities: ['visual', 'transcript', 'ocr', 'computed'],
    // Keep all fresh observations from this compact range. The agent uses
    // provenance and claim verification below to decide which can answer.
    minimumRangeDistanceSecs: 0,
  };
  const groups = await Promise.all(
    ranges.map(async (range) => {
      const rangeOptions = { ...options, timeRange: range };
      // Query matching can fail across languages or when an observation uses
      // a natural description instead of the user's wording.  The bounded
      // unranked read preserves all accounts from the requested moment; the
      // normal query remains alongside it for relevance ordering.
      const [ranked, bounded] = await Promise.all([
        mediaEvidence.search(input.mediaAssetId, input.query, 24, rangeOptions),
        mediaEvidence.search(input.mediaAssetId, '', 48, rangeOptions),
      ]);
      return mergeHits(ranked, bounded);
    }),
  );
  return mergeHits(...groups);
}

function needsSourceWideView(plan: VideoPlan) {
  return (
    plan.requiresBroadCoverage === true ||
    plan.kinds.includes('coverage') ||
    plan.kinds.includes('state-change') ||
    plan.kinds.includes('outcome')
  );
}

function assessEvidence(
  hits: VideoKnowledgeSearchHit[],
  question: string,
  plan: VideoPlan,
  durationSecs: number | undefined,
  investigation: VideoInvestigation,
  watched: WatchedRanges = { ranges: [], since: '' },
): EvidenceAssessment {
  const needsBreadth =
    plan.requiresBroadCoverage === true ||
    plan.kinds.includes('coverage') ||
    plan.kinds.includes('state-change');
  const usable = hits.filter(
    (hit) =>
      !(hit as { conflict?: boolean }).conflict &&
      ['transcript', 'ocr', 'visual', 'computed'].includes(hit.evidence.modality),
  );

  if (needsBreadth) {
    const answerBearing = plan.kinds.includes('question-inventory')
      ? questionInventoryHits(usable, question)
      : plan.kinds.includes('source-inventory')
        ? sourceInventoryHits(usable, question)
        : plan.kinds.includes('entity-inventory')
          ? identityInventoryHits(usable, question)
          : plan.kinds.includes('evaluation')
            ? evaluationEvidenceHits(usable)
            : plan.kinds.includes('state-change')
              ? temporalSequenceHits(usable)
              : usable;
    const isQuestionInventory = plan.kinds.includes('question-inventory');
    const isSourceInventory = plan.kinds.includes('source-inventory');
    const isEntityInventory = plan.kinds.includes('entity-inventory');
    const explicitQuestionInventoryReady =
      isQuestionInventory &&
      answerBearing.some(
        (hit) =>
          (hit as VideoKnowledgeSearchHit & { sourceQuestionProvenance?: string })
            .sourceQuestionProvenance === 'explicit',
      );
    const explicitSourceInventoryReady =
      isSourceInventory &&
      answerBearing.some((hit) =>
        /^Source item \((?:heading|slide-item|board-item|list-item),\s*(?:spoken|visible)\):/im.test(
          evidenceText(hit.evidence.payload),
        ),
      );
    const coverageRatio =
      isQuestionInventory || isSourceInventory || isEntityInventory
        ? answerBearing.length > 0
          ? 1
          : 0
        : sourceCoverageRatio(answerBearing, durationSecs);
    const hierarchy = investigation?.coverage;
    const hierarchyReady = !hierarchy || hierarchy.totalChapters > 0 || hierarchy.totalScenes > 0;
    // A broad RAG timeline is already the product of watching and indexing
    // the source. Re-watching fixed windows on every ordered-change question
    // made analysis the primary path, added minutes to chat, and could return
    // a worse partial account than the index. Distinct timestamped moments
    // spanning the source are sufficient; direct analysis remains the
    // fallback when that coverage test fails or evidence conflicts.
    const distinctMoments = new Set(
      answerBearing
        .filter((hit) => !spansWholeSource(hit, durationSecs) && isAccountOfMoment(hit))
        .map((hit) => Math.floor(hit.evidence.timeRange.startSecs / 15)),
    ).size;
    const sequenceReady = !plan.kinds.includes('state-change') || distinctMoments >= 3;
    const reconciledSequenceReady =
      plan.kinds.includes('state-change') &&
      distinctMoments >= 3 &&
      answerBearing.every((hit) => hit.evidence.source?.provider === 'video-intelligence-index');
    return {
      needsBreadth,
      coverageRatio,
      established: answerBearing,
      corroborating: answerBearing,
      sufficient: isQuestionInventory
        ? explicitQuestionInventoryReady
        : isSourceInventory
          ? explicitSourceInventoryReady
          : isEntityInventory
            ? answerBearing.length > 0
            : plan.kinds.includes('evaluation')
              ? evaluationEvidenceReady(answerBearing)
              : reconciledSequenceReady ||
                (answerBearing.length >= 3 &&
                  coverageRatio >= 0.6 &&
                  hierarchyReady &&
                  sequenceReady),
    };
  }

  const direct = answerEstablishedHits(hits, question, plan, watched);
  const reconciled =
    direct.length === 0 ? indexedReconciledAnswerHits(hits, plan, durationSecs) : [];
  const trail =
    direct.length === 0 && reconciled.length === 0 && isCrossEvidenceClaim(plan)
      ? indexedCrossEvidenceTrail(hits, durationSecs, plan)
      : [];
  const indexedAttributes = indexedUnboundSubjectAttributes(hits, question, plan);
  const requestsKnownIdentity = identityAnchorNames(hits).some((name) =>
    question.normalize('NFKC').toLocaleLowerCase().includes(name),
  );
  const namedAttributeRequest = requestsKnownIdentity && plan.kinds.includes('person-attribute');
  const establishedByCrossEvidence =
    !namedAttributeRequest &&
    !plan.kinds.includes('person-attribute') &&
    trail.length >= CORROBORATION_FLOOR &&
    trailHasRequiredIdentity(hits, trail, plan);
  // A request to describe each visible subject can be answered accurately by
  // a corroborated set of source descriptions even when no personal name was
  // ever shown. That is different from a question about a named person: the
  // latter still needs a name-to-person grounding before an attribute may be
  // attached to them.
  const describesUnboundSubjects =
    !plan.subjectName &&
    !requestsKnownIdentity &&
    plan.requiresIdentityContext === true &&
    plan.kinds.includes('person-attribute') &&
    indexedAttributes.length > 0 &&
    attributeCoverageReady(indexedAttributes, hits);
  const unboundSubjectEvidence = indexedAttributes;
  const established =
    direct.length > 0
      ? direct
      : reconciled.length > 0
        ? reconciled
        : describesUnboundSubjects
          ? unboundSubjectEvidence
          : establishedByCrossEvidence
            ? trail
            : [];
  return {
    needsBreadth,
    coverageRatio: 1,
    established,
    corroborating: mergeHits(unboundSubjectEvidence, usable.filter(isAccountOfMoment)),
    // A reconciled, multi-modal trail is answer-level evidence once any
    // required identity is grounded. Other trails remain targeting context,
    // so an ambiguous sequence still falls through to bounded inspection.
    sufficient:
      direct.length > 0 ||
      reconciled.length > 0 ||
      describesUnboundSubjects ||
      establishedByCrossEvidence,
    establishedByTrail: direct.length === 0 && reconciled.length === 0 && established.length > 0,
  };
}

/** Keep compact records that actually bind an entity to source evidence. */
function identityInventoryHits(hits: VideoKnowledgeSearchHit[], _question: string) {
  const selected = chronological(hits).filter((hit) => {
    const text = evidenceText(hit.evidence.payload);
    return (
      /^(?:Reconciled|Indexed)\s+(?:participant|visible subject):\s*[^\n]{2,180}/im.test(text) ||
      /^Visible subject:\s*\{/im.test(text) ||
      /^Present:\s*[^—\n]{2,120}\s*—/im.test(text)
    );
  });
  const seen = new Set<string>();
  return selected
    .filter((hit) => {
      const text = evidenceText(hit.evidence.payload).trim();
      const key = text.normalize('NFKC').toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 48);
}

function groupedIdentityStrength(hit: VideoKnowledgeSearchHit) {
  const text = primaryAccount(evidenceText(hit.evidence.payload));
  const anchoredSubjects = subjectEvidenceCount(text);
  let groupedBindings = 0;
  const serializedBindings = text.match(/^Claim bindings:\s*(.+)$/im)?.[1];
  if (serializedBindings) {
    try {
      const bindings = JSON.parse(serializedBindings) as Array<{ subject?: unknown }>;
      groupedBindings = bindings.filter((binding) => typeof binding?.subject === 'string').length;
    } catch {
      groupedBindings = 0;
    }
  }
  return (
    anchoredSubjects * 4 +
    groupedBindings * 8 +
    Number((hit as VideoKnowledgeSearchHit & { score?: number }).score ?? 0)
  );
}

/**
 * A judgement about contribution needs representative, identity-bearing
 * moments across the source. Return a compact spread for synthesis rather
 * than every transcript fragment or one semantically lucky scene.
 */
function evaluationEvidenceHits(hits: VideoKnowledgeSearchHit[]) {
  const semanticAccounts = chronological(hits).filter((hit) => {
    if (!isAccountOfMoment(hit) || hasNegativeVerdict(hit)) return false;
    const text = evidenceText(hit.evidence.payload);
    return (
      /^(?:Reconciled|Indexed)\s+(?:participant|event|context|state):/im.test(text) ||
      /^Present:\s*[^—\n]{2,120}\s*—/im.test(text)
    );
  });
  // Semantic scene notes already fuse speech, action, identity and timing.
  // Raw transcript is the fallback for audio-only sources; mixing hundreds of
  // tiny ASR fragments into a healthy visual index hides the actual activity.
  const useful =
    semanticAccounts.length >= 3
      ? semanticAccounts
      : mergeHits(
          semanticAccounts,
          chronological(hits).filter(
            (hit) => hit.evidence.modality === 'transcript' && isAccountOfMoment(hit),
          ),
        );
  return evenlySpaced(useful, 36);
}

/** A comparative judgement needs repeated source-anchored activity. */
function evaluationEvidenceReady(hits: VideoKnowledgeSearchHit[]) {
  const momentsBySubject = new Map<string, Set<number>>();
  for (const hit of hits) {
    const text = primaryAccount(evidenceText(hit.evidence.payload));
    for (const identity of subjectIdentities(text)) {
      const key = identity.normalize('NFKC').toLocaleLowerCase();
      const moments = momentsBySubject.get(key) ?? new Set<number>();
      moments.add(Math.floor(hit.evidence.timeRange.startSecs / 15));
      momentsBySubject.set(key, moments);
    }
  }
  return [...momentsBySubject.values()].filter((moments) => moments.size >= 2).length >= 2;
}

/** Source-wide authored units extracted during indexing, independent of genre or language. */
function sourceInventoryHits(hits: VideoKnowledgeSearchHit[], _question: string) {
  const records = chronological(hits).filter((hit) => {
    const account = evidenceText(hit.evidence.payload);
    const kind = account.match(
      /^Source item \((heading|slide-item|board-item|list-item),\s*(?:spoken|visible)\):/im,
    )?.[1];
    return Boolean(kind);
  });
  const seen = new Set<string>();
  return records.filter((hit) => {
    const key = evidenceText(hit.evidence.payload).normalize('NFKC').toLocaleLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Prefer the index's reconciled trajectory over hundreds of unrelated raw signals. */
function temporalSequenceHits(hits: VideoKnowledgeSearchHit[]) {
  const reconciled = chronological(hits).filter((hit) => {
    if (hit.evidence.source?.provider !== 'video-intelligence-index') return false;
    const text = evidenceText(hit.evidence.payload).trim();
    return /^(?:Reconciled|Indexed)\s+(?:state|event):/i.test(text);
  });
  // Older indexes may not contain a synthesized trajectory. Preserve their
  // broad raw account so a targeted inspection can still use it.
  return reconciled.length >= 3 ? reconciled : hits;
}

/** Keep only source-authored prompts for an exhaustive question inventory. */
function questionInventoryHits(hits: VideoKnowledgeSearchHit[], _query: string) {
  const seen = new Set<string>();
  const candidates = chronological(hits).flatMap((hit) => {
    // A later chat inspection can itself contain the user's question. It is
    // useful for that answer, but it was never part of the recorded source.
    if (hit.evidence.source?.provider === 'video-intelligence-vision') return [];
    return sourceQuestionRecordsFromHit(hit).flatMap((record, index) => {
      const normalizedQuestion = normalizeInventoryText(record.question);
      if (!normalizedQuestion) return [];
      const key = [
        normalizedQuestion,
        normalizeInventoryText(record.context ?? ''),
        normalizeInventoryText(record.answer ?? ''),
      ].join('|');
      if (seen.has(key)) return [];
      seen.add(key);
      const lines = [`Question: ${record.question}`];
      if (record.context) lines.push(`Context: ${record.context}`);
      if (record.answer) lines.push(`Answer: ${record.answer}`);
      return [
        {
          ...hit,
          sourceQuestionProvenance: record.explicit ? 'explicit' : 'legacy',
          sourceQuestionChannel: record.channel,
          sourceQuestionText: record.question,
          evidence: {
            ...hit.evidence,
            id: `${hit.evidence.id}:source-question:${index}`,
            payload: { text: lines.join('\n') },
          },
        },
      ];
    });
  });
  // OCR and ASR often capture the same prompt with slight spelling or
  // transcription differences. Collapse nearby copies and retain the visible
  // or fullest reading, while preserving genuine repeats later in the source.
  return candidates.filter((candidate) => {
    const candidateRecord = candidate as typeof candidate & {
      sourceQuestionChannel?: string;
      sourceQuestionText?: string;
    };
    if (!candidateRecord.sourceQuestionText) return true;
    const nearbyCopies = candidates.filter((other) => {
      const otherText = (other as typeof other & { sourceQuestionText?: string })
        .sourceQuestionText;
      return (
        Boolean(otherText) &&
        Math.abs(other.evidence.timeRange.startSecs - candidate.evidence.timeRange.startSecs) <=
          90 &&
        inventoryQuestionsMatch(candidateRecord.sourceQuestionText!, otherText!)
      );
    });
    if (nearbyCopies.length < 2) return true;
    const preferred = nearbyCopies.sort((left, right) => {
      const leftRecord = left as typeof left & {
        sourceQuestionChannel?: string;
        sourceQuestionText?: string;
      };
      const rightRecord = right as typeof right & {
        sourceQuestionChannel?: string;
        sourceQuestionText?: string;
      };
      const channelLead =
        Number(rightRecord.sourceQuestionChannel === 'visible') -
        Number(leftRecord.sourceQuestionChannel === 'visible');
      if (channelLead !== 0) return channelLead;
      return (
        (rightRecord.sourceQuestionText?.length ?? 0) - (leftRecord.sourceQuestionText?.length ?? 0)
      );
    })[0];
    return preferred === candidate;
  });
}

interface SourceQuestionRecord {
  question: string;
  answer?: string;
  context?: string;
  explicit: boolean;
  channel?: 'spoken' | 'visible';
}

function normalizeInventoryText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function inventoryQuestionTokens(value: string) {
  return new Set(
    value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{Letter}\p{Number}][\p{Letter}\p{Mark}\p{Number}_-]*/gu) ?? [],
  );
}

function inventoryQuestionsMatch(left: string, right: string) {
  const leftTokens = inventoryQuestionTokens(left);
  const rightTokens = inventoryQuestionTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.6;
}

function isWellFormedSourceQuestion(record: SourceQuestionRecord) {
  // The source mapper has already semantically classified this record.  The
  // executor only guards the transport shape and never applies a language
  // list to decide whether a source sentence is a question.
  return record.question.normalize('NFKC').trim().length >= 4;
}

function sourceQuestionRecordsFromHit(hit: VideoKnowledgeSearchHit): SourceQuestionRecord[] {
  const text = evidenceText(hit.evidence.payload);
  if (/^Question:\s*[^\n]+/i.test(text)) {
    const question = text.match(/^Question:\s*([^\n]+)/i)?.[1]?.trim();
    return question ? [{ question, explicit: true }] : [];
  }

  const context = inventoryContext(text);
  const explicit: SourceQuestionRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const sourceMatch = lines[index]?.match(/^Source question \((spoken|visible)\):\s*(.+)$/i);
    const question = sourceMatch?.[2]?.trim();
    if (!question) continue;
    const answer = lines[index + 1]?.match(/^Source answer:\s*(.+)$/i)?.[1]?.trim();
    explicit.push({
      question,
      answer,
      context,
      explicit: true,
      channel: sourceMatch?.[1]?.toLocaleLowerCase() as 'spoken' | 'visible',
    });
  }
  if (explicit.length > 0) return explicit.filter(isWellFormedSourceQuestion);

  // Compatibility for indexes produced before sourceQuestions existed. Only
  // accept text visibly presented as a question, or a claim question that is
  // independently echoed by the observation. The analysis prompt by itself
  // is deliberately not source evidence.
  const visibleQuestions = [...text.matchAll(/^On screen:\s*['“"]?(.+?[?؟])['”"]?(?:\s+—.*)?$/gim)]
    .map((match) => match[1]?.trim())
    .filter((question): question is string => Boolean(question));
  if (visibleQuestions.length > 0)
    return visibleQuestions.map((question) => ({ question, context, explicit: false }));

  // `Claim question` is the analysis request supplied to the vision model,
  // never source-authored content. Older observations sometimes paraphrased
  // that request in their summary, which made a lexical echo look like a
  // question from the recording. Only explicitly transcribed source questions
  // or visibly quoted legacy questions are safe inventory entries.
  return [];
}

function inventoryContext(text: string) {
  const summary = text
    .split(
      /(?:^|\n)(?:Present:|On screen:|Happened(?: \(inferred\))?:|Direct component:|Source question \(|Claim question:)/i,
      1,
    )[0]
    ?.replace(/^Observed context \(not a complete answer\):\s*/i, '')
    .trim();
  return summary ? summary.slice(0, 600) : undefined;
}

function temporalContextResult(hits: VideoKnowledgeSearchHit[], plan: VideoPlan) {
  if (!plan.kinds.includes('outcome') && !plan.kinds.includes('state-change')) return {};
  const readings = chronological(temporalSequenceHits(hits))
    .filter((hit) => {
      const text = evidenceText(hit.evidence.payload).trim();
      return (
        hit.evidence.source?.provider === 'video-intelligence-index' &&
        /^(?:Reconciled|Indexed)\s+(?:state|event):/i.test(text) &&
        !hasNegativeVerdict(hit)
      );
    })
    .filter((hit, index, all) => {
      const key = `${Math.floor(hit.evidence.timeRange.startSecs)}:${evidenceText(
        hit.evidence.payload,
      )}`;
      return (
        all.findIndex(
          (candidate) =>
            `${Math.floor(candidate.evidence.timeRange.startSecs)}:${evidenceText(
              candidate.evidence.payload,
            )}` === key,
        ) === index
      );
    })
    .slice(-48)
    .map((hit) => ({
      atSecs: hit.evidence.timeRange.startSecs,
      text: evidenceText(hit.evidence.payload).slice(0, 700),
    }));
  if (readings.length === 0) return {};
  return {
    temporalContext: {
      readings,
      rule:
        'Read the timestamped states as a trajectory. Earlier and later counters can belong to ' +
        'different scopes: a reset or a change in labels, unit, or scale is a scope boundary. ' +
        'Resolve the ending state of the sequence relevant to the question from its changes and ' +
        'labels. Within one uninterrupted scope, an unlabeled state inherits the nearest earlier ' +
        'stable side labels; it does not inherit identities from an older scope. For an outcome, ' +
        'compare the ending settled values and answer at the side/team/role granularity those ' +
        'labels establish. Do not turn the leading side into a personal outcome unless this same ' +
        'scope explicitly binds that person to the side. Do not substitute an earlier state merely ' +
        'because it contains queried names, and do not rely on the last frame alone.',
    },
  };
}

/**
 * The index synthesizer can reconcile several source readings into one
 * timestamped account. One semantically matched account can settle an
 * unbound state because it is already the result of indexing-time analysis.
 * Identity attribution remains stricter: similarity locates the moment but
 * never proves who the state belongs to.
 */
function indexedReconciledAnswerHits(
  hits: VideoKnowledgeSearchHit[],
  plan: VideoPlan,
  durationSecs: number | undefined,
) {
  // Semantic similarity is a locator, not an identity proof. A single
  // reconciled record may settle an unbound state, but questions asking who
  // require either a direct verdict or a trail joined to an identity anchor.
  if (!isCrossEvidenceClaim(plan) || plan.requiresIdentityContext) return [];
  return hits.filter((hit) => {
    const provider = hit.evidence.source?.provider;
    const confidence = Number(
      (hit.evidence.confidence as { score?: unknown } | undefined)?.score ?? 0,
    );
    const semantic = Number(
      (hit as { components?: { semantic?: unknown } }).components?.semantic ?? 0,
    );
    const lexical = Number(
      (hit as { components?: { lexical?: unknown } }).components?.lexical ?? 0,
    );
    const text = evidenceText(hit.evidence.payload).trim();
    return (
      provider === 'video-intelligence-index' &&
      hit.evidence.modality === 'computed' &&
      confidence >= 0.5 &&
      text.length >= 20 &&
      (semantic >= 0.05 || lexical >= 0.2) &&
      !hasNegativeVerdict(hit) &&
      !hasNegativeVerdict(hit) &&
      !spansWholeSource(hit, durationSecs)
    );
  });
}

/**
 * A visual observation already indexed for an attribute question is useful
 * evidence even where the source never establishes a personal name. Keep the
 * relation generic: it permits a source-backed description of visible people,
 * but never attaches it to a guessed identity or claims a complete roster.
 */
function indexedUnboundSubjectAttributes(
  hits: VideoKnowledgeSearchHit[],
  question: string,
  plan: VideoPlan,
) {
  if (
    plan.subjectName ||
    plan.requiresIdentityContext !== true ||
    !plan.kinds.includes('person-attribute')
  ) {
    return [];
  }
  return hits.filter(
    (hit) =>
      (hit.evidence.modality === 'visual' ||
        (hit.evidence.modality === 'computed' &&
          hit.evidence.source?.provider === 'video-intelligence-index')) &&
      isAccountOfMoment(hit) &&
      !hasNegativeVerdictForQuestion(hit, question),
  );
}

/** Do not call a two-person description complete when the index establishes a wider group. */
function attributeCoverageReady(
  attributes: VideoKnowledgeSearchHit[],
  allHits: VideoKnowledgeSearchHit[],
) {
  const described = Math.max(0, ...attributes.map(explicitAttributedPeopleInAccount));
  const known = Math.max(0, ...allHits.map(explicitPeopleInAccount));
  return described > 0 && (known === 0 || described >= known);
}

function explicitAttributedPeopleInAccount(hit: VideoKnowledgeSearchHit) {
  return subjectEvidenceCount(primaryAccount(evidenceText(hit.evidence.payload)));
}

function explicitPeopleInAccount(hit: VideoKnowledgeSearchHit) {
  return subjectEvidenceCount(primaryAccount(evidenceText(hit.evidence.payload)));
}

/** Read only the internal evidence protocol, never a user-language role list. */
function subjectIdentities(text: string) {
  const identities = new Set<string>();
  for (const match of text.matchAll(
    /^(?:Reconciled|Indexed)\s+(?:participant|visible subject):\s*([^\n—]{1,180})/gim,
  )) {
    const value = match[1]?.trim();
    if (value) identities.add(value);
  }
  for (const match of text.matchAll(/^Present:\s*([^—\n]{1,180})\s*—/gim)) {
    const value = match[1]?.trim();
    if (value) identities.add(value);
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('Visible subject: ')) continue;
    try {
      const subject = JSON.parse(line.slice('Visible subject: '.length)) as { identity?: unknown };
      if (typeof subject.identity === 'string' && subject.identity.trim()) {
        identities.add(subject.identity.trim());
      }
    } catch {
      // A malformed note is not source evidence.
    }
  }
  return [...identities];
}

function subjectEvidenceCount(text: string) {
  return subjectIdentities(text).length;
}

function primaryAccount(text: string) {
  return text.split(/\nContinuity from (?:the )?(?:preceding|previous) moment:/i, 1)[0] ?? text;
}

/**
 * Independent descriptions of the same bounded moment can establish a claim
 * together even when no generated record repeats the user's wording. This is
 * deliberately local in time: two generally relevant snippets from different
 * parts of a long recording are not treated as corroboration.
 */
function indexedCrossEvidenceTrail(
  hits: VideoKnowledgeSearchHit[],
  durationSecs: number | undefined,
  plan: VideoPlan,
) {
  const candidates = hits.filter(
    (hit) =>
      isAccountOfMoment(hit) && !hasNegativeVerdict(hit) && !spansWholeSource(hit, durationSecs),
  );
  const transitionQuestion = plan.kinds.includes('outcome') || plan.kinds.includes('state-change');
  const seeds = [...candidates]
    .sort((left, right) => {
      const strength = (hit: VideoKnowledgeSearchHit) => {
        return (
          Number((hit as { score?: unknown }).score ?? 0) +
          (hasNegativeVerdict(hit) ? -0.35 : 0) +
          (transitionQuestion && durationSecs
            ? Math.min(0.1, (hit.evidence.timeRange.endSecs / durationSecs) * 0.1)
            : 0)
        );
      };
      return strength(right) - strength(left);
    })
    .slice(0, 32);
  // When the question asks how a state changed or concluded, the reconciled
  // state sequence is the evidence. A richly indexed but unrelated local
  // moment can otherwise win the clustering race and hide that trajectory.
  if (transitionQuestion) {
    const moments = new Set<number>();
    const sequence = chronological(
      temporalSequenceHits(candidates).filter(
        (hit) =>
          hit.evidence.modality === 'computed' &&
          hit.evidence.source?.provider === 'video-intelligence-index' &&
          /^(?:Reconciled|Indexed)\s+(?:state|event):/i.test(
            evidenceText(hit.evidence.payload).trim(),
          ),
      ),
    ).filter((hit) => {
      const moment = Math.floor(hit.evidence.timeRange.startSecs / 15);
      if (moments.has(moment)) return false;
      moments.add(moment);
      return true;
    });
    if (sequence.length >= CORROBORATION_FLOOR) return sequence.slice(-12);
  }
  for (const seed of seeds) {
    const cluster = candidates.filter(
      (hit) =>
        hit.evidence.timeRange.startSecs <= seed.evidence.timeRange.endSecs + 5 &&
        hit.evidence.timeRange.endSecs >= seed.evidence.timeRange.startSecs - 5,
    );
    const modalities = new Set(cluster.map((hit) => hit.evidence.modality));
    const hasReconciledReading = cluster.some(
      (hit) => hit.evidence.source?.provider === 'video-intelligence-index',
    );
    if (cluster.length >= CORROBORATION_FLOOR && modalities.size >= 2 && hasReconciledReading) {
      return reconciledFirst(cluster).slice(0, 12);
    }
  }
  // A progression can also be established by the index's reconciled states
  // at separate moments. Keep this narrower than "several relevant hits":
  // only computed accounts produced by the index qualify, and identity-bound
  // questions still have to pass trailHasRequiredIdentity below.
  return [];
}

/**
 * How much of the source the evidence touches, measured in equal buckets.
 * The bucket count grows with length so a three-hour recording is not called
 * covered by three clips from its first minute.
 */
function sourceCoverageRatio(hits: VideoKnowledgeSearchHit[], durationSecs: number | undefined) {
  if (hits.length === 0) return 0;
  if (!durationSecs || durationSecs <= 0) return hits.length >= 3 ? 1 : 0;
  const buckets = Math.min(12, Math.max(3, Math.ceil(durationSecs / (10 * 60))));
  const covered = new Set(
    hits.map((hit) =>
      Math.min(
        buckets - 1,
        Math.max(0, Math.floor((hit.evidence.timeRange.startSecs / durationSecs) * buckets)),
      ),
    ),
  );
  return covered.size / buckets;
}

/**
 * Where to look, chosen from what retrieval already found. Breadth questions
 * spread their looks across the source; specific questions look closely at
 * the best-matching moments. Nothing here knows what kind of video it is.
 */
function inspectionTargets(
  hits: VideoKnowledgeSearchHit[],
  question: string,
  plan: VideoPlan,
  assessment: EvidenceAssessment,
  durationSecs: number | undefined,
  investigation: VideoInvestigation,
  located: Array<{ startSecs: number; endSecs: number }> = [],
): TimeRange[] {
  // A conclusion needs the closing stretch *and* whatever retrieval ranked,
  // so it gets room for both rather than spending its whole budget on one.
  const budget = assessment.needsBreadth
    ? 6
    : plan.requiresBothRanges || plan.kinds.includes('outcome')
      ? 3
      : 2;
  const fromHits = rangesAroundHits(hits, durationSecs, budget * 2);
  const fromHierarchy = (investigation?.candidateRanges ?? []).map((range) => ({
    startSecs: Math.max(0, range.startSecs),
    endSecs: Math.min(
      durationSecs ?? range.endSecs,
      Math.min(range.endSecs, range.startSecs + MAX_INSPECTION_CHUNK_SECS),
    ),
  }));
  // A question about how something concluded is answered where the source
  // concludes. Retrieval ranks by resemblance to the question, and the
  // closing moments often resemble it least -- they may show a result with
  // none of the question's words. Putting the ending first is what the word
  // "conclusion" means for any recording, not a fact about its subject.
  const closing = plan.kinds.includes('outcome') ? closingRanges(durationSecs) : [];
  // A question about how something changed is answered at the moments it
  // changed, and the index already recorded where those are. Aiming there beats
  // an even spread, which lands between the transitions and reports the states
  // either side of them without ever showing one happen.
  const transitions = plan.kinds.includes('state-change')
    ? // An account of the whole progression needs every moment it moved.
      outcomeTransitionRanges(hits, durationSecs, { limit: budget, lateOnly: false })
    : plan.kinds.includes('outcome')
      ? outcomeTransitionRanges(hits, durationSecs, { limit: 1 })
      : [];
  // For a conclusion, a located window inside the closing phase beats the
  // closing offsets, which only know how long the recording is. Elsewhere in
  // the source, located windows lead outright: they are the one signal that
  // reflects the question rather than the shape of the file.
  const phase = closingPhase(durationSecs);
  // A user-specified source position is stronger than semantic retrieval:
  // "at the beginning" should inspect the beginning even when a visually
  // similar later moment scores higher. These are generic timeline cues, not
  // assumptions about any particular video genre.
  const requestedPosition = directiveTimeRange(plan.investigation, durationSecs);
  // Who is present is usually established early -- a roster, a title card, an
  // introduction -- so a question about identity is worth one look at the
  // opening. A question about how something concluded is not: its answer is at
  // the other end of the source, and spending a look on the opening there buys
  // a description of an entrance while the conclusion goes unread.
  const identityContext =
    plan.requiresIdentityContext && durationSecs && !plan.kinds.includes('outcome')
      ? [{ startSecs: 0, endSecs: Math.min(MAX_INSPECTION_CHUNK_SECS, durationSecs) }]
      : [];
  const identityCoverage =
    plan.kinds.includes('person-attribute') ||
    plan.kinds.includes('entity-inventory') ||
    plan.kinds.includes('evaluation')
      ? [...hits]
          .sort(
            (left, right) =>
              explicitPeopleInAccount(right) - explicitPeopleInAccount(left) ||
              left.evidence.timeRange.startSecs - right.evidence.timeRange.startSecs,
          )
          .filter((hit) => explicitPeopleInAccount(hit) > 0)
          .slice(0, 1)
          .map((hit) => ({
            startSecs: Math.max(0, hit.evidence.timeRange.startSecs - TARGET_PADDING_SECS),
            endSecs: Math.min(
              durationSecs ?? hit.evidence.timeRange.endSecs + TARGET_PADDING_SECS,
              hit.evidence.timeRange.endSecs + TARGET_PADDING_SECS,
            ),
          }))
      : [];
  const locatedFirst =
    plan.kinds.includes('outcome') && phase
      ? [
          ...closing.slice(0, 1),
          ...transitions,
          ...closing.slice(1),
          ...located.filter(
            (range) => range.startSecs <= phase.endSecs && range.endSecs >= phase.startSecs,
          ),
          ...located,
        ]
      : [...transitions, ...located, ...closing];
  const candidates = uniqueRanges([
    ...requestedPosition,
    ...identityContext,
    ...identityCoverage,
    ...locatedFirst,
    ...fromHits,
    ...fromHierarchy,
  ]);
  if (!assessment.needsBreadth) {
    // An index with nothing to say about the question is the strongest
    // reason to go and watch, not a reason to stop. With no moment to aim
    // at, sample the source instead of returning empty-handed.
    return (candidates.length > 0 ? candidates : evenlySpacedAnchors(durationSecs, budget)).slice(
      0,
      budget,
    );
  }
  // Breadth needs the looks spread over the source rather than clustered on
  // whichever part retrieval happened to rank highest, so gaps in the index
  // get filled in by anchors of their own. Transitions are exempt from that
  // spreading: they are the specific moments the question is about, and
  // sampling evenly across the source would drop them for being close together.
  const spread = evenlySpaced(
    uniqueRanges([...candidates, ...evenlySpacedAnchors(durationSecs, budget)])
      .filter((range) => !transitions.some((moment) => moment.startSecs === range.startSecs))
      .sort((left, right) => left.startSecs - right.startSecs),
    Math.max(1, budget - transitions.length),
  );
  return uniqueRanges([...transitions, ...spread]).slice(0, budget);
}

function directiveTimeRange(
  directive: VideoInvestigationDirective | undefined,
  durationSecs: number | undefined,
): TimeRange[] {
  const requested = directive?.timeRange;
  if (!requested) return [];
  const limit =
    durationSecs && Number.isFinite(durationSecs) && durationSecs > 0 ? durationSecs : Infinity;
  const startSecs = Math.max(0, Math.min(limit, requested.startSecs));
  const endSecs = Math.max(startSecs, Math.min(limit, requested.endSecs));
  return endSecs > startSecs ? [{ startSecs, endSecs }] : [];
}

/**
 * An indexed account that explicitly describes a late transition is a better
 * first look than a fixed percentage of the file. It remains only a locator:
 * the source is still inspected before the claim is returned.
 */
function outcomeTransitionRanges(
  hits: VideoKnowledgeSearchHit[],
  durationSecs: number | undefined,
  options: { limit?: number; lateOnly?: boolean } = {},
): TimeRange[] {
  const { limit = 2, lateOnly = true } = options;
  const accounts = hits.filter((hit) => {
    if (!isAccountOfMoment(hit) || hasNegativeVerdict(hit) || spansWholeSource(hit, durationSecs)) {
      return false;
    }
    return /^(?:Reconciled|Indexed)\s+(?:state|event):/i.test(
      evidenceText(hit.evidence.payload).trim(),
    );
  });
  if (accounts.length === 0) return [];
  // A question about a conclusion looks late; a question about the whole
  // progression wants every moment it moved, wherever they fall.
  const lateAccounts =
    lateOnly && durationSecs
      ? accounts.filter((hit) => {
          const start = hit.evidence.timeRange.startSecs / durationSecs;
          return start >= 0.6 && start <= 0.97;
        })
      : [];
  const ranked = (lateAccounts.length > 0 ? lateAccounts : accounts).sort((left, right) => {
    const retrievalDelta =
      Number((right as { score?: unknown }).score ?? 0) -
      Number((left as { score?: unknown }).score ?? 0);
    if (Math.abs(retrievalDelta) > 0.15) return retrievalDelta;
    return right.evidence.timeRange.startSecs - left.evidence.timeRange.startSecs;
  });
  return uniqueRanges(
    ranked.slice(0, limit).map((hit) => {
      // A retrieved transition usually identifies the lead-in; its resolving
      // frame or end-card often arrives immediately afterwards. End the
      // bounded look just beyond that evidence and keep the preceding
      // chronology, rather than centering it and cutting off the resolution.
      const endSecs = Math.min(
        durationSecs ?? hit.evidence.timeRange.endSecs + 9,
        hit.evidence.timeRange.endSecs + 9,
      );
      const startSecs = Math.max(0, endSecs - OUTCOME_RESOLUTION_WINDOW_SECS);
      return {
        startSecs,
        endSecs,
      };
    }),
  );
}

/**
 * Where a recording's content concludes. Not simply its last seconds: a
 * recording usually keeps running past the thing it recorded -- an outro,
 * credits, a sign-off, a trailer for something else -- so reading only the
 * final frames finds the tail rather than the conclusion. Three windows across
 * the closing stretch cover both, whatever the recording is of.
 */
function closingRanges(durationSecs: number | undefined): TimeRange[] {
  if (!durationSecs || !Number.isFinite(durationSecs) || durationSecs <= 0) return [];
  const window = Math.min(MAX_INSPECTION_CHUNK_SECS, durationSecs);
  // Where the content ends comes first, the literal end second. A runtime that
  // grants one look at a time spends it on whichever range is offered first,
  // and the final seconds are an outro, a sign-off, or a trailer for the next
  // thing -- watching those and reporting back is how a concluded recording
  // gets described as not showing its conclusion.
  const ends = [
    Math.max(window, durationSecs * 0.9),
    Math.max(window, durationSecs * 0.95),
    durationSecs,
  ];
  return uniqueRanges(
    ends.map((endSecs) => ({ startSecs: Math.max(0, endSecs - window), endSecs })),
  );
}

function rangesAroundHits(
  hits: VideoKnowledgeSearchHit[],
  durationSecs: number | undefined,
  limit: number,
) {
  const ranges: TimeRange[] = [];
  for (const hit of hits) {
    const candidate = {
      startSecs: Math.max(0, hit.evidence.timeRange.startSecs - TARGET_PADDING_SECS),
      endSecs: Math.min(
        durationSecs ?? hit.evidence.timeRange.endSecs + TARGET_PADDING_SECS,
        hit.evidence.timeRange.endSecs + TARGET_PADDING_SECS,
      ),
    };
    if (candidate.endSecs <= candidate.startSecs) continue;
    if (ranges.some((range) => Math.abs(range.startSecs - candidate.startSecs) < 20)) continue;
    ranges.push(candidate);
    if (ranges.length >= limit) break;
  }
  return ranges;
}

function evenlySpacedAnchors(durationSecs: number | undefined, count: number): TimeRange[] {
  if (!durationSecs || durationSecs <= 0 || count <= 0) return [];
  const window = Math.min(MAX_INSPECTION_CHUNK_SECS, durationSecs / Math.max(count, 1));
  return Array.from({ length: count }, (_, index) => {
    const startSecs = Math.max(0, Math.min(durationSecs - window, (index * durationSecs) / count));
    return { startSecs, endSecs: Math.min(durationSecs, startSecs + window) };
  }).filter((range) => range.endSecs > range.startSecs);
}

/**
 * Runs the targeted looks. Independent ranges are dispatched together so a
 * chat turn waits once rather than once per range, and each wave re-checks
 * the index so a question answered by the first wave never pays for the rest.
 *
 * A runtime that admits one job at a time answers a concurrent request with a
 * busy signal instead of doing the work, so the first busy response drops the
 * remaining ranges back to one at a time rather than failing the turn.
 */
async function inspectRanges(options: {
  targets: TimeRange[];
  input: QueryVideoEvidenceInput;
  plan: VideoPlan;
  context: AgentToolExecutionContext;
  inspectVideoKnowledge: ReturnType<typeof createInspector>;
  knownEntities: string[];
  deadline: number;
  onWaveComplete: (watched: WatchedRanges) => Promise<boolean>;
}) {
  const {
    targets,
    input,
    plan,
    context,
    inspectVideoKnowledge,
    knownEntities,
    deadline,
    onWaveComplete,
  } = options;
  const analyzed: TimeRange[] = [];
  const pending = [...targets];
  let lastResult: unknown;
  let failure: string | undefined;
  // Targets are in priority order, and a runtime that allows one job at a
  // time turns the rest of a parallel wave away. Firing the whole wave anyway
  // means whichever range the runtime happened to accept is the one that gets
  // watched -- so a conclusion question could spend its entire budget on an
  // opening shot while the closing range was rejected and never retried.
  // Watch the best range first, on its own, and only widen once the runtime
  // has shown it can take more.
  let waveSize = 1;
  const request = (range: TimeRange) =>
    inspectVideoKnowledge(
      {
        mediaAssetId: input.mediaAssetId,
        startSecs: range.startSecs,
        endSecs: range.endSecs,
        purpose: inspectionPurpose(plan.kinds),
        queryId: stableQueryId(input.query),
        question: input.query,
        maxFrames: plan.kinds.includes('state-change')
          ? 24
          : plan.kinds.includes('person-attribute') || plan.requiresIdentityContext
            ? // Identity reads need chronology, but a very dense single VLM
              // request is less reliable than a compact, readable spread.
              8
            : plan.requiresBothRanges ||
                plan.kinds.includes('comparison') ||
                plan.kinds.includes('outcome')
              ? 10
              : 14,
        ...(knownEntities.length > 0 ? { knownEntities } : {}),
        // A close read costs more per range, so it is spent where a wrong
        // reading of one detail changes the answer, and the fast reader
        // covers the ranges that only need to say what is happening.
        analysisMode: needsCloseReading(plan) ? 'thorough' : 'fast',
        continuousSequence: true,
        includeSpeech:
          plan.kinds.includes('direct-speech') ||
          plan.kinds.includes('state-change') ||
          plan.kinds.includes('outcome') ||
          plan.requiresIdentityContext,
        // The client transport enforces this same deadline.  Do not grant a
        // later range a fresh minimum wait: that turns a bounded chat turn
        // into several consecutive timeout windows when a worker is stalled.
        maxWaitMs: Math.max(1_000, deadline - Date.now()),
      },
      context,
    );

  while (pending.length > 0) {
    // The client transport owns the hard deadline. Do not start another
    // request once there is no meaningful time left for it to return.
    if (deadline - Date.now() < 1_000) {
      failure = 'Video analysis did not finish within the interactive response budget.';
      break;
    }
    const waveStartedAt = new Date().toISOString();
    const wave = pending.splice(0, waveSize);
    const results = await Promise.all(wave.map(request));
    const rejected: TimeRange[] = [];
    let busyMessage: string | undefined;
    for (const [position, result] of results.entries()) {
      if (isServiceBusy(result)) {
        rejected.push(wave[position]);
        busyMessage = isInspectionFailure(result) ? result.error : busyMessage;
        continue;
      }
      if (isInspectionFailure(result)) {
        failure = result.error;
        continue;
      }
      analyzed.push(wave[position]);
      lastResult = result;
    }
    if (rejected.length > 0) {
      // The runtime took one of these and turned the rest away. Put the
      // turned-away ranges back and stop asking for more than one at a time.
      if (waveSize === 1) {
        failure ??= busyMessage ?? 'Video analysis is busy with another request.';
        break;
      }
      waveSize = 1;
      pending.unshift(...rejected);
      failure = undefined;
      continue;
    }
    if (failure) break;
    if (await onWaveComplete({ ranges: analyzed, since: waveStartedAt })) break;
    // The runtime took everything it was offered, so it can take more at once.
    waveSize = Math.min(MAX_PARALLEL_INSPECTIONS, Math.max(waveSize * 2, 1), pending.length);
  }
  return { analyzed, lastResult, failure };
}

/**
 * Carries identities already established by the index into a bounded look.
 * This is especially important for comparisons involving several unnamed
 * subjects: the reader sees the pixels, while the index supplies the stable
 * names those pixels must be grounded against.
 */
function inspectionEntityHints(hits: VideoKnowledgeSearchHit[], plan: VideoPlan) {
  const hints: string[] = [];
  if (plan.subjectName) hints.push(plan.subjectName);
  if (plan.requiresIdentityContext || plan.kinds.includes('comparison')) {
    for (const hit of hits) {
      const payload = hit.evidence.payload;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const subject = (payload as { subject?: unknown }).subject;
        if (typeof subject === 'string' && subject.trim() && subject !== 'on-screen-text') {
          hints.push(subject.trim());
        }
      }
      const text = evidenceText(payload);
      for (const match of text.matchAll(
        /(?:Reconciled|Indexed) participant:\s*([^—\n]{1,120})/gi,
      )) {
        if (match[1]?.trim()) hints.push(match[1].trim());
      }
      hints.push(...subjectIdentities(text));
    }
  }
  return [...new Map(hints.map((hint) => [hint.toLocaleLowerCase(), hint])).values()].slice(0, 20);
}

function needsCloseReading(plan: VideoPlan) {
  return (
    plan.kinds.includes('exact-ocr') ||
    plan.kinds.includes('counting') ||
    // An unnamed, multi-person attribute request is a broad visual read: the
    // fast reader can describe its source-supported distinctions in one pass.
    // Reserve the slower precision model for linking an attribute to a
    // particular named person, where a mistaken association is materially
    // worse than a short follow-up inspection.
    (plan.kinds.includes('person-attribute') && Boolean(plan.subjectName))
  );
}

/**
 * The part of a recording where what it recorded actually concludes. A
 * recording runs on past that -- reactions, a sign-off, an end card -- so the
 * closing *phase* is the useful window; its final seconds are usually an outro
 * that says nothing about the question.
 */
/**
 * A record covering most of the recording -- a summary, an overview -- orients
 * the reader but locates nothing, so at most one belongs in a trail of
 * moments.
 */
function spansWholeSource(hit: VideoKnowledgeSearchHit, durationSecs: number | undefined) {
  if (!durationSecs || durationSecs <= 0) return false;
  const span = hit.evidence.timeRange.endSecs - hit.evidence.timeRange.startSecs;
  return span >= durationSecs * 0.5;
}

function closingPhase(durationSecs: number | undefined) {
  if (!durationSecs || durationSecs <= 0) return undefined;
  return { startSecs: durationSecs * 0.66, endSecs: durationSecs };
}

function selectAnswerEvidence(
  hits: VideoKnowledgeSearchHit[],
  assessment: EvidenceAssessment,
  plan: VideoPlan,
  input: QueryVideoEvidenceInput,
  durationSecs?: number,
) {
  if (assessment.needsBreadth) {
    const limit = Math.min(input.limit ?? 36, 48);
    if (input.exhaustive) {
      const ordered = chronological(assessment.established);
      const cursor = Math.min(Math.max(0, input.cursor ?? 0), ordered.length);
      return ordered.slice(cursor, cursor + limit);
    }
    return chronological(assessment.established).length <= limit
      ? chronological(assessment.established)
      : mergeHits(
          chronological(assessment.established).filter((hit) =>
            /Claim verdict:\s*direct/i.test(evidenceText(hit.evidence.payload)),
          ),
          evenlySpaced(chronological(assessment.established), limit),
        )
          .sort(
            (left, right) => left.evidence.timeRange.startSecs - right.evidence.timeRange.startSecs,
          )
          .slice(0, limit);
  }
  const limit = Math.min(
    input.limit ?? (plan.requiresBothRanges || isCrossEvidenceClaim(plan) ? 12 : 8),
    12,
  );
  if (assessment.establishedByTrail) {
    // A trail can exist while `established` is empty: the trail settles the
    // claim, but only a question about unnamed subjects promotes it into
    // `established`. Returning `established` alone then answered a perfectly
    // well-indexed question with no evidence at all -- the reply had nothing
    // to cite and said the source did not show it.
    const trail =
      assessment.established.length > 0 ? assessment.established : assessment.corroborating;
    return chronological(reconciledFirst(trail)).slice(0, limit);
  }
  if (!assessment.sufficient && isCrossEvidenceClaim(plan)) {
    const identity = plan.requiresIdentityContext ? hits.filter(isIdentityAnchor) : [];
    const stateChanges = hits
      .filter((hit) => {
        const text = evidenceText(hit.evidence.payload);
        return /^(?:Reconciled|Indexed)\s+(?:state|event):/i.test(text);
      })
      .sort(
        (left, right) => right.evidence.timeRange.startSecs - left.evidence.timeRange.startSecs,
      );
    return chronological(
      mergeHits(identity, stateChanges, assessment.corroborating, hits).slice(0, limit),
    );
  }
  const settled = plan.requiresInspectionWhenInsufficient
    ? assessment.established.length > 0
      ? assessment.established
      : hits
    : hits;
  // A direct, question-scoped observation is stronger than the surrounding
  // chronology. Do not dilute it with broad summaries or neighbouring signal
  // merely because the question also happens to be a comparison or outcome.
  // Those supporting records remain available when no direct answer exists.
  if (
    assessment.sufficient &&
    assessment.established.some((hit) => isDirectVerdict(hit, input.query, plan))
  ) {
    return reconciledFirst(assessment.established).slice(0, limit);
  }
  // A conclusion, a count, and a comparison are read across the source, so the
  // chronology is the answer material whether or not a bounded look settled
  // anything. Returning only what one 60-second look produced replaced that
  // chronology with a minute of raw on-screen text -- a successful look made
  // the answer worse. Records are chosen by relevance, then presented in time
  // order, because a trail shuffled by rank cannot be read as one.
  if (isCrossEvidenceClaim(plan) && assessment.corroborating.length >= CORROBORATION_FLOOR) {
    // A trail has to reach its end to be readable as one. Relevance alone
    // clusters near whatever the index describes most richly -- usually the
    // opening -- so the latest records are reserved a share of the slots
    // outright. Without this the chronology stopped a third of the way in and
    // the conclusion it was supposed to lead to was never in it.
    // Reserve the share for the *strongest* records from the closing phase
    // rather than the last ones in it. Taking the last ones fills the reserved
    // slots with the outro -- an end card and a sign-off -- and leaves out the
    // moment a few minutes earlier where the thing actually concluded.
    // Distinct moments only: one moment recorded four ways would consume the
    // whole share on its own.
    const phase = closingPhase(durationSecs);
    const closingCandidates = phase
      ? // The index's own reconciled account of a moment states what was on
        // screen; a transcript line from the same moment is people talking
        // over it. A conclusion is read off the former.
        reconciledFirst(
          assessment.corroborating.filter(
            (hit) =>
              hit.evidence.timeRange.startSecs <= phase.endSecs &&
              hit.evidence.timeRange.endSecs >= phase.startSecs &&
              !spansWholeSource(hit, durationSecs),
          ),
        )
      : [];
    const latestMoments: VideoKnowledgeSearchHit[] = [];
    // `corroborating` preserves retrieval's ranking, so taking these in order
    // is taking the best-ranked closing records.
    for (const hit of closingCandidates) {
      if (latestMoments.length >= Math.max(1, Math.floor(limit / 3))) break;
      if (
        latestMoments.some(
          (kept) =>
            Math.abs(kept.evidence.timeRange.startSecs - hit.evidence.timeRange.startSecs) < 15,
        )
      )
        continue;
      latestMoments.push(hit);
    }
    const latest = chronological(latestMoments);
    // One whole-source summary is orientation; four are four ways of saying
    // the same thing, and they were taking a third of the slots.
    let summaries = 0;
    // A moment that was watched several times, or read by several operators,
    // is recorded many ways. Two of them corroborate each other; seven of them
    // are one moment eating the whole trail, and the chronology stops being a
    // chronology.
    const perMoment = new Map<number, number>();
    const trail = mergeHits(
      // Whatever actually settled the claim leads, but only the records that
      // recount a moment -- the raw signal alongside them corroborates and is
      // plentiful enough to crowd the trail out on its own.
      assessment.established.filter(isAccountOfMoment),
      latest,
      reconciledFirst(assessment.corroborating),
      reconciledFirst(settled),
    ).filter((hit) => {
      if (spansWholeSource(hit, durationSecs)) return ++summaries <= 1;
      const moment = Math.floor(hit.evidence.timeRange.startSecs / 15);
      const seen = (perMoment.get(moment) ?? 0) + 1;
      perMoment.set(moment, seen);
      return seen <= 2;
    });
    return chronological(trail.slice(0, limit));
  }
  // A question that contrasts two things is not answered by the moment that
  // settled it: each side needs its own evidence, and they are rarely in the
  // same moment. Carry the settling evidence plus a spread of the rest.
  if (plan.requiresBothRanges && settled.length < limit) {
    return chronological(
      mergeHits(settled, evenlySpaced(chronological(hits), limit - settled.length)),
    ).slice(0, limit);
  }
  return reconciledFirst(settled).slice(0, limit);
}

function isIdentityAnchor(hit: VideoKnowledgeSearchHit) {
  const payload = hit.evidence.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const subject = (payload as { subject?: unknown }).subject;
    if (typeof subject === 'string' && subject.trim() && subject !== 'on-screen-text') return true;
  }
  return /(?:Reconciled|Indexed) participant:\s*[^—\n]{2,120}/i.test(evidenceText(payload));
}

function exhaustiveContinuation(
  hits: VideoKnowledgeSearchHit[],
  assessment: EvidenceAssessment,
  input: QueryVideoEvidenceInput,
) {
  const ordered = chronological(assessment.needsBreadth ? assessment.established : hits);
  const cursor = Math.min(Math.max(0, input.cursor ?? 0), ordered.length);
  const pageSize = Math.min(input.limit ?? 36, 48);
  const nextCursor = cursor + Math.min(pageSize, Math.max(0, ordered.length - cursor));
  const hasMore = nextCursor < ordered.length;
  return {
    exhaustive: true,
    totalItems: ordered.length,
    returnedItems: nextCursor - cursor,
    cursor,
    hasMore,
    ...(hasMore ? { nextCursor } : {}),
    rule: hasMore
      ? 'This is one chronological page, not the complete account. Call queryVideoEvidence again with exhaustive=true and cursor=nextCursor before finalizing the answer.'
      : 'Every chronological item in the active index has now been returned across the pages.',
  };
}

/**
 * Put evidence that reconciles other evidence ahead of the evidence it
 * reconciles. Readings of the same moment disagree, and the index resolves
 * those disagreements by checking each one against the whole timeline. Once
 * it has, the losing reading is still in the index and can still be
 * retrieved; leading with the resolution keeps an answer from being written
 * from a reading the index already set aside.
 */
function reconciledFirst(hits: VideoKnowledgeSearchHit[]) {
  const reconciled = (hit: VideoKnowledgeSearchHit) =>
    hit.evidence.source?.provider === 'video-intelligence-index';
  return [...hits.filter(reconciled), ...hits.filter((hit) => !reconciled(hit))];
}

/**
 * A claim of this shape is settled by reading across records rather than by
 * finding one that states it: a conclusion follows a trail of states, a count
 * accumulates, a comparison needs both sides.
 */
function isCrossEvidenceClaim(plan: VideoPlan) {
  return plan.kinds.some((kind) =>
    ['outcome', 'state-change', 'comparison', 'counting', 'computation'].includes(kind),
  );
}

/** Enough separate moments to read a trail rather than one lucky record. */
const CORROBORATION_FLOOR = 2;

/**
 * A "who" answer needs more than a positional descriptor such as "the right
 * side". The reconciled participant record is the index's identity anchor;
 * require that anchored name to also occur in the local answer trail. This is
 * language-agnostic because both strings come from the same source index.
 */
function trailHasRequiredIdentity(
  hits: VideoKnowledgeSearchHit[],
  trail: VideoKnowledgeSearchHit[],
  plan: VideoPlan,
) {
  if (!plan.requiresIdentityContext) return true;
  const trailText = trail
    .map((hit) => evidenceText(hit.evidence.payload))
    .join('\n')
    .toLocaleLowerCase();
  return (
    identityAnchorNames(hits).some((name) => trailText.includes(name)) ||
    trailHasStableSourceLabels(trail)
  );
}

/**
 * A repeated source label can identify a side or subject even when it is not a
 * person's name. This establishes the answer at that label's granularity; it
 * never licenses converting a position or label into an unshown personal name.
 */
function trailHasStableSourceLabels(trail: VideoKnowledgeSearchHit[]) {
  const labelSets = chronological(trail)
    .filter(
      (hit) =>
        hit.evidence.modality === 'computed' &&
        hit.evidence.source?.provider === 'video-intelligence-index' &&
        /^(?:Reconciled|Indexed)\s+state:/i.test(evidenceText(hit.evidence.payload).trim()),
    )
    .map((hit) => {
      const account = evidenceText(hit.evidence.payload).replace(
        /^(?:Reconciled|Indexed)\s+state:\s*/i,
        '',
      );
      // A reconciled multi-subject state serializes its independently bound
      // entries as separate clauses. Free prose such as "the left label..."
      // is still a locator and must not become an identity binding.
      if (!/[,;،؛]/u.test(account)) return new Set<string>();
      return new Set(
        (account.match(/[\p{Letter}\p{Mark}]+/gu) ?? [])
          .map((token) => token.normalize('NFKC').toLocaleLowerCase())
          .filter((token) => token.length >= 4),
      );
    })
    .filter((labels) => labels.size > 0);
  if (labelSets.length < 2) return false;
  return labelSets.some((labels, index) =>
    labelSets.slice(index + 1).some((other) => [...labels].some((label) => other.has(label))),
  );
}

function identityAnchorNames(hits: VideoKnowledgeSearchHit[]) {
  return hits.flatMap((hit) => {
    const text = evidenceText(hit.evidence.payload);
    return [
      ...text.matchAll(/(?:Reconciled|Indexed) participant:\s*([^—\n]{1,120})/gi),
      ...text.matchAll(/^Present:\s*([^—\n]{1,120})/gim),
    ]
      .map((match) => match[1]?.trim().toLocaleLowerCase())
      .filter((name): name is string => Boolean(name));
  });
}

function answeringRule(
  assessment: EvidenceAssessment,
  plan: VideoPlan,
  analysisUnavailable?: string,
) {
  const hasTrail = assessment.corroborating.length >= CORROBORATION_FLOOR;
  if (
    plan.requiresIdentityContext === true &&
    !plan.subjectName &&
    plan.kinds.includes('person-attribute') &&
    assessment.established.length > 0
  ) {
    return 'The evidence distinguishes one or more visible subjects by source-supported attributes, but a personal name is not automatically established by appearance. Give every supported distinction (using an on-screen label, position, role, or other source-supported visual descriptor when needed), and separately say which personal names could not be grounded. Do not discard the established attributes merely because the names are unresolved. Describe only the people and attributes the returned evidence actually distinguishes; do not imply a complete roster when the source does not establish one.';
  }
  if (assessment.establishedByTrail) {
    return 'The answer is established by multiple timestamped observations read together. Synthesize their chronological trail directly, preserve the identifying details and supporting times, and do not describe it as unconfirmed merely because no single observation states the whole conclusion. Answer at the source label or role granularity it establishes; never replace a side or role label with a personal name unless the evidence explicitly binds them.';
  }
  if (!assessment.sufficient && plan.requiresIdentityContext) {
    return analysisUnavailable
      ? 'The recorded states establish part of the result, but the closer source check could not complete and the evidence does not bind that result to the requested identity. Give the supported state or result with its timestamps, name the missing identity link, and do not infer a person from a side, label, or nearby name.'
      : 'The returned states establish part of the result but do not bind it to the requested identity. Give only the supported part and do not infer a person from a side, label, or nearby name.';
  }
  if (analysisUnavailable && !assessment.sufficient) {
    return hasTrail
      ? 'A closer look at the source could not run just now, so these are its recorded observations. Read them in time order and give the answer they lead to, with the timestamps it rests on and how confident you are; say once that this is what the recording showed rather than something re-checked. Do not say the source does not show this -- if the trail settles only part of the question, give that part and name what is missing.'
      : 'These are recorded observations of the source, but a closer look at the moments they point to could not run just now. Answer from them, and say once that this is what the recording showed rather than something re-checked.';
  }
  if (!assessment.sufficient && isCrossEvidenceClaim(plan) && hasTrail) {
    // The claim was not settled by any single record, which is the normal case
    // for this shape of question -- not a sign the source is silent. Declining
    // here is what turned an indexed, answerable recording into "I could not
    // confirm that", so the instruction is to reason across the trail and be
    // explicit about how far it goes.
    return 'No single observation states this outright, which is expected for a claim of this shape. Read across the returned observations in time order and give the answer they lead to, with the timestamps it rests on and how confident you are. Do not say the source does not show this -- say what the observations establish and where they stop short.';
  }
  if (!assessment.sufficient) {
    return 'The returned evidence does not settle this. Say which part is established and which part the source did not show, rather than inferring the rest.';
  }
  if (assessment.needsBreadth) {
    return plan.kinds.includes('state-change')
      ? 'These are timestamped source observations selected across the video. Give the account in their order, keep their timestamps for specific claims, and say where the source is silent rather than filling the gap.'
      : 'The evidence is distributed across the source. Synthesize the requested complete list or overview, deduplicate repeated items, preserve timestamps for specific claims, and state any explicit coverage limitation without exposing the evidence-gathering process.';
  }
  return 'Answer only from the returned source evidence.';
}

function chronological(hits: VideoKnowledgeSearchHit[]) {
  return [...hits].sort(
    (left, right) =>
      left.evidence.timeRange.startSecs - right.evidence.timeRange.startSecs ||
      left.evidence.timeRange.endSecs - right.evidence.timeRange.endSecs,
  );
}

function isInspectionFailure(value: unknown): value is { success: false; error: string } {
  if (!value || typeof value !== 'object') return false;
  const result = value as { success?: unknown; error?: unknown };
  return result.success === false && typeof result.error === 'string' && result.error.length > 0;
}

function isServiceBusy(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  return (value as { serviceBusy?: unknown }).serviceBusy === true;
}

function citationSurface(
  asset: Awaited<ReturnType<MediaEvidence['getAsset']>> & {},
  context: AgentToolExecutionContext,
  evidence: Array<{ modality: string; timeRange: TimeRange }>,
  supportingClip: TimeRange,
) {
  const sourceUrl = `/api/media/${encodeURIComponent(asset!.id)}${
    context.projectId ? `?projectId=${encodeURIComponent(context.projectId)}` : ''
  }`;
  return {
    kind: 'citations' as const,
    title: asset!.fileName ?? 'Video',
    fileName: asset!.fileName ?? 'Video',
    mediaType: asset!.type === 'audio' ? ('audio' as const) : ('video' as const),
    mediaUrl: sourceUrl,
    sourceUrl: asset!.originalUrl || sourceUrl,
    primaryTimestampSecs: supportingClip.startSecs,
    primaryEndSecs: supportingClip.endSecs,
    // Keep citations inspectable without surfacing raw transcription or
    // frame-extraction text in the conversation.
    items: evidence.map((item) => ({
      label: evidenceLabel(item.modality),
      timestampSecs: item.timeRange.startSecs,
      seekUrl: `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}t=${Math.floor(
        item.timeRange.startSecs,
      )}`,
    })),
  };
}

function evidenceLabel(modality: string) {
  if (modality === 'transcript') return 'Speech';
  if (modality === 'ocr') return 'On-screen text';
  if (modality === 'visual') return 'Video';
  if (modality === 'computed') return 'Timeline';
  return 'Source';
}

function createInspector(fetcher: typeof globalThis.fetch) {
  return async function inspectVideoKnowledge(
    input: InspectVideoKnowledgeInput,
    context: AgentToolExecutionContext,
  ) {
    if (!context.origin)
      return {
        success: false,
        error: 'Source inspection is unavailable without a request origin.',
      };
    if (!isValidInspectionInput(input))
      return { success: false, error: 'The requested inspection range is invalid.' };
    const url = new URL('/api/media/inspect', context.origin);
    if (context.projectId) url.searchParams.set('projectId', context.projectId);
    const chunks = splitRange(input.startSecs, input.endSecs, MAX_INSPECTION_CHUNK_SECS).reverse();
    let lastResult: Record<string, unknown> = { error: 'No inspectable range was provided.' };
    let lastOk = false;
    for (const chunk of chunks) {
      // The server has its own worker deadline, but a network socket or a
      // wedged control-plane request can otherwise outlive it indefinitely.
      // Keep a chat turn responsive even when that happens.
      const timeoutMs = Math.max(
        1,
        Math.floor(input.maxWaitMs ?? INTERACTIVE_INSPECTION_BUDGET_MS),
      );
      try {
        const response = await fetcher(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            mediaAssetId: input.mediaAssetId,
            startSecs: chunk.startSecs,
            endSecs: chunk.endSecs,
            purpose: input.purpose,
            queryId: `${input.queryId}:${chunk.startSecs}`.slice(0, 128),
            question: input.question ?? input.queryId,
            maxFrames: input.maxFrames,
            analysisMode: input.analysisMode,
            knownEntities: input.knownEntities,
            continuousSequence: input.continuousSequence,
            includeSpeech: input.includeSpeech,
            maxWaitMs: input.maxWaitMs,
            toolCallId: context.toolCallId,
          }),
        });
        lastResult = await response
          .json()
          .catch(() => ({ error: 'Inspection returned an invalid response.' }));
        lastOk = response.ok;
        if (lastOk && Array.isArray(lastResult.evidence) && lastResult.evidence.length > 0) break;
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
        return {
          success: false,
          error: timedOut
            ? 'Video analysis did not finish within the interactive response budget.'
            : `Video analysis could not be reached: ${
                error instanceof Error ? error.message : 'unknown error'
              }`,
        };
      }
    }
    return lastOk ? { success: true, ...lastResult } : { success: false, ...lastResult };
  };
}

function evenlySpaced<T>(items: T[], limit: number): T[] {
  if (limit <= 0) return [];
  if (items.length <= limit) return items;
  if (limit === 1) return [items[0]];
  return Array.from(
    { length: limit },
    (_, index) => items[Math.round((index * (items.length - 1)) / (limit - 1))],
  );
}

function mergeHits(...groups: VideoKnowledgeSearchHit[][]) {
  const seen = new Set<string>();
  return groups.flat().filter((hit) => {
    if (seen.has(hit.evidence.id)) return false;
    seen.add(hit.evidence.id);
    return true;
  });
}

function uniqueRanges(ranges: Array<TimeRange | undefined>) {
  const unique: TimeRange[] = [];
  for (const range of ranges) {
    if (!range || range.endSecs <= range.startSecs) continue;
    if (unique.some((existing) => Math.abs(existing.startSecs - range.startSecs) < 10)) continue;
    unique.push(range);
  }
  return unique;
}

function inspectionPurpose(kinds: VideoPlan['kinds']): InspectionPurpose {
  // OCR stays on for questions that turn on an exact visible value, so the
  // reader has an independent reading of the text rather than being its only
  // interpreter.
  if (kinds.includes('exact-ocr') || kinds.includes('state-change')) {
    return 'high-res-ocr';
  }
  if (kinds.includes('counting')) return 'count';
  if (kinds.includes('comparison')) return 'compare';
  return 'verify-visual';
}

function isDirectVerdict(hit: VideoKnowledgeSearchHit, question: string, plan?: VideoPlan) {
  const payload = evidenceText(hit.evidence.payload);
  const questionMatch = payload.match(/Claim question:\s*([^\n"]+)/i);
  const requestedRanges = directiveTimeRange(plan?.investigation, undefined);
  const isInRequestedRange =
    requestedRanges.length === 0 ||
    requestedRanges.some(
      (range) =>
        hit.evidence.timeRange.startSecs < range.endSecs &&
        hit.evidence.timeRange.endSecs > range.startSecs,
    );
  return (
    payload.includes('Claim verdict: direct') &&
    questionMatch !== null &&
    isInRequestedRange &&
    // A bounded reader receives the user's question plus a concise inspection
    // instruction. Its direct claim remains the same question, even though
    // that extra guidance lowers token overlap.
    // A direct claim is reusable only for the same question (or a very close
    // rewording). A looser threshold can reuse an opening-scene description
    // for a different attribute question simply because both mention the
    // same timestamp. That suppresses the bounded fallback precisely when
    // fresh visual analysis is required.
    questionSimilarity(questionMatch[1], question) >= 0.6
  );
}

function answerEstablishedHits(
  hits: VideoKnowledgeSearchHit[],
  question: string,
  plan: VideoPlan,
  watched: WatchedRanges = { ranges: [], since: '' },
) {
  const verified = hits.filter((hit) => isDirectVerdict(hit, question, plan));
  if (verified.length > 0) return verified;
  // Evidence recorded *by* watching a range for this question answers it by
  // provenance: that is the whole reason the range was watched. Matching on
  // the reader echoing the question back is not a sound substitute -- readers
  // reword it, and a rewording is not a failure to answer. This is narrower
  // than "evidence inside the range": evidence that was already in the index
  // before the look began was not gathered for this question, so it is held
  // to the ordinary bar. Anything that read the range and said it does not
  // settle the claim is excluded.
  const fromWatching = watched.since
    ? hits.filter(
        (hit) =>
          hit.evidence.createdAt >= watched.since &&
          watched.ranges.some(
            (range) =>
              hit.evidence.timeRange.startSecs < range.endSecs &&
              hit.evidence.timeRange.endSecs > range.startSecs,
          ) &&
          ['visual', 'transcript', 'ocr'].includes(hit.evidence.modality) &&
          !hasNegativeVerdictForQuestion(hit, question),
      )
    : [];
  // Watching a moment produces two kinds of record: an account of what the
  // moment showed, and raw signal from it -- a single word read off the
  // screen, a note that some text was present. The account answers the
  // question; the raw signal only corroborates it, and there is far more of
  // it. Ordered the other way, an answer gets written from stray words.
  const accounts = fromWatching.filter(isAccountOfMoment);
  if (accounts.length > 0)
    return [...accounts, ...fromWatching.filter((hit) => !isAccountOfMoment(hit))];
  // Direct source observations already materialized during indexing should
  // answer straightforward speech, visible-text, and visual-fact questions
  // immediately. Aggregates, comparisons, identity attribution, and
  // conclusions stay stricter because they require reasoning across
  // observations rather than reading one source-backed fact.
  const requiresCrossEvidenceReasoning = plan.kinds.some((kind) =>
    [
      'outcome',
      'state-change',
      'comparison',
      'counting',
      'computation',
      'person-attribute',
    ].includes(kind),
  );
  if (requiresCrossEvidenceReasoning) return [];
  return hits.filter((hit) => isIndexedDirectObservation(hit, question, plan));
}

/**
 * Whether a record recounts what a moment showed, rather than carrying raw
 * signal from it. A reader's description of a clip and a spoken sentence both
 * recount; a single word lifted off the screen, or a note that some text was
 * present, do not -- they are corroboration, and there are many more of them.
 */
function isAccountOfMoment(hit: VideoKnowledgeSearchHit) {
  // 'computed' covers the index's own reconciled account, which recounts a
  // moment after cross-checking every reading of it against the timeline.
  if (!['visual', 'transcript', 'computed'].includes(hit.evidence.modality)) return false;
  const payload = hit.evidence.payload;
  const text =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { text?: unknown }).text
      : payload;
  // A typed subject/property/value locates a display; it does not describe it.
  return typeof text === 'string' && text.trim().length > 0;
}

function isIndexedDirectObservation(
  hit: VideoKnowledgeSearchHit,
  question: string,
  plan?: VideoPlan,
) {
  const text = evidenceText(hit.evidence.payload);
  // The durable aggregate is normally navigation context, not a direct fact.
  // Its visibility ledger is the exception: it is emitted from a typed visual
  // observation protocol and is precisely the merged record required for an
  // appearance/timing answer. Keeping this exception protocol-bound prevents
  // an arbitrary computed summary from bypassing source corroboration.
  const reconciledVisibility =
    hit.evidence.modality === 'computed' &&
    /^Reconciled visible subject:\s*[^\n]+\nIdentity basis:\s*(?:source-named|source-described|unresolved)\nObserved appearances:\s*\d/im.test(
      text,
    );
  if (!['transcript', 'ocr', 'visual'].includes(hit.evidence.modality) && !reconciledVisibility)
    return false;
  // Raw OCR/detection payloads locate a moment but do not recount what was
  // observed there. A broad recurring overlay must never become evidence that
  // a person, animal, event, or other subject was present at that timestamp.
  if (!reconciledVisibility && !isAccountOfMoment(hit)) return false;
  const confidence =
    typeof hit.evidence.confidence === 'object' && hit.evidence.confidence !== null
      ? Number((hit.evidence.confidence as { score?: unknown }).score)
      : 0;
  if (!Number.isFinite(confidence) || confidence < 0.45) return false;
  if (hasNegativeVerdictForQuestion(hit, question)) return false;
  // A previous direct-verdict record is reusable only through
  // `isDirectVerdict` above, which checks its original question. Letting its
  // generic semantic score through here would silently reuse a nearby answer
  // for a different question.
  if (/Claim question:\s*/i.test(text)) return false;
  const requestedRanges = directiveTimeRange(plan?.investigation, undefined);
  const establishedRanges = reconciledVisibility ? observedAppearanceRanges(text) : [];
  if (
    requestedRanges.length > 0 &&
    !(establishedRanges.length > 0 ? establishedRanges : [hit.evidence.timeRange]).some(
      (candidate) =>
        requestedRanges.some(
          (range) => candidate.startSecs < range.endSecs && candidate.endSecs > range.startSecs,
        ),
    )
  ) {
    return false;
  }
  // Retrieval can return a high-quality neighbouring scene even when it does
  // not contain the fact the user asked for. Treat an indexed observation as
  // answer-level evidence only when it shares a meaningful query term or the
  // hybrid retriever explicitly marked it as a semantic match. Otherwise the
  // bounded live reader gets the opportunity to inspect the candidate range.
  const semanticMatch =
    Number((hit as { components?: { semantic?: unknown } }).components?.semantic ?? 0) > 0;
  // A human-selected source range is itself a strict relevance constraint.
  // Within it, a full visual account can answer even when the question and
  // account use different languages or different descriptions.  Raw
  // locators remain excluded above, and broad evidence still requires a
  // lexical or semantic match.
  const directlyRequestedMoment =
    requestedRanges.length > 0 &&
    (establishedRanges.length > 0 ? establishedRanges : [hit.evidence.timeRange]).some(
      (candidate) =>
        requestedRanges.some(
          (range) => candidate.startSecs < range.endSecs && candidate.endSecs > range.startSecs,
        ),
    );
  if (semanticMatch || directlyRequestedMoment) return true;
  const questionTerms = new Set(
    question
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}_-]*/gu)
      ?.filter((term) => term.length > 3) ?? [],
  );
  if (questionTerms.size === 0) return false;
  const sourceTerms = new Set(
    text
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}_-]*/gu) ?? [],
  );
  return [...questionTerms].some((term) => sourceTerms.has(term));
}

/** Read only the visibility-ledger protocol's explicit intervals. */
function observedAppearanceRanges(text: string): TimeRange[] {
  const appearances = text.match(/^Observed appearances:\s*([^\n]+)/im)?.[1];
  if (!appearances) return [];
  const milliseconds = [...appearances.matchAll(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)ms\b/gu)].map(
    (match) => ({ startSecs: Number(match[1]) / 1_000, endSecs: Number(match[2]) / 1_000 }),
  );
  if (milliseconds.length > 0) return milliseconds;
  return [...appearances.matchAll(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)s\b/gu)].map((match) => ({
    startSecs: Number(match[1]),
    endSecs: Number(match[2]),
  }));
}

function hasNegativeVerdictForQuestion(hit: VideoKnowledgeSearchHit, question: string) {
  const payload = evidenceText(hit.evidence.payload);
  const questionMatch = payload.match(/Claim question:\s*([^\n"]+)/i);
  return Boolean(
    /Claim verdict:\s*(?:partial|not-established)/i.test(payload) &&
    questionMatch !== null &&
    questionSimilarity(questionMatch[1], question) >= 0.35,
  );
}

function hasNegativeVerdict(hit: VideoKnowledgeSearchHit) {
  return /Claim verdict:\s*not-established/i.test(evidenceText(hit.evidence.payload));
}

function evidenceText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(evidenceText).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(evidenceText).join('\n');
  return '';
}

/**
 * Token overlap that lets a provider's faithful paraphrase reuse a verified
 * source pass, without letting two unrelated questions look alike.
 *
 * Terms are weighted by length. Counting them equally makes any two short
 * questions in the same language look similar, because the words they share
 * are the ones every question has -- "what", "was", "the" -- and those are
 * a large fraction of a short question's tokens. That is enough to make a
 * verified answer to one question get reused for a different one. Longer
 * terms carry the subject matter in every script, so weighting by length
 * keeps two questions apart when all they share is grammar, while still
 * matching a genuine rewording of the same one.
 */
function questionSimilarity(left: string, right: string) {
  const terms = (value: string) =>
    new Set(
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .match(/[\p{Letter}\p{Number}]+/gu) ?? [],
    );
  const weigh = (values: Set<string>) =>
    [...values].reduce((total, term) => total + term.length, 0);
  const leftTerms = terms(left);
  const rightTerms = terms(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  const shared = new Set([...leftTerms].filter((term) => rightTerms.has(term)));
  return weigh(shared) / Math.max(weigh(leftTerms), weigh(rightTerms));
}

function toEvidence(hit: VideoKnowledgeSearchHit, _plan?: VideoPlan) {
  return {
    id: hit.evidence.id,
    modality: hit.evidence.modality,
    timeRange: hit.evidence.timeRange,
    payload: hit.evidence.payload,
    confidence: hit.evidence.confidence,
  };
}

function stableQueryId(query: string) {
  let hash = 2166136261;
  for (const char of query.normalize('NFKC'))
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return `evidence-${(hash >>> 0).toString(36)}`;
}

/**
 * Source resolution can append a selected file's title to the user's request.
 * Remove only a long trailing run made entirely from that title, leaving names
 * and other source-specific terms elsewhere in the actual question intact.
 */
function focusQuestion(question: string, fileName?: string) {
  const normalized = question.normalize('NFKC').trim();
  if (!fileName) return normalized;
  const comparableTerm = (term: string) =>
    term
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\p{Mark}/gu, '');
  const titleTerms = new Set(
    fileName
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}_-]*/gu)
      ?.map(comparableTerm) ?? [],
  );
  const tokens = [
    ...normalized.matchAll(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}_-]*/gu),
  ];
  let suffixStart = normalized.length;
  let suffixTerms = 0;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!titleTerms.has(comparableTerm(token[0]))) break;
    suffixStart = token.index ?? suffixStart;
    suffixTerms += 1;
  }
  if (suffixTerms < 3) return normalized;
  const focused = normalized
    .slice(0, suffixStart)
    .replace(/[\s|:;,.،؛\-–—]+$/u, '')
    .trim();
  return focused || normalized;
}

function isValidQueryInput(input: QueryVideoEvidenceInput): boolean {
  return (
    typeof input.mediaAssetId === 'string' &&
    input.mediaAssetId.length > 0 &&
    typeof input.query === 'string' &&
    input.query.trim().length > 0
  );
}

function validInvestigation(value: unknown): value is VideoInvestigationDirective {
  if (!value || typeof value !== 'object') return false;
  const directive = value as Partial<VideoInvestigationDirective>;
  const timeRange = directive.timeRange;
  return (
    ['focused', 'temporal', 'source'].includes(String(directive.scope)) &&
    ['answer', 'compare', 'trace', 'enumerate', 'synthesize'].includes(String(directive.goal)) &&
    (directive.recordSet === undefined ||
      ['all', 'source-authored', 'source-questions', 'observed'].includes(directive.recordSet)) &&
    (timeRange === undefined ||
      (Number.isFinite(timeRange.startSecs) &&
        Number.isFinite(timeRange.endSecs) &&
        timeRange.startSecs >= 0 &&
        timeRange.endSecs >= timeRange.startSecs))
  );
}

function isValidInspectionInput(input: InspectVideoKnowledgeInput): boolean {
  return (
    typeof input.mediaAssetId === 'string' &&
    input.mediaAssetId.length > 0 &&
    Number.isFinite(input.startSecs) &&
    Number.isFinite(input.endSecs) &&
    input.startSecs >= 0 &&
    input.endSecs > input.startSecs &&
    ['verify-visual', 'high-res-ocr', 'compare', 'count', 'track', 'code'].includes(
      input.purpose,
    ) &&
    typeof input.queryId === 'string' &&
    input.queryId.length > 0
  );
}

function splitRange(startSecs: number, endSecs: number, maxChunkSecs: number) {
  const chunks: TimeRange[] = [];
  for (let cursor = startSecs; cursor < endSecs; cursor += maxChunkSecs)
    chunks.push({ startSecs: cursor, endSecs: Math.min(endSecs, cursor + maxChunkSecs) });
  return chunks;
}
