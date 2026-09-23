import {
  generateText,
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  type UIMessage,
} from 'ai';
import { readConfig } from '@larkup/core/config-store';
import { getModelsByType } from '@larkup/core/models-cache';
import {
  toChatDescriptor,
  getDefaultChatModel,
  normalizeNativeChatModelId,
} from '@larkup/core/chat-models/registry';
import { listTabularDatasets } from '@larkup/core/tabular-store';
import { openMcpTools } from '@larkup/core/mcp-store';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { CustomModelConfig } from '@larkup/core/types';
import type { VideoInvestigationDirective } from '@larkup/core/video-knowledge/query-planner';
import { getChatTools } from './tools';
import { gatewayProviderOptions } from '@/lib/chat/gateway-fallbacks';
import { retrievalToolsForStep } from '@/lib/chat/retrieval-routing';
import { collectExhaustiveVideoEvidencePages } from '@/lib/chat/video-rag-routing';
import {
  extractConversationEvidence,
  contextualizeKnowledgeFollowUpQuery,
  formatConversationEvidence,
  isImagePreviewFollowUp,
  isTabularFollowUp,
  continuesRecentMediaTopic,
} from '@/lib/chat/conversation-memory';
import { PERSONALIZED_RESPONSE_STYLE } from '@/lib/chat/response-style';
import {
  compactToolContextForModel,
  collectAnswerLevelMediaStatements,
  collectObservedSubjectLedger,
  containsAnswerLevelMediaEvidence,
  collectQuestionMatchedDirectClaims,
  recoverEmptyUIMessageStream,
  formatDirectObservationAnswer,
  formatExhaustiveMediaAnswer,
  formatLocatedObservedSubjectAnswer,
  formatObservedAppearanceAnswer,
  mediaClaimNeedsCorroboration,
  withFinalAnswerNudge,
} from '@/lib/chat/tool-context';
import { requestsVisualization } from '@/lib/chat/tabular-visualization';
import {
  isLikelyTabularQuestion,
  requiresTabularSandbox,
  tabularToolsForStep,
} from '@/lib/chat/tabular-routing';
import {
  hasRetrievedImageEvidence,
  hasRetrievedPdfEvidence,
  hasNumberedDocumentReference,
  findRetrievedPdfSource,
  latestNumberedDocumentReferenceText,
  preferredPdfPagesForInspection,
  requiresPdfVisualAnalysis,
  requestsImagePresentation,
  shouldInspectRetrievedImage,
} from '@/lib/chat/visual-routing';
import { executableTools } from '@/lib/chat/tool-registry';
import { normalizeIncomingMessages } from '@/lib/chat/message-input';
import { explicitMediaEvidenceAssetId } from '@/lib/chat/media-retrieval-routing';
import { authorizeEnterpriseAiRequest, trackEnterpriseAiUsage } from '@/lib/enterprise-client';

// A local CPU inspection can legitimately outlive the default server route
// budget. It is still bounded by the evidence tool's narrow time range; this
// merely lets the chat request receive the validated result instead of being
// cut off mid-analysis.
export const maxDuration = 480;

/**
 * Creates an AI SDK language model instance based on the provider and model ID.
 */
function createChatModel(
  provider: string,
  modelId: string,
  apiKey?: string,
  customChatModels?: CustomModelConfig[],
) {
  if (modelId.startsWith('custom:')) {
    const customName = modelId.slice('custom:'.length);
    const custom = (customChatModels ?? []).find((m) => m.modelName === customName);
    if (custom) {
      const customProvider = createOpenAICompatible({
        name: 'custom_chat_provider',
        baseURL: custom.baseUrl,
        apiKey: custom.apiKey || apiKey || undefined,
      });
      return customProvider(custom.modelName);
    }
  }

  const modelName = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;

  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelName);
    case 'cohere':
      return createCohere({ apiKey })(modelName);
    case 'mistral':
      return createMistral({ apiKey })(modelName);
    case 'deepseek':
      return createDeepSeek({ apiKey })(modelName);
    case 'anthropic':
      return createAnthropic({ apiKey })(modelName);
    case 'openai':
      return createOpenAI({ apiKey })(modelName);
    case 'vercel_ai_gateway':
      return createGateway({ apiKey })(modelId);
    default:
      throw new Error(`Unsupported chat provider "${provider}".`);
  }
}

const CHAT_POLICY = `
Answer only from the user's provided material.

For each substantive question, get fresh evidence: use queryTabularData for CSV, Excel, or JSON facts; otherwise use searchKnowledgeBase. A prior answer is context for resolving references, never a substitute for current source evidence. Use one focused query first. Use code analysis only when the available data tool cannot answer the calculation. For a join or statistical analysis across files or worksheets, use executeAnalysis with every needed datasetId in datasetIds; read datasets.json to identify their mounted CSV files and never try to emulate the join with a cross-dataset table filter.

Do not repeat an evidence tool in the same response. After evidence is returned, answer directly or use one appropriate refinement when the evidence action requests it.

Use only returned evidence. Do not guess beyond it, but do not turn an incomplete verification flag into a refusal when the source contains relevant instructions, statements, or a useful trail. Give the most specific answer the available source material establishes and clearly limit only the unsupported portion. Do not recommend a search engine, public website, or outside source unless the user explicitly asks you to search the web. For video/audio, name the relevant timestamp range when one was returned. Speak as someone who watched the material: never expose retrieval, transcripts, frames, visual observations, models, tools, or analysis steps unless the user explicitly asks how you determined the answer.

${PERSONALIZED_RESPONSE_STYLE}

Keep the answer brief and direct: give the answer first, then only the essential context. Do not repeat tool output, dump rows, or add a table unless the user asks to see data. Use a short list only when it improves clarity.

When the user asks for every item and the media evidence marks its continuation as exhaustive, include every returned item in chronological order. In that case completeness overrides brevity; deduplicate wording but do not summarize items away.

If the user asks for a chart, graph, or visual distribution, ALWAYS use the \`generateVisualization\` tool. Never attempt to draw ASCII charts, output Markdown tables, JSON, or tool-call syntax as a substitute for a chart. Its \`xAxisKey\` and each \`series[].dataKey\` must exactly match the fields in the supplied \`data\` rows; never use placeholder names such as EMPTY, null, or undefined.

When search results identify a PDF source without indexed visuals, use inspectPdfPages before answering. It reads and ranks pages locally. Then use analyzePdfPages for visual claims or presentMedia for an explicit page preview.

For media questions, searchKnowledgeBase first, then use an installed evidence-query action with the returned mediaAssetId. Use its active evidence and include supporting time ranges. Inspect or present media only when necessary or explicitly requested.

For a media claim that requires a terminal state, comparison, aggregate, count, or change over time, ordinary retrieval is not enough. Follow claimVerification.rule from the installed evidence action -- it states what the gathered evidence supports for this particular question. Never promote a local observation into a broader conclusion without source coverage.

"Not directly established" means no single record states the answer outright. It does not mean the source is silent. When the evidence contains a trail that leads to the answer -- readings over time, a state and the change to it, two sides of a comparison -- read across it and give the answer, saying how confident you are and citing the moments it rests on. If a source provides procedures or instructions relevant to the question, state those procedures even when it cannot verify a broader conclusion. Reserve "the video does not show this" for when the evidence genuinely lacks any bearing on the question, and never use it to describe an answer you could have reasoned to.

For every video claim, distinguish a direct observation from an inference. Do not turn a reaction, mood, body language, or a summary into a factual conclusion without direct supporting evidence. If evidence is incomplete or conflicts, inspect the relevant source range and answer only what it establishes.

When a user explicitly corrects a prior answer about media, acknowledge the correction and use source evidence for later factual answers; never overwrite the source record with a conversational correction.
`;

function messageText(message: UIMessage | undefined): string {
  if (!message) return '';
  // `content` is retained only on legacy UI messages; current SDK messages
  // store text in `parts`.
  const legacyMessage = message as UIMessage & { content?: unknown };
  if (typeof legacyMessage.content === 'string') return legacyMessage.content;
  const parts = Array.isArray(message.parts)
    ? message.parts
    : Array.isArray(legacyMessage.content)
      ? legacyMessage.content
      : [];
  if (parts.length) {
    return parts
      .filter((part: any) => part.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join(' ');
  }
  return '';
}

function latestUserText(messages: UIMessage[]): string {
  return messageText([...messages].reverse().find((candidate) => candidate.role === 'user'));
}

/**
 * A terse follow-up such as "render it" often refers to a figure/table named
 * in the immediately preceding answer. Keep that human-readable reference in
 * the local PDF query, without replaying prior tool payloads into the model.
 */
function latestAssistantText(messages: UIMessage[]): string {
  return messageText(
    [...messages].reverse().find((candidate) => candidate.role === 'assistant'),
  ).slice(0, 4_000);
}

/**
 * A preview follow-up can refer to an object named by the user several turns
 * earlier, even if the intervening assistant answer had no usable text part.
 * Search only the preceding conversational text, never a tool payload.
 */
function precedingNumberedDocumentReference(messages: UIMessage[]): string | undefined {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex <= 0) return undefined;
  return latestNumberedDocumentReferenceText(
    messages.slice(0, latestUserIndex).map((message) => messageText(message)),
  );
}

/**
 * Drive the investigation from structured tool results, never from a list of
 * domain or language-specific phrases in the user's question.
 */
function mediaEvidenceFlow(
  messages: unknown[],
  recentMediaAssetIds: string[] = [],
  evidenceQueryToolNames: string[] = [],
) {
  const serialized = JSON.stringify(messages);
  return {
    hasMediaAsset: recentMediaAssetIds.length > 0 || /"mediaAssetId"\s*:/.test(serialized),
    hasCompletedEvidence: containsCompletedMediaEvidence(messages),
    evidenceQueries: evidenceQueryToolNames.reduce(
      (count, name) =>
        count + (serialized.match(new RegExp(`"${escapeRegExp(name)}"`, 'g')) ?? []).length,
      0,
    ),
  };
}

/**
 * Tool use is not equally reliable across all chat providers. The host runs
 * the first retrieval deterministically, but the result remains a normal
 * visible tool result and is the only source added to the answer model's
 * context. This is capability- and source-driven: it knows nothing about a
 * specific video, question type, language, person, or expected answer.
 */
function preloadedEvidenceContext(result: unknown, question: string): string {
  const compact = compactToolContextForModel([
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolName: 'searchKnowledgeBase', output: result }],
    },
  ]);
  const output = (compact[0] as any)?.content?.[0]?.output ?? result;
  const unverifiedMedia = findUnverifiedMediaEvidence(result);
  // A verification result controls how narrowly a claim may be phrased; it
  // must not erase the source excerpts that led to the result. Erasing those
  // excerpts made a source with useful procedures look empty and forced the
  // model into a generic refusal. Keep the bounded evidence available and
  // make the limitation explicit instead.
  const safeOutput = unverifiedMedia
    ? {
        evidence: output,
        mediaEvidenceStatus: {
          mediaAssetId: unverifiedMedia.mediaAssetId,
          claimVerification: unverifiedMedia.claimVerification,
          instruction:
            'The source has relevant material but the requested claim is not yet established as one direct observation. Answer from the source passages and any corroborating trail that are present. Do not invent missing details or present a broad conclusion as verified; do provide the concrete procedures, statements, or partial answer the source does establish.',
        },
      }
    : output;
  const serialized = typeof safeOutput === 'string' ? safeOutput : JSON.stringify(safeOutput);
  const contextBudget = containsExhaustiveEvidence(safeOutput) ? 120_000 : 24_000;
  const directClaims = collectQuestionMatchedDirectClaims(result, question);
  const directObservations = collectAnswerLevelMediaStatements(result);
  const observedSubjectLedger = collectObservedSubjectLedger(result);
  const hasEstablishedMediaEvidence = containsAnswerLevelMediaEvidence(result);
  const mediaAssetId = explicitMediaEvidenceAssetId(result);
  const hasCurrentKnowledgeHits =
    Boolean(result) &&
    typeof result === 'object' &&
    Array.isArray((result as { hits?: unknown }).hits) &&
    (result as { hits: unknown[] }).hits.length > 0;
  if (!hasCurrentKnowledgeHits && !mediaAssetId) {
    return '\n\nNO CURRENTLY ACCESSIBLE SOURCE EVIDENCE WAS FOUND FOR THIS TURN. Source access can change after a previous answer, so do not repeat or infer facts from prior assistant messages. Explain briefly that the current knowledge base does not contain an answer.';
  }
  if (
    mediaAssetId &&
    directClaims.length === 0 &&
    !hasEstablishedMediaEvidence &&
    !unverifiedMedia
  ) {
    return `\n\nA relevant media source was located (${mediaAssetId}), but no answer-level evidence has been returned yet. Use the installed evidence-query action for that media asset before answering. Do not say that the source has no answer and do not infer an outcome from this locator alone.`;
  }
  return `\n\nVERIFIED SOURCE EVIDENCE FOR THIS TURN:\n${
    directClaims.length > 0
      ? `DIRECTLY ESTABLISHED ANSWER TEXT (preserve its specific identifying details rather than weakening them):\n${directClaims.join(
          '\n',
        )}\n\n`
      : ''
  }${
    directObservations.length > 0
      ? `BINDING SOURCE OBSERVATIONS (state every explicit time, recurrence, identity basis, and uncertainty exactly as written):\n${directObservations
          .map((observation) => `- ${observation}`)
          .join(
            '\n',
          )}\n\nDo not turn discrete observations into continuous presence. Do not say that something happened only once, did not recur, or was absent elsewhere unless that absence is directly established by the observations. Do not replace a source-described or unresolved identity with a proper name.\n\n`
      : ''
  }${
    observedSubjectLedger.length > 0
      ? `BINDING VISIBILITY LEDGER (these are discrete frame-grounded observations across the source):\n${observedSubjectLedger
          .map((subject) => `- ${subject}`)
          .join(
            '\n',
          )}\n\nWhen the request connects an observed subject or event at one position to elsewhere in the source, use this ledger for the other observed appearances. Do not replace a source-described identity with a proper name. Do not say the subject appeared only once, did not recur, or was absent elsewhere unless the supplied evidence directly establishes that absence.\n\n`
      : ''
  }${serialized.slice(0, contextBudget)}\n\n${
    unverifiedMedia
      ? 'The verification status above limits certainty, not access to the source material. Give the most useful source-grounded answer that is supported.'
      : "Answer the user's question directly from this evidence."
  } Do not mention tools, retrieval, frames, transcripts, or analysis.`;
}

/**
 * Turn a natural-language question into the content-neutral directive owned by
 * the video evidence capability. The executor subsequently handles only this
 * typed plan, so no route-level vocabulary, language, or media-genre rules are
 * needed to interpret a time reference or a source-wide request.
 */
async function planVideoEvidenceQuery(input: {
  model: any;
  providerOptions: ReturnType<typeof gatewayProviderOptions>;
  question: string;
}): Promise<VideoInvestigationDirective | undefined> {
  try {
    const requestPlan = async (system: string, maxOutputTokens: number) => {
      const { text } = await generateText({
        model: input.model,
        maxRetries: 0,
        maxOutputTokens,
        temperature: 0,
        abortSignal: AbortSignal.timeout(12_000),
        providerOptions: input.providerOptions,
        system,
        prompt: input.question,
      });
      return parseVideoInvestigationDirective(text);
    };
    const planned = await requestPlan(
      'You are a media-query planner. Return exactly one JSON object and no prose. ' +
        'Interpret the user request in its own language without assuming a video genre. ' +
        'Use this exact shape: {"scope":"focused","goal":"answer","evidence":["visual"],"timeRange":{"startSecs":123,"endSecs":153},"timeRangeOrigin":"user-mentioned"}. Its fields are scope (focused, temporal, source), goal (answer, compare, trace, enumerate, synthesize), optional evidence (speech, visible-text, visual, computed), optional recordSet (all, source-authored, source-questions, observed), optional timeRange {startSecs,endSecs}, and optional timeRangeOrigin. ' +
        'A directive is invalid if the user refers to any source position, time, range, or approximate moment and you omit timeRange: resolve it to numeric seconds and set timeRangeOrigin to user-mentioned, even when the request also asks about other moments. Never emit timeRange or timeRangeOrigin when the user did not constrain a source position; a topic occurring near an opening, closing, or any other position is not a user constraint. When the request names a coarse source unit without a smaller boundary, cover that whole named unit rather than an arbitrary part of it. When the user asks how a visible subject or event at an explicit source position relates to appearances or recurrence elsewhere, use temporal plus trace, visual evidence, and recordSet observed while retaining that position. Use source plus synthesize with no timeRange whenever the answer must combine two or more source facts from unrestricted positions. Use source plus enumerate and recordSet source-questions for a complete inventory of source-authored questions and their answers. Use temporal for a relationship or development across moments; use focused only for one local moment or one self-contained fact. ' +
        'Do not answer the question or add fields.',
      220,
    );
    if (planned) return planned;
    // A compact recovery request is intentionally restricted to the protocol
    // choices. It rescues providers that emit conversational prose on their
    // first planning attempt without introducing source- or language-specific
    // routing rules in the host.
    return await requestPlan(
      'Return only JSON: {"scope":"focused|temporal|source","goal":"answer|compare|trace|enumerate|synthesize","recordSet":"all|source-authored|source-questions|observed"}. Select source/enumerate/source-questions for a complete question-and-answer inventory from a recording; select source/synthesize for an unrestricted explanation; select focused/answer for one local fact. Do not include a timeRange unless the user explicitly supplied a source position.',
      100,
    );
  } catch {
    // The evidence action has a source-wide fallback. A planner outage must
    // not turn an otherwise answerable source question into a chat error.
    return undefined;
  }
}

/**
 * Validate the only planner decision that can discard most of a recording.
 * This deliberately asks a separate, binary question: requesting timestamps
 * in an answer is not itself a request to inspect a particular timestamp.
 * Keeping this language-neutral gate independent prevents a rich planner from
 * turning an unrestricted explanation into an invented opening slice.
 */
async function userSpecifiedSourcePosition(input: {
  model: any;
  providerOptions: ReturnType<typeof gatewayProviderOptions>;
  question: string;
}): Promise<
  | {
      hasPosition: boolean;
      connectsBeyondPosition: boolean;
    }
  | undefined
> {
  try {
    const { text } = await generateText({
      model: input.model,
      maxRetries: 0,
      maxOutputTokens: 80,
      temperature: 0,
      abortSignal: AbortSignal.timeout(8_000),
      providerOptions: input.providerOptions,
      system:
        'Return exactly one JSON object and no prose: {"kind":"input-location"|"answer-timestamp"|"none","locator":string|null,"connectsBeyondPosition":boolean}. Use input-location only when the user explicitly constrains where in the provided source to look; locator must be the exact corresponding substring from the user request. Use answer-timestamp when the user asks for timestamps in the answer but does not specify where to look; locator is null. Use none when neither is present. Set connectsBeyondPosition true only when the request explicitly relates the thing at its named source position to another point or portion of the source, such as recurrence, reappearance, a later/earlier occurrence, change, or comparison; otherwise false. Example: "Explain a subject and include timestamps" => {"kind":"answer-timestamp","locator":null,"connectsBeyondPosition":false}. Example: "What happens at 14:00?" => {"kind":"input-location","locator":"14:00","connectsBeyondPosition":false}. Example: "Who is at 14:00 and where else do they appear?" => {"kind":"input-location","locator":"14:00","connectsBeyondPosition":true}. Example: "Give the full story from beginning to conclusion" => {"kind":"none","locator":null,"connectsBeyondPosition":false} unless the user asks specifically about the beginning or conclusion. Interpret every language without assuming a source genre.',
      prompt: input.question,
    });
    const serialized = text.match(/\{[\s\S]*\}/)?.[0];
    if (!serialized) return undefined;
    const parsed = JSON.parse(serialized) as {
      kind?: unknown;
      locator?: unknown;
      connectsBeyondPosition?: unknown;
    };
    const connectsBeyondPosition = parsed.connectsBeyondPosition === true;
    if (parsed.kind === 'answer-timestamp' || parsed.kind === 'none') {
      return { hasPosition: false, connectsBeyondPosition };
    }
    if (parsed.kind !== 'input-location' || typeof parsed.locator !== 'string') return undefined;
    // The quote need only occur in the user text. Its semantic role was
    // established by the structured classifier, which supports any language.
    return {
      hasPosition: input.question.normalize('NFKC').includes(parsed.locator.normalize('NFKC')),
      connectsBeyondPosition,
    };
  } catch {
    return undefined;
  }
}

function parseVideoInvestigationDirective(value: string): VideoInvestigationDirective | undefined {
  const candidate = value.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return undefined;
  try {
    const parsed = JSON.parse(candidate) as Partial<VideoInvestigationDirective>;
    // Some providers preserve the range but omit the two default fields or
    // serialize startSecs/endSecs as start/end. That is a schema-transport
    // variation, not a reason to discard a model-resolved source position.
    const scope = ['focused', 'temporal', 'source'].includes(String(parsed.scope))
      ? (parsed.scope as VideoInvestigationDirective['scope'])
      : 'focused';
    const goal = ['answer', 'compare', 'trace', 'enumerate', 'synthesize'].includes(
      String(parsed.goal),
    )
      ? (parsed.goal as VideoInvestigationDirective['goal'])
      : 'answer';
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.filter(
          (item): item is NonNullable<VideoInvestigationDirective['evidence']>[number] =>
            ['speech', 'visible-text', 'visual', 'computed'].includes(String(item)),
        )
      : undefined;
    const recordSet = ['all', 'source-authored', 'source-questions', 'observed'].includes(
      String(parsed.recordSet),
    )
      ? parsed.recordSet
      : undefined;
    const rawTimeRange = parsed.timeRange as
      | (VideoInvestigationDirective['timeRange'] & {
          start?: unknown;
          end?: unknown;
          startSeconds?: unknown;
          endSeconds?: unknown;
        })
      | undefined;
    const timeRangeOrigin = (parsed as { timeRangeOrigin?: unknown }).timeRangeOrigin;
    const timeRange = rawTimeRange
      ? {
          startSecs: Number(
            rawTimeRange.startSecs ?? rawTimeRange.startSeconds ?? rawTimeRange.start,
          ),
          endSecs: Number(rawTimeRange.endSecs ?? rawTimeRange.endSeconds ?? rawTimeRange.end),
        }
      : undefined;
    if (
      timeRange &&
      (!Number.isFinite(timeRange.startSecs) ||
        !Number.isFinite(timeRange.endSecs) ||
        timeRange.startSecs < 0 ||
        timeRange.endSecs < timeRange.startSecs)
    ) {
      return undefined;
    }
    // A numerical range must be attributable to a source position the user
    // actually referenced.  Otherwise it is a plausible-looking but invented
    // cut of the recording; safely broaden to source synthesis rather than
    // silently hiding relevant material.  This rule operates on structured
    // planner output only and therefore works in every user language.
    const hasUnattributedRange = timeRange !== undefined && timeRangeOrigin !== 'user-mentioned';
    return {
      scope: hasUnattributedRange ? 'source' : scope,
      goal: hasUnattributedRange ? 'synthesize' : goal,
      ...(hasUnattributedRange ? {} : evidence?.length ? { evidence: [...new Set(evidence)] } : {}),
      ...(hasUnattributedRange ? {} : recordSet ? { recordSet } : {}),
      ...(!hasUnattributedRange && timeRange
        ? { timeRange: { startSecs: timeRange.startSecs, endSecs: timeRange.endSecs } }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function containsExhaustiveEvidence(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      return containsExhaustiveEvidence(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(containsExhaustiveEvidence);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const continuation = record.continuation;
  if (
    continuation &&
    typeof continuation === 'object' &&
    (continuation as { exhaustive?: unknown }).exhaustive === true
  ) {
    return true;
  }
  return Object.values(record).some(containsExhaustiveEvidence);
}

/**
 * Detect the generic evidence-capability protocol, including results nested
 * inside compacted tool payloads. This deliberately knows nothing about a
 * media domain or a question type.
 */
function findUnverifiedMediaEvidence(value: unknown): {
  mediaAssetId?: string;
  claimVerification: unknown;
} | null {
  if (typeof value === 'string') {
    try {
      return findUnverifiedMediaEvidence(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUnverifiedMediaEvidence(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const verification = record.claimVerification;
  if (
    record.success === true &&
    verification &&
    typeof verification === 'object' &&
    mediaClaimNeedsCorroboration(verification)
  ) {
    return {
      mediaAssetId: typeof record.mediaAssetId === 'string' ? record.mediaAssetId : undefined,
      claimVerification: verification,
    };
  }
  for (const child of Object.values(record)) {
    const found = findUnverifiedMediaEvidence(child);
    if (found) return found;
  }
  return null;
}

function collectDirectReadings(value: unknown): string[] {
  const readings = new Set<string>();
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (record.directObservation && typeof record.directObservation === 'object') {
      const observations = (record.directObservation as { readings?: unknown }).readings;
      if (Array.isArray(observations)) {
        for (const observation of observations) {
          const found =
            observation && typeof observation === 'object'
              ? (observation as { found?: unknown }).found
              : undefined;
          const settlesQuestion =
            observation && typeof observation === 'object'
              ? (observation as { settlesQuestion?: unknown }).settlesQuestion
              : undefined;
          if (
            typeof found === 'string' &&
            settlesQuestion === true &&
            found.trim() &&
            !/^Observed context \(not a complete answer\):/i.test(found.trim())
          ) {
            readings.add(found.trim());
          }
        }
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...readings].slice(0, 8);
}

/**
 * Some reasoning-heavy providers can finish a tool-backed turn without ever
 * emitting answer text. Keep the stream structurally valid and insert only
 * evidence that was already directly established; otherwise surface a clear
 * retry message instead of leaving a permanent spinner or an empty answer.
 */
function fallbackAnswerFromEvidence(evidence: unknown, question: string) {
  const established = [
    ...collectQuestionMatchedDirectClaims(evidence, question),
    ...collectDirectReadings(evidence),
  ];
  if (established.length > 0) return established.join('\n');
  const trail = collectAnswerLevelMediaStatements(evidence);
  if (trail.length > 0) return trail.join('\n');
  const excerpts = collectSourceExcerpts(evidence, question);
  if (excerpts.length > 0) return excerpts.join('\n\n');
  return 'I could not complete the response just now. Please try the question again.';
}

/**
 * Preserve a useful, source-grounded fallback when a provider closes after
 * tools without generating text. This is deliberately schema-tolerant so
 * every retrieval or marketplace capability can contribute its own text
 * evidence without teaching the chat route about individual source types.
 */
function collectSourceExcerpts(value: unknown, question: string): string[] {
  const excerpts = new Set<string>();
  const questionTerms = new Set(
    question.toLocaleLowerCase().match(/[\p{Letter}\p{Number}]+/gu) ?? [],
  );
  const add = (candidate: unknown) => {
    if (typeof candidate !== 'string') return;
    const text = candidate.replace(/\s+/g, ' ').trim();
    if (text.length < 16) return;
    if (
      /^Observed context \(not a complete answer\):/i.test(text) ||
      /Claim verdict:\s*(?:partial|not-established)\b/i.test(text) ||
      /^Verified media evidence is available\./i.test(text)
    ) {
      return;
    }
    const normalized = text.toLocaleLowerCase();
    const matches = [...questionTerms].filter(
      (term) => term.length > 2 && normalized.includes(term),
    );
    if (matches.length > 0 || excerpts.size === 0) excerpts.add(text.slice(0, 900));
  };
  const visit = (candidate: unknown, key?: string) => {
    if (typeof candidate === 'string') {
      if (key === 'text' || key === 'excerpt' || key === 'content' || key === 'summary')
        add(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => visit(item));
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    for (const [childKey, child] of Object.entries(candidate)) visit(child, childKey);
  };
  visit(value);
  return [...excerpts].slice(0, 4);
}

/**
 * True when retrieval located a spreadsheet-like source that also exists in
 * the structured table store. Matching by normalized file stem avoids sending
 * a question about one uploaded spreadsheet to an unrelated workbook.
 */
function hasRetrievedTabularEvidence(value: unknown, datasetNames: string[]): boolean {
  const datasetStems = new Set(
    datasetNames.map((name) => name.replace(/\.(?:csv|xlsx?|ods|json)$/i, '').toLocaleLowerCase()),
  );
  const matchesDataset = (text: string) => {
    const fileName = text.match(/[^/\\]+\.(?:csv|xlsx?|ods|json)\b/i)?.[0];
    if (!fileName) return false;
    const stem = fileName.replace(/\.(?:csv|xlsx?|ods|json)$/i, '').toLocaleLowerCase();
    return datasetStems.has(stem);
  };
  const visit = (candidate: unknown): boolean => {
    if (typeof candidate === 'string') {
      try {
        return visit(JSON.parse(candidate));
      } catch {
        return matchesDataset(candidate);
      }
    }
    if (Array.isArray(candidate)) return candidate.some(visit);
    if (!candidate || typeof candidate !== 'object') return false;
    return Object.values(candidate).some(visit);
  };
  return visit(value);
}

/** Tool output can be embedded as a compact JSON string before the next model
 * step, so inspect both structured values and safely parseable strings. */
function containsCompletedMediaEvidence(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      return containsCompletedMediaEvidence(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(containsCompletedMediaEvidence);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const evidence = record.videoEvidence;
  if (
    evidence &&
    typeof evidence === 'object' &&
    (evidence as { success?: unknown }).success === true
  )
    return true;
  return Object.values(record).some(containsCompletedMediaEvidence);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function POST(req: Request) {
  const parsedBody: unknown = await req.json();
  const body =
    parsedBody && typeof parsedBody === 'object' ? (parsedBody as Record<string, unknown>) : {};
  const {
    projectId,
    chatModelId: requestedModelId,
    docSessionId,
    docFields,
  } = body as {
    projectId?: string;
    chatModelId?: string;
    docSessionId?: string;
    docFields?: {
      id: string;
      name: string;
      type: string;
      value?: string;
      context?: string;
      placeholder?: string;
    }[];
  };
  const messages = normalizeIncomingMessages(body?.messages) as UIMessage[];
  if (!messages.some((message) => message.role === 'user')) {
    return Response.json({ error: 'At least one user message is required.' }, { status: 400 });
  }

  const config = await readConfig();
  const provider = config.chatProvider || config.embeddingProvider;

  // Fetch dynamic models to resolve defaults
  const gatewayModels = await getModelsByType('language');
  const allChatModels = gatewayModels.map(toChatDescriptor);

  const configuredModelId = requestedModelId || config.chatModelId;
  const chatModelId =
    normalizeNativeChatModelId(provider, configuredModelId) ||
    getDefaultChatModel(allChatModels, provider)?.id ||
    'openai/gpt-4o-mini';

  // The configured provider is authoritative. In particular, a direct Google
  // key must never be routed through the gateway because a model ID has a
  // vendor prefix.
  const resolvedProvider = provider;

  const apiKey = config.chatApiKey || config.embeddingApiKey || undefined;
  const model = createChatModel(
    resolvedProvider,
    chatModelId,
    apiKey,
    config.customChatModels,
  ) as any;

  // Keep only a bounded, compact conversation history.
  const MAX_HISTORY_MESSAGES = 20;
  // The answer model receives only the recent transcript, but follow-up
  // routing can safely inspect a larger window of compact tool references.
  // This preserves the active table/image after dozens of turns without
  // sending those historical tool payloads to the model.
  const EVIDENCE_HISTORY_MESSAGES = 80;
  const messagesToProcess =
    messages.length > MAX_HISTORY_MESSAGES
      ? messages.slice(messages.length - MAX_HISTORY_MESSAGES)
      : messages;
  const evidenceMessages =
    messages.length > EVIDENCE_HISTORY_MESSAGES
      ? messages.slice(messages.length - EVIDENCE_HISTORY_MESSAGES)
      : messages;
  const safeMessages = messagesToProcess
    .map((m) => {
      const anyM = { ...m } as any;

      // Strip IDs and reasoning from conversation history so the API provider doesn't attempt
      // to strictly validate our compacted messages against its original signatures (e.g. o1/o3/Claude).
      delete anyM.id;
      delete anyM.reasoning;
      delete anyM.providerOptions;

      // Tool invocations are rendered UI/execution data, not durable conversation
      // context. Fresh retrieval is required for every substantive question.
      if (anyM.role === 'assistant' && anyM.toolInvocations) {
        delete anyM.toolInvocations;
      }

      if (Array.isArray(anyM.parts)) {
        anyM.parts = anyM.parts.flatMap((part: any) => {
          // Tool calls/results are execution details, not conversation. The
          // model retrieves fresh evidence for substantive questions, so keeping
          // rendered tables, artifacts, and tool UI here only wastes context.
          // Also strip reasoning parts to avoid signature mismatch errors when
          // passing a compacted history back to the model.
          if (
            part.type === 'tool-invocation' ||
            part.type === 'tool-result' ||
            part.type?.startsWith('tool-') ||
            part.type === 'reasoning'
          ) {
            return [];
          }
          // File parts — strip large non-image files (PDF base64)
          if (part.type === 'file') {
            const data = part.data || part.url || '';
            if (typeof data === 'string' && data.length > 5000) {
              const mimeType = (part.mimeType || part.mediaType || '').toLowerCase();
              const isImage = mimeType.startsWith('image/');
              if (!isImage) {
                // Replace with a placeholder
                return {
                  type: 'text',
                  text: `[File attachment: ${
                    mimeType || 'document'
                  } — removed from context for size]`,
                };
              }
            }
          }
          return part;
        });

        // Tool-only assistant entries have no conversational content after
        // compaction and must be omitted instead of adding dummy context.
        if (anyM.role === 'assistant' && anyM.parts.length === 0) {
          anyM.omitFromModelContext = true;
        }
      }

      // Strip PDF attachments from experimental_attachments (base64 data URLs can be many MB)
      if (anyM.experimental_attachments) {
        anyM.experimental_attachments = anyM.experimental_attachments.filter((att: any) => {
          if (att.url && att.url.length > 5000) {
            const isPdf =
              (att.contentType && att.contentType.toLowerCase().includes('pdf')) ||
              (att.name && att.name.toLowerCase().endsWith('.pdf')) ||
              att.url.substring(0, 50).toLowerCase().includes('pdf');

            if (isPdf || !(att.contentType && att.contentType.toLowerCase().startsWith('image/'))) {
              return false;
            }
          }
          return true;
        });
      }

      if (Array.isArray(anyM.content)) {
        anyM.content = anyM.content.filter((part: any) => {
          const data = part.data || part.url || part.text;
          if (typeof data === 'string' && data.length > 5000) {
            const isPdf =
              (part.mimeType && part.mimeType.toLowerCase().includes('pdf')) ||
              (part.contentType && part.contentType.toLowerCase().includes('pdf')) ||
              data.substring(0, 50).toLowerCase().includes('pdf');

            if (
              isPdf ||
              !(part.mimeType?.startsWith('image/') || part.contentType?.startsWith('image/'))
            ) {
              return false;
            }
          }
          return true;
        });
      }

      return anyM;
    })
    .filter((message) => !message.omitFromModelContext);

  let tabularContext = '';
  let hasTabularData = false;
  let tabularColumnNames: string[] = [];
  let tabularDatasetNames: string[] = [];
  try {
    const datasets = await listTabularDatasets();
    if (datasets.length > 0) {
      hasTabularData = true;
      tabularColumnNames = datasets.flatMap((dataset) =>
        dataset.columns.map((column) => column.name),
      );
      tabularDatasetNames = datasets.map((dataset) => dataset.fileName);
      // Keep complete schemas for the most likely targets, then keep a compact
      // ID/name listing for the remaining uploads. Previously only eight files
      // were visible to the model, making a later spreadsheet effectively
      // impossible to select in a mixed-upload conversation.
      const detailedDatasets = datasets.slice(0, 12);
      const compactDatasets = datasets.slice(12, 40);
      tabularContext = `\n\nAvailable tabular datasets:\n${detailedDatasets
        .map((d) => {
          const visibleColumns = d.columns.slice(0, 60);
          const colDescriptions = visibleColumns
            .map((c) => {
              let desc = `${c.name} (${c.type})`;
              if (c.type === 'date' && c.dateRange) {
                desc += ` [format: ${c.dateRange.format}, range: ${c.dateRange.min} to ${c.dateRange.max}]`;
              }
              if (c.sampleValues && c.sampleValues.length > 0) {
                desc += ` [samples: ${c.sampleValues
                  .slice(0, 3)
                  .map((value) => value.slice(0, 80))
                  .join(', ')}]`;
              }
              return desc;
            })
            .join(', ');
          const hiddenColumns = d.columns.length - visibleColumns.length;
          const sizeHint =
            d.rowCount > 10000
              ? ' ⚠️ LARGE DATASET — use focused filters and aggregations; use code only when the optional code-analysis tool is available.'
              : '';
          return `- Dataset "${d.fileName}" (ID: ${d.id}): ${d.rowCount} rows, ${d.summary.totalColumns} columns.${sizeHint}\n  Columns: ${colDescriptions}${
            hiddenColumns > 0 ? ` (+${hiddenColumns} more; query focused columns only)` : ''
          }`;
        })
        .join('\n')}${
        compactDatasets.length > 0
          ? `\nAdditional datasets (use their ID when the question names one):\n${compactDatasets
              .map(
                (d) =>
                  `- Dataset "${d.fileName}" (ID: ${d.id}): ${d.rowCount} rows, ${d.summary.totalColumns} columns.`,
              )
              .join('\n')}`
          : ''
      }${
        datasets.length > detailedDatasets.length + compactDatasets.length
          ? `\n- ${datasets.length - detailedDatasets.length - compactDatasets.length} further datasets are available; ask the user which file they mean if it is not named in the question.`
          : ''
      }`;
    }
  } catch {
    /* no tabular data */
  }

  let docContext = '';
  if (docSessionId) {
    // Build a rich field listing so the LLM can correctly match semantic meaning to field IDs.
    // Include: ID, name/label, type, current value (if any), and surrounding context text.
    const fieldLines =
      docFields && docFields.length > 0
        ? (docFields as any[])
            .map((f: any) => {
              let line = `- ID: "${f.id}" | Label: "${f.name}" | Type: ${f.type}`;
              if (f.value) line += ` | Current value: "${f.value}"`;
              if (f.context) line += ` | Surrounding text: "${String(f.context).slice(0, 120)}"`;
              if (f.placeholder) line += ` | Placeholder: "${f.placeholder}"`;
              return line;
            })
            .join('\n')
        : 'None detected.';

    docContext = `\n\n[Active Document Session: ${docSessionId}]\nYou are currently editing a document in the Canvas.
The user may ask you to fill out form fields or edit content.
IMPORTANT: Use the exact field IDs listed below when calling "fillDocumentForm". Do NOT invent field IDs.
Available Form Fields (${docFields?.length ?? 0} total):
${fieldLines}`;
  }

  // The generic product prompt lists tools that intentionally are not exposed
  // in this retrieval-only chat. Keeping it out of this request prevents a
  // model from attempting an unavailable sandbox/corpus action and surfacing a
  // technical failure to the user.
  const skillInstructions = (config.skills ?? [])
    .filter((skill) => skill.enabled !== false)
    .map((skill) => {
      const source =
        skill.source === 'inline'
          ? skill.content?.slice(0, 12_000)
          : `Remote skill reference: ${skill.url}`;
      return `## ${skill.name}\n${skill.description}\n${source ?? ''}`;
    })
    .join('\n\n');
  const userText = latestUserText(messagesToProcess);
  const recentAssistantText = latestAssistantText(messagesToProcess);
  const precedingReferenceText =
    !hasNumberedDocumentReference(userText) && requestsImagePresentation(userText)
      ? precedingNumberedDocumentReference(messagesToProcess)
      : undefined;
  const reusableEvidence = extractConversationEvidence(evidenceMessages);
  // This compact string is used by retrieval only, not appended to model
  // history. It preserves the immediate topic while keeping the model context
  // at the existing 20-message bound.
  const contextualKnowledgeQuery = contextualizeKnowledgeFollowUpQuery(userText, reusableEvidence);
  const tabularQuestion = isLikelyTabularQuestion({
    text: userText,
    columnNames: tabularColumnNames,
    datasetNames: tabularDatasetNames,
  });
  const requiresSandboxAnalysis =
    hasTabularData && tabularQuestion && requiresTabularSandbox(userText);
  const isExplicitVideoCorrection =
    /^(?:no|nah),\s+|\b(?:that(?:'s| is) (?:wrong|incorrect)|correction\s*:|actually\s*,|instead\s*,|should be|not .{0,80}\bbut|i meant)\b/i.test(
      userText,
    );
  const imagePreviewFollowUp = isImagePreviewFollowUp(userText, reusableEvidence);
  const tabularFollowUp = isTabularFollowUp(userText, reusableEvidence);
  // A prior table is useful to resolve a follow-up, but never as answer
  // evidence: the source can be deleted or moved between chat turns.
  const canAnswerFromRecentTable = false;
  const tabularFollowUpNeedsVisualization = tabularFollowUp && requestsVisualization(userText);
  const continuesMediaTopic =
    !imagePreviewFollowUp &&
    !tabularFollowUp &&
    !isExplicitVideoCorrection &&
    continuesRecentMediaTopic(userText, reusableEvidence);
  // Previous results only help resolve a reference such as "show it". They
  // are never treated as an answer cache: a new user message gets a fresh
  // source lookup so a weak model cannot silently answer document questions
  // from general knowledge or an unrelated earlier excerpt.
  const reusesPriorEvidence = false;
  let systemPrompt =
    (config.systemPrompt ? `USER INSTRUCTIONS:\n${config.systemPrompt}\n` : '') +
    (skillInstructions ? `\nAVAILABLE AGENT SKILLS:\n${skillInstructions}\n` : '') +
    'Never print a tool name, JSON arguments, or tool-call syntax in a user-facing answer. Use tools silently, then give the result in natural language.\n' +
    CHAT_POLICY +
    tabularContext +
    docContext +
    (imagePreviewFollowUp || tabularFollowUp || reusesPriorEvidence || isExplicitVideoCorrection
      ? formatConversationEvidence(reusableEvidence)
      : '');
  const {
    tools: allTools,
    promptFragments: dynamicToolPromptFragments,
    dynamicToolNames,
    dynamicToolWorkflows,
    dynamicToolEvidenceInputs,
  } = await getChatTools({
    projectId,
    docSessionId,
    config,
    requestText: userText,
    contextualKnowledgeQuery,
    origin: new URL(req.url).origin,
    preferredMediaAssetId: continuesMediaTopic ? reusableEvidence.mediaAssetIds[0] : undefined,
  });
  // Every installed marketplace/Enterprise tool the model may call this turn
  // — generic by construction (dynamicToolNames is whatever getChatTools
  // discovered, never a hardcoded list), so a newly installed tool becomes
  // callable with no change here.
  const dynamicTools = Object.fromEntries(
    dynamicToolNames
      .map((name) => [name, allTools[name]] as const)
      .filter(([, def]) => Boolean(def)),
  );
  if (dynamicToolPromptFragments.length > 0) {
    systemPrompt += `\nINSTALLED TOOLS:\n${dynamicToolPromptFragments.join('\n')}\n`;
  }
  // Provide both RAG tools and Data Analysis tools so the model can handle complex queries (e.g. Excel)
  const builtInTools = executableTools({
    searchKnowledgeBase: allTools.searchKnowledgeBase,
    presentMedia: allTools.presentMedia,
    queryTabularData: allTools.queryTabularData,
    generateVisualization: allTools.generateVisualization,
    ...(allTools.executeAnalysis ? { executeAnalysis: allTools.executeAnalysis } : {}),
    inspectPdfPages: allTools.inspectPdfPages,
    analyzePdfPages: allTools.analyzePdfPages,
    analyzeImageDeeply: allTools.analyzeImageDeeply,
    // Document Canvas actions — must stay available or the model can never
    // call requestDocumentSignature/fillDocumentForm/editDocument and instead
    // falls back to asking the user in plain text.
    fillDocumentForm: allTools.fillDocumentForm,
    editDocument: allTools.editDocument,
    requestDocumentSignature: allTools.requestDocumentSignature,
  });
  const isGreeting =
    /^(hi|hello|hey|thanks|thank you|ok|sure|yes|no|please|help|how are you|good morning|good afternoon|good evening|bye|goodbye)[.!\s]*$/i.test(
      userText.trim(),
    );
  // Tool calling is not equally reliable across every supported provider.
  // Make the first source lookup deterministic for ordinary chat so even a
  // lightweight model starts from indexed evidence. Tabular questions retain
  // their own authoritative structured-data path below.
  const forceKnowledgeBaseSearch = Boolean(
    userText.trim() &&
    !isGreeting &&
    !docSessionId &&
    (!hasTabularData || !tabularQuestion) &&
    builtInTools.searchKnowledgeBase,
  );

  if (isGreeting && builtInTools.searchKnowledgeBase) {
    // Completely remove the search tool for simple greetings to guarantee no retrieval overhead
    delete (builtInTools as any).searchKnowledgeBase;
  }

  // Remote MCP connections are opt-in per workspace and their tool names are
  // namespaced by connection. This lets Local Chat use the same connections as
  // Agents without risking collisions with Larkup's built-in tools.
  const mcp = await openMcpTools({ forLocalChat: true });
  for (const failure of mcp.failures) {
    console.warn(`[chat] MCP connection ${failure.connectionId} unavailable: ${failure.message}`);
  }
  const tools = { ...builtInTools, ...dynamicTools, ...mcp.tools };
  const evidenceRefinementTools = dynamicToolNames.filter(
    (name) => dynamicToolWorkflows[name] === 'evidence-refinement' && Boolean(allTools[name]),
  );
  const evidenceQueryTools = dynamicToolNames.filter(
    (name) =>
      dynamicToolWorkflows[name] === 'evidence-query' &&
      dynamicToolEvidenceInputs[name] === 'media-asset' &&
      Boolean(allTools[name]),
  );
  const toolNames = Object.keys(tools) as Array<keyof typeof tools & string>;

  // Debug: log payload sizes to console in development
  if (process.env.NODE_ENV === 'development') {
    const stringifiedMsgs = JSON.stringify(safeMessages);
  }

  try {
    await authorizeEnterpriseAiRequest(config);
    const responseStream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        let preloadedEvidence: unknown;
        let preloadedVideoEvidence = false;
        let preloadedEvidenceQueryAttempted = false;
        const preflightToolCallId = `knowledge-${crypto.randomUUID()}`;

        if (forceKnowledgeBaseSearch && builtInTools.searchKnowledgeBase) {
          // Open the message ourselves since a tool part is about to stream
          // before streamText runs. Without this, the client sees a tool
          // part with no owning message yet and starts an implicit one of
          // its own, then streamText's own 'start' event opens a second,
          // real message -- rendering as two separate assistant messages
          // (and two duplicate "Searched" blocks) for one turn.
          writer.write({ type: 'start' });
          // Start with a real, visible tool call. This removes provider-specific
          // ambiguity without hiding the source/citation and media progress UI.
          writer.write({
            type: 'tool-input-available',
            toolCallId: preflightToolCallId,
            toolName: 'searchKnowledgeBase',
            input: { query: userText },
          });
          try {
            preloadedEvidence = await (builtInTools.searchKnowledgeBase as any).execute(
              { query: userText },
              { toolCallId: preflightToolCallId },
            );
          } catch (error) {
            preloadedEvidence = {
              query: userText,
              hits: [],
              error: error instanceof Error ? error.message : 'Search could not be completed.',
            };
          }
          writer.write({
            type: 'tool-output-available',
            toolCallId: preflightToolCallId,
            output: preloadedEvidence,
          });

          // A PDF hit is a document-level locator, not necessarily the exact
          // page. Read its bounded local page evidence before asking the chat
          // model to compose an answer. This works whether or not visual
          // derivatives were enabled at upload time and avoids selecting the
          // first embedded image (often a cover) for a later preview request.
          const pdfSource = findRetrievedPdfSource(preloadedEvidence);
          if (pdfSource && builtInTools.inspectPdfPages) {
            const inspectionCallId = `pdf-pages-${crypto.randomUUID()}`;
            const pdfInspectionQuestion = [
              userText,
              contextualKnowledgeQuery,
              recentAssistantText,
              precedingReferenceText,
            ]
              .filter((text): text is string => Boolean(text?.trim()))
              .join('\n\n');
            const preferredPageNumbers = preferredPdfPagesForInspection(
              pdfSource.pageNumber,
              pdfInspectionQuestion,
            );
            const inspectionInput = {
              documentId: pdfSource.documentId,
              // Resolve a terse follow-up ("render it") against the same
              // compact source context used for the preceding retrieval and
              // the immediately prior answer. An explicit Figure/Table/Eq
              // reference intentionally lets the local PDF rank its own
              // pages instead of blindly trusting an incidental vector hit.
              question: pdfInspectionQuestion,
              ...(preferredPageNumbers ? { pageNumbers: preferredPageNumbers } : {}),
            };
            writer.write({
              type: 'tool-input-available',
              toolCallId: inspectionCallId,
              toolName: 'inspectPdfPages',
              input: inspectionInput,
            });
            let pdfInspection: unknown;
            try {
              pdfInspection = await (builtInTools.inspectPdfPages as any).execute(inspectionInput, {
                toolCallId: inspectionCallId,
              });
            } catch (error) {
              pdfInspection = {
                success: false,
                error: error instanceof Error ? error.message : 'Could not inspect the source PDF.',
              };
            }
            writer.write({
              type: 'tool-output-available',
              toolCallId: inspectionCallId,
              output: pdfInspection,
            });
            preloadedEvidence = {
              ...(preloadedEvidence &&
              typeof preloadedEvidence === 'object' &&
              !Array.isArray(preloadedEvidence)
                ? (preloadedEvidence as Record<string, unknown>)
                : { retrieval: preloadedEvidence }),
              pdfInspection,
            };

            // Presentation is deterministic once local page selection has
            // succeeded. Returning the selected rendered page here keeps a
            // weak chat model from substituting an arbitrary indexed image.
            const inspectedPages =
              pdfInspection && typeof pdfInspection === 'object'
                ? (pdfInspection as { pages?: Array<{ pageNumber?: unknown }>; success?: unknown })
                    .pages
                : undefined;
            const selectedPageNumbers = (inspectedPages ?? []).flatMap((page) =>
              typeof page.pageNumber === 'number' && Number.isInteger(page.pageNumber)
                ? [page.pageNumber]
                : [],
            );
            const selectedPage = inspectedPages?.find(
              (page) => typeof page.pageNumber === 'number' && Number.isInteger(page.pageNumber),
            )?.pageNumber;

            // The vision request is issued by the existing, analytics-tracked
            // page-analysis tool. Running it from the deterministic evidence
            // path means GPT-3.5-class chat models receive exact rendered-page
            // readings instead of being asked to decide whether to call a
            // second tool. It stays bounded to the three locally selected
            // source pages.
            if (
              !requestsImagePresentation(userText) &&
              requiresPdfVisualAnalysis(userText) &&
              selectedPageNumbers.length > 0 &&
              builtInTools.analyzePdfPages
            ) {
              const analysisCallId = `pdf-analysis-${crypto.randomUUID()}`;
              const analysisInput = {
                documentId: pdfSource.documentId,
                pageNumbers: selectedPageNumbers,
                prompt: userText,
              };
              writer.write({
                type: 'tool-input-available',
                toolCallId: analysisCallId,
                toolName: 'analyzePdfPages',
                input: analysisInput,
              });
              let pdfVisualAnalysis: unknown;
              try {
                pdfVisualAnalysis = await (builtInTools.analyzePdfPages as any).execute(
                  analysisInput,
                  { toolCallId: analysisCallId },
                );
              } catch (error) {
                pdfVisualAnalysis = {
                  success: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Could not analyze the rendered PDF pages.',
                };
              }
              writer.write({
                type: 'tool-output-available',
                toolCallId: analysisCallId,
                output: pdfVisualAnalysis,
              });
              preloadedEvidence = {
                ...(preloadedEvidence &&
                typeof preloadedEvidence === 'object' &&
                !Array.isArray(preloadedEvidence)
                  ? (preloadedEvidence as Record<string, unknown>)
                  : { retrieval: preloadedEvidence }),
                pdfVisualAnalysis,
              };
            }

            if (requestsImagePresentation(userText) && selectedPage && builtInTools.presentMedia) {
              const previewCallId = `pdf-preview-${crypto.randomUUID()}`;
              const previewInput = { documentId: pdfSource.documentId, pageNumber: selectedPage };
              writer.write({
                type: 'tool-input-available',
                toolCallId: previewCallId,
                toolName: 'presentMedia',
                input: previewInput,
              });
              let previewOutput: unknown;
              try {
                previewOutput = await (builtInTools.presentMedia as any).execute(previewInput, {
                  toolCallId: previewCallId,
                });
              } catch (error) {
                previewOutput = {
                  success: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Could not render the selected PDF page.',
                };
              }
              writer.write({
                type: 'tool-output-available',
                toolCallId: previewCallId,
                output: previewOutput,
              });
              if (
                previewOutput &&
                typeof previewOutput === 'object' &&
                (previewOutput as { success?: unknown }).success === true
              ) {
                const answerId = `answer-${crypto.randomUUID()}`;
                writer.write({ type: 'text-start', id: answerId });
                writer.write({
                  type: 'text-delta',
                  id: answerId,
                  delta: `Here is ${pdfSource.title ?? 'the selected document'} page ${selectedPage}.`,
                });
                writer.write({ type: 'text-end', id: answerId });
                await mcp.close();
                return;
              }
            }
          }

          const mediaAssetId = explicitMediaEvidenceAssetId(preloadedEvidence);
          // A completed source is already known. Invoke its one generic
          // media-evidence capability directly instead of making the selected
          // chat model construct a large tool payload before any evidence can
          // be read. This is driven by the Marketplace capability contract,
          // not a tool id, language, genre, or question word list.
          if (mediaAssetId && evidenceQueryTools.length === 1) {
            const evidenceToolName = evidenceQueryTools[0]!;
            const evidenceCallId = `media-evidence-${crypto.randomUUID()}`;
            // Planning is a small structured operation, not the answer model's
            // prose task. Gateway projects use the fast general planner so a
            // selected reasoning model cannot spend the interactive budget
            // thinking before it emits the directive; direct providers retain
            // the user's selected model and its own credentials.
            const plannerModelId =
              resolvedProvider === 'vercel_ai_gateway' ? 'openai/gpt-4o-mini' : chatModelId;
            const plannerModel =
              plannerModelId === chatModelId
                ? model
                : createChatModel(
                    resolvedProvider,
                    plannerModelId,
                    apiKey,
                    config.customChatModels,
                  );
            const plannerInput = {
              model: plannerModel,
              providerOptions: gatewayProviderOptions(resolvedProvider, plannerModelId),
              question: userText,
            };
            const [plannedInvestigation, sourcePosition] = await Promise.all([
              planVideoEvidenceQuery(plannerInput),
              userSpecifiedSourcePosition(plannerInput),
            ]);
            const hasUserSpecifiedPosition = sourcePosition?.hasPosition;
            const connectsBeyondPosition = sourcePosition?.connectsBeyondPosition === true;
            // `trace` is already the planner's language-neutral declaration
            // that the answer connects moments. Preserve its supplied source
            // boundary and give the evidence capability its visibility record
            // set even if the auxiliary binary classifier was inconclusive.
            const tracesBeyondPosition =
              connectsBeyondPosition || plannedInvestigation?.goal === 'trace';
            const investigation =
              hasUserSpecifiedPosition === false && plannedInvestigation?.timeRange
                ? { scope: 'source' as const, goal: 'synthesize' as const }
                : tracesBeyondPosition && plannedInvestigation?.timeRange
                  ? {
                      ...plannedInvestigation,
                      scope: 'temporal' as const,
                      goal: 'trace' as const,
                      evidence: ['visual'] as const,
                      recordSet: 'observed' as const,
                    }
                  : plannedInvestigation;
            const evidenceInput = {
              mediaAssetId,
              query: userText,
              ...(investigation ? { investigation } : {}),
            };
            preloadedEvidenceQueryAttempted = true;
            writer.write({
              type: 'tool-input-available',
              toolCallId: evidenceCallId,
              toolName: evidenceToolName,
              input: evidenceInput,
            });
            let evidenceOutput: unknown;
            try {
              evidenceOutput = await (allTools[evidenceToolName] as any).execute(evidenceInput, {
                toolCallId: evidenceCallId,
              });
            } catch (error) {
              evidenceOutput = {
                success: false,
                mediaAssetId,
                error:
                  error instanceof Error
                    ? error.message
                    : 'The indexed media evidence could not be read.',
              };
            }
            // A source-wide evidence action owns an opaque chronological
            // cursor. Follow it here, before a prose model sees the result;
            // otherwise a long lecture, interview, match, or recording is
            // silently reduced to its first page. This is capability protocol
            // handling, independent of the source's subject or language.
            if (evidenceOutput && typeof evidenceOutput === 'object') {
              evidenceOutput = await collectExhaustiveVideoEvidencePages(
                (pageInput, options) =>
                  (allTools[evidenceToolName] as any).execute(pageInput, options),
                evidenceInput,
                evidenceOutput,
                evidenceCallId,
              );
            }
            writer.write({
              type: 'tool-output-available',
              toolCallId: evidenceCallId,
              output: evidenceOutput,
            });
            preloadedEvidence = evidenceOutput;
            preloadedVideoEvidence = containsAnswerLevelMediaEvidence(evidenceOutput);
          }
        }

        const deterministicAnswer =
          formatExhaustiveMediaAnswer(preloadedEvidence, userText) ??
          (preloadedVideoEvidence
            ? (formatLocatedObservedSubjectAnswer(preloadedEvidence) ??
              collectQuestionMatchedDirectClaims(preloadedEvidence, userText)[0] ??
              formatDirectObservationAnswer(preloadedEvidence, userText) ??
              formatObservedAppearanceAnswer(preloadedEvidence))
            : undefined);
        if (deterministicAnswer) {
          const answerId = `answer-${crypto.randomUUID()}`;
          writer.write({ type: 'text-start', id: answerId });
          writer.write({ type: 'text-delta', id: answerId, delta: deterministicAnswer });
          writer.write({ type: 'text-end', id: answerId });
          await mcp.close();
          return;
        }

        // Once an evidence action has completed, composition is a short,
        // grounded rendering task. Some selectable reasoning models consume a
        // whole chat step before emitting prose, which leaves the user with an
        // aborted stream despite a fast, verified index result. Gateway video
        // answers therefore use the same low-latency grounded writer as the
        // planner; non-video and direct-provider chats keep the selected model.
        const hasPreloadedMediaEvidence = Boolean(explicitMediaEvidenceAssetId(preloadedEvidence));
        const evidenceWriterModelId =
          hasPreloadedMediaEvidence && resolvedProvider === 'vercel_ai_gateway'
            ? 'openai/gpt-4o-mini'
            : chatModelId;
        const evidenceWriterModel =
          evidenceWriterModelId === chatModelId
            ? model
            : createChatModel(
                resolvedProvider,
                evidenceWriterModelId,
                apiKey,
                config.customChatModels,
              );
        const result = streamText({
          model: evidenceWriterModel,
          // The Gateway owns model failover. Retrying the same quota-limited model
          // only makes the user wait longer and consumes their request allowance.
          maxRetries: 0,
          // The evidence action has its own bounded budget. Once evidence is
          // ready, the answer model must not leave the user waiting forever.
          timeout:
            preloadedVideoEvidence || preloadedEvidenceQueryAttempted
              ? {
                  // Retrieval and any bounded source check already finished.
                  // This last call only turns verified evidence into prose, but
                  // cross-modal evidence can still take a provider longer than a
                  // trivial text reply. Keep it bounded while allowing a normal
                  // complete answer instead of prematurely exposing recovery text.
                  totalMs: 45_000,
                  stepMs: 35_000,
                  firstChunkMs: 25_000,
                  chunkMs: 20_000,
                  toolMs: 20_000,
                }
              : requiresSandboxAnalysis
                ? {
                    // A deep spreadsheet task needs time for the model to write
                    // code, a bounded local execution, and a grounded response.
                    // Keep this wider budget limited to explicit analytical
                    // operations so ordinary table questions remain responsive.
                    totalMs: 150_000,
                    stepMs: 90_000,
                    firstChunkMs: 70_000,
                    chunkMs: 70_000,
                    toolMs: 45_000,
                  }
                : {
                    totalMs: 45_000,
                    stepMs: 35_000,
                    firstChunkMs: 25_000,
                    chunkMs: 20_000,
                    toolMs: 30_000,
                  },
          providerOptions: gatewayProviderOptions(resolvedProvider, evidenceWriterModelId),
          system: `${systemPrompt}${
            preloadedEvidence === undefined
              ? ''
              : preloadedEvidenceContext(preloadedEvidence, userText)
          }`,
          messages: await convertToModelMessages(safeMessages, { tools }),
          // Leave enough room for structured tool inputs (especially charts) and
          // a complete grounded answer while keeping the response bounded.
          maxOutputTokens:
            preloadedEvidence !== undefined && containsExhaustiveEvidence(preloadedEvidence)
              ? 8_000
              : hasPreloadedMediaEvidence && evidenceWriterModelId !== chatModelId
                ? 1_200
                : preloadedVideoEvidence
                  ? // Reasoning-capable providers may spend part of this budget
                    // before emitting visible prose. A short answer ceiling here
                    // therefore produced a truncated factual reply even after the
                    // evidence action had completed quickly.
                    3_600
                  : 2_400,
          // Evidence loop: retrieve → verify → bounded inspect/refinement → retrieve
          // again → answer. The inspection tool itself cannot authorize a claim.
          // Most chats finish after their first answer. The upper bound leaves
          // room for retrieve → verify → inspect → re-verify when a tool result
          // reveals a video claim that needs source-level corroboration.
          stopWhen: stepCountIs(5),
          toolChoice: 'auto',
          prepareStep: ({ stepNumber, messages }) => {
            if (preloadedEvidence !== undefined) {
              const preloadedMediaAssetId = explicitMediaEvidenceAssetId(preloadedEvidence);
              if (
                !preloadedVideoEvidence &&
                !preloadedEvidenceQueryAttempted &&
                preloadedMediaAssetId &&
                evidenceQueryTools.length > 0 &&
                stepNumber === 0
              ) {
                return {
                  ...(evidenceQueryTools.length === 1
                    ? {
                        toolChoice: {
                          type: 'tool' as const,
                          toolName: evidenceQueryTools[0],
                        } as any,
                      }
                    : {}),
                  activeTools: evidenceQueryTools as any,
                  messages: compactToolContextForModel(messages),
                };
              }
              // The preflight above reads a bounded page set for every PDF
              // hit. It is stronger evidence than a flattened extraction and
              // applies equally to equations, captions, tables, scans, and
              // vector diagrams. Only requests that depend on visual/layout
              // fidelity need a second, rendered-page analysis pass.
              if (hasRetrievedPdfEvidence(preloadedEvidence)) {
                const inspection =
                  preloadedEvidence && typeof preloadedEvidence === 'object'
                    ? (preloadedEvidence as { pdfInspection?: { success?: unknown } }).pdfInspection
                    : undefined;
                const visualAnalysisAttempted =
                  preloadedEvidence &&
                  typeof preloadedEvidence === 'object' &&
                  Object.prototype.hasOwnProperty.call(preloadedEvidence, 'pdfVisualAnalysis');
                if (inspection?.success === true) {
                  if (
                    requiresPdfVisualAnalysis(userText) &&
                    !visualAnalysisAttempted &&
                    stepNumber === 0
                  ) {
                    return {
                      toolChoice: { type: 'tool', toolName: 'analyzePdfPages' },
                      activeTools: ['analyzePdfPages'],
                      messages: compactToolContextForModel(messages),
                    };
                  }
                  return {
                    toolChoice: 'none' as const,
                    activeTools: [],
                    messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                  };
                }
                if (stepNumber === 0) {
                  return {
                    toolChoice: { type: 'tool', toolName: 'inspectPdfPages' },
                    activeTools: ['inspectPdfPages'],
                    messages: compactToolContextForModel(messages),
                  };
                }
                return {
                  toolChoice: 'none' as const,
                  activeTools: [],
                  messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                };
              }
              // A vector hit from a spreadsheet is a locator, not a reliable
              // representation of the sheet. Once such a source is found,
              // route the answer through the structured dataset API so exact
              // filters and values are read from the full indexed table.
              if (
                hasTabularData &&
                hasRetrievedTabularEvidence(preloadedEvidence, tabularDatasetNames)
              ) {
                if (stepNumber === 0) {
                  return {
                    toolChoice: { type: 'tool', toolName: 'queryTabularData' },
                    activeTools: ['queryTabularData'],
                    messages: compactToolContextForModel(messages),
                  };
                }
                return {
                  toolChoice: 'none' as const,
                  activeTools: [],
                  messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                };
              }
              // A retrieved PDF image is only a navigation hint. Structural
              // questions need one bounded visual read before they can be
              // answered; otherwise the model is forced to guess from captions.
              if (
                !hasRetrievedPdfEvidence(preloadedEvidence) &&
                hasRetrievedImageEvidence(preloadedEvidence) &&
                stepNumber === 0
              ) {
                if (requestsImagePresentation(userText)) {
                  return {
                    toolChoice: { type: 'tool', toolName: 'presentMedia' },
                    activeTools: ['presentMedia'],
                    messages: compactToolContextForModel(messages),
                  };
                }
                if (!shouldInspectRetrievedImage(userText, preloadedEvidence)) {
                  return {
                    toolChoice: 'none' as const,
                    activeTools: [],
                    messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                  };
                }
                return {
                  activeTools: ['analyzeImageDeeply'],
                  messages: compactToolContextForModel(messages),
                };
              }
              // The server already gathered the current evidence. A chart is a
              // presentation action rather than another evidence lookup, so let
              // the model turn these exact rows into the UI tool payload once.
              if (
                requestsVisualization(userText) &&
                builtInTools.generateVisualization &&
                !JSON.stringify(messages).includes('generateVisualization')
              ) {
                return {
                  toolChoice: { type: 'tool', toolName: 'generateVisualization' },
                  activeTools: ['generateVisualization'],
                  messages: compactToolContextForModel(messages),
                };
              }
              // The server already gathered the current evidence. Do not rely on
              // the selected model to make (or obey) a second tool call before it
              // can formulate the grounded answer.
              return {
                toolChoice: 'none' as const,
                activeTools: [],
                messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
              };
            }
            if (imagePreviewFollowUp) {
              return stepNumber === 0
                ? {
                    toolChoice: { type: 'tool', toolName: 'presentMedia' },
                    activeTools: ['presentMedia'],
                    messages: compactToolContextForModel(messages),
                  }
                : {
                    toolChoice: 'none' as const,
                    activeTools: [],
                    messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                  };
            }

            if (reusesPriorEvidence) {
              return {
                toolChoice: 'none' as const,
                activeTools: [],
                messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
              };
            }

            if (tabularFollowUp) {
              if (canAnswerFromRecentTable && !tabularFollowUpNeedsVisualization) {
                return {
                  toolChoice: 'none' as const,
                  activeTools: [],
                  messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                };
              }
              return stepNumber === 0
                ? {
                    toolChoice: { type: 'tool', toolName: 'queryTabularData' },
                    activeTools: ['queryTabularData'],
                    messages: compactToolContextForModel(messages),
                  }
                : {
                    toolChoice: 'none' as const,
                    activeTools: [],
                    messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                  };
            }

            if (hasTabularData && tabularQuestion) {
              // Exact spreadsheet questions should always start with the
              // structured query engine. It works for large sheets without a
              // Python environment and removes model/provider variance that
              // previously sent simple "highest/lowest" questions to code.
              // Code analysis can receive multiple explicitly selected sheets
              // when a relationship cannot be answered by one bounded query.
              const routing = tabularToolsForStep({
                stepNumber,
                toolNames: toolNames as string[],
                requiresSandbox: requiresTabularSandbox(userText),
              });
              return {
                ...routing,
                activeTools: routing.activeTools.filter(
                  (name) => !evidenceQueryTools.includes(name as any),
                ),
                messages:
                  routing.toolChoice === 'none'
                    ? withFinalAnswerNudge(compactToolContextForModel(messages))
                    : compactToolContextForModel(messages),
              };
            }

            const mediaFlow = mediaEvidenceFlow(
              messages,
              reusableEvidence.mediaAssetIds,
              evidenceQueryTools,
            );
            if (mediaFlow.hasMediaAsset && evidenceQueryTools.length > 0) {
              if (mediaFlow.hasCompletedEvidence) {
                return {
                  toolChoice: 'none' as const,
                  activeTools: [],
                  messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                };
              }
              if (mediaFlow.evidenceQueries === 0) {
                return {
                  ...(evidenceQueryTools.length === 1
                    ? {
                        toolChoice: {
                          type: 'tool' as const,
                          toolName: evidenceQueryTools[0],
                        } as any,
                      }
                    : {}),
                  activeTools: evidenceQueryTools as any,
                  messages: compactToolContextForModel(messages),
                };
              }
              return {
                toolChoice: 'none' as const,
                activeTools: [],
                messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
              };
            }

            const step = retrievalToolsForStep({
              stepNumber,
              forceKnowledgeBaseSearch,
              forceWebSearch: false,
              toolNames,
              finalAnswerStep: 2,
            });
            const compacted = compactToolContextForModel(messages);
            return {
              ...step,
              messages: step?.toolChoice === 'none' ? withFinalAnswerNudge(compacted) : compacted,
            };
          },
          onFinish: async ({ usage, response }) => {
            try {
              const { trackUsageEvent, estimateCost } =
                await import('@larkup/core/analytics-store');
              const u = usage as any;
              void trackUsageEvent({
                type: 'chat',
                modelId: chatModelId,
                provider: resolvedProvider,
                promptTokens: u?.promptTokens ?? 0,
                completionTokens: u?.completionTokens ?? 0,
                totalTokens: u?.totalTokens ?? 0,
                estimatedCost: estimateCost(
                  chatModelId,
                  u?.promptTokens ?? 0,
                  u?.completionTokens ?? 0,
                ),
                timestamp: new Date().toISOString(),
              });
              trackEnterpriseAiUsage(config, {
                modelId: chatModelId,
                inputTokens: u?.promptTokens ?? 0,
                outputTokens: u?.completionTokens ?? 0,
                costUsd: estimateCost(chatModelId, u?.promptTokens ?? 0, u?.completionTokens ?? 0),
              });
            } finally {
              await mcp.close();
            }
          },
          tools,
        });

        writer.merge(
          result
            .toUIMessageStream({
              // The preflight branch above already sent the message's 'start' event
              // itself (see the comment there) -- a second one here would split the
              // response into two separate assistant messages on the client.
              sendStart: !(forceKnowledgeBaseSearch && builtInTools.searchKnowledgeBase),
              // Reasoning is execution detail; keep the chat focused on the answer
              // and the compact, inspectable evidence UI.
              sendReasoning: false,
              onError: (error: any) => {
                // Extract the deepest error message available
                const rawMessage: string =
                  error?.lastError?.message ||
                  error?.message ||
                  error?.error?.message ||
                  (typeof error === 'string' ? error : '');

                // Only log non-trivial errors to console (skip tool-routing noise)
                const isToolRouting =
                  rawMessage.includes('unavailable tool') || error?.name === 'AI_NoSuchToolError';
                if (!isToolRouting) {
                  console.error('[chat] stream error:', rawMessage);
                }

                // ── Rate limit / quota exceeded ──
                if (
                  rawMessage.includes('rate-limited') ||
                  rawMessage.includes('rate_limit') ||
                  rawMessage.includes('RateLimitError') ||
                  rawMessage.includes('429') ||
                  rawMessage.includes('quota')
                ) {
                  return 'Vercel AI Gateway could not serve this model because it is rate-limited. We tried compatible backup models. Try again shortly, choose another model, or add AI Gateway credits / a provider key in Settings.';
                }

                // ── Model tried to call a tool that was not available in this step ──
                // This happens when the step-routing removes a tool but the model still
                // tries to call it. It is not a real failure — just retry.
                if (isToolRouting) {
                  return 'The model tried an unavailable action. Please try your question again.';
                }

                // ── Authentication / API key errors ──
                if (
                  rawMessage.includes('401') ||
                  rawMessage.includes('Unauthorized') ||
                  rawMessage.includes('Invalid API Key') ||
                  rawMessage.includes('authentication')
                ) {
                  return 'Your API key appears to be invalid or expired. Please check your AI provider settings.';
                }

                // ── Context length / token limit ──
                if (
                  rawMessage.includes('context_length') ||
                  rawMessage.includes('maximum context') ||
                  rawMessage.includes('too many tokens') ||
                  rawMessage.includes('max_tokens')
                ) {
                  return 'The conversation is too long for this model. Try starting a new chat or switching to a model with a larger context window.';
                }

                // ── Timeout ──
                if (rawMessage.includes('timeout') || rawMessage.includes('ETIMEDOUT')) {
                  return 'The request timed out. Please try again.';
                }

                // ── Generic fallback — never expose implementation errors ──
                return 'Something went wrong while generating a response. Please try again.';
              },
            })
            .pipeThrough(
              recoverEmptyUIMessageStream(
                fallbackAnswerFromEvidence(preloadedEvidence, userText),
              )(),
            ),
        );
      },
    });

    return createUIMessageStreamResponse({ stream: responseStream });
  } catch (error) {
    await mcp.close();
    throw error;
  }
}
