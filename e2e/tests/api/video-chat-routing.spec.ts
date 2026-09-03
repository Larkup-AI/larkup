import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const repoRoot = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

test('chat exposes the evidence-first video tools instead of ordinary search alone', async () => {
  const route = await readFile(`${repoRoot}/apps/web/app/api/chat/route.ts`, 'utf8');
  const tools = await readFile(`${repoRoot}/apps/web/app/api/chat/tools.ts`, 'utf8');
  const mediaRouting = await readFile(
    `${repoRoot}/apps/web/lib/chat/media-source-routing.ts`,
    'utf8',
  );

  expect(tools).toContain('dynamicToolWorkflows[def.name] = def.workflow');
  expect(tools).not.toContain('investigateMatchedEvidence');
  expect(tools).not.toContain('knowledgeBaseSearchCache');
  expect(route).toContain('dynamicToolWorkflows');
  expect(route).toContain("dynamicToolWorkflows[name] === 'evidence-refinement'");
  expect(route).not.toContain('inspectVideoKnowledge: allTools.inspectVideoKnowledge');
  expect(tools).toContain('Treat only returned active evidence as source truth');
  expect(tools).not.toContain('inspectVideoKnowledge: tool');
  const videoAgent = await readFile(
    `${repoRoot}/packages/marketplace-tools/video-intelligence/src/agent.ts`,
    'utf8',
  );
  expect(videoAgent).toContain("name: 'inspectVideoKnowledge'");
  expect(videoAgent).toContain("workflow: 'evidence-refinement'");
  expect(videoAgent).toContain("name: 'queryVideoEvidence'");
  expect(videoAgent).toContain("workflow: 'evidence-query'");
  expect(videoAgent).toContain("evidenceInput: 'media-asset'");
  expect(videoAgent).toContain("modalities: ['visual']");
  expect(videoAgent).toContain("modalities: ['computed']");
  expect(videoAgent).toContain('indexedCrossEvidenceTrail');
  expect(tools).toContain("retrievalFallback: 'active-media-source'");
  expect(mediaRouting).toContain("retrievalFallback: 'active-conversation-media-source'");
  expect(tools).toContain('async function findEvidenceFirstVideoAssetId');
  expect(tools).toContain('assetIdByDocumentId');
  expect(tools).toContain('findEvidenceFirstVideoAssetId(');
  expect(tools).toContain('preferEvidenceQuality');
  expect(route).toContain('function mediaEvidenceFlow(');
  expect(route).toContain('function containsCompletedMediaEvidence(');
  expect(route).toContain('hasMediaAsset: recentMediaAssetIds.length > 0');
  expect(route).toContain('mediaAssetId');
  expect(route).toContain('if (mediaFlow.hasMediaAsset && evidenceQueryTools.length > 0)');
  expect(route).toContain('Dispatch the one unambiguous evidence-query action');
  expect(route).toContain('preloadedVideoEvidence = true');
  expect(route).toContain('toolName: evidenceToolName');
  expect(route).toContain('input: { mediaAssetId, query: userText }');
  expect(route).toContain('canReuseKnowledgeBaseEvidence(userText, messagesToProcess) &&');
  expect(route).toContain('!continuesMediaTopic');
  expect(route).toContain('you could not confirm the specific detail in the video');
  expect(route).toContain('function findUnverifiedMediaEvidence(');
  expect(route).toContain('mediaClaimNeedsCorroboration(verification)');
  const toolContext = await readFile(`${repoRoot}/apps/web/lib/chat/tool-context.ts`, 'utf8');
  expect(toolContext).toContain("verification.status === 'established-by-trail'");
  expect(route).toContain('The evidence gate above is authoritative');
  expect(route).toContain('Do not recommend a search engine, public website, or outside source');
  const messageItem = await readFile(
    `${repoRoot}/apps/web/components/chat/message-item.tsx`,
    'utf8',
  );
  expect(messageItem).toContain('toolProgress && toolProgress.toolCallId === callId');
  expect(await readFile(`${repoRoot}/apps/web/app/api/media/inspect/route.ts`, 'utf8')).toContain(
    "url.searchParams.get('projectId') ?? url.searchParams.get('serverId')",
  );
});

test('runs bounded precision verification with visible, sanitized chat progress', async () => {
  const inspectRoute = await readFile(
    `${repoRoot}/apps/web/app/api/media/inspect/route.ts`,
    'utf8',
  );
  const tools = await readFile(`${repoRoot}/apps/web/app/api/chat/tools.ts`, 'utf8');
  const messageItem = await readFile(
    `${repoRoot}/apps/web/components/chat/message-item.tsx`,
    'utf8',
  );
  const knowledgeResult = await readFile(
    `${repoRoot}/apps/web/components/chat/tools/knowledge-base-result.tsx`,
    'utf8',
  );
  const adapter = await readFile(
    `${repoRoot}/apps/web/lib/media/video-intelligence-adapter.ts`,
    'utf8',
  );
  const liveToolProgress = await readFile(
    `${repoRoot}/apps/web/lib/chat/live-tool-progress.ts`,
    'utf8',
  );
  const videoAgent = await readFile(
    `${repoRoot}/packages/marketplace-tools/video-intelligence/src/agent.ts`,
    'utf8',
  );
  const corpusPanel = await readFile(
    `${repoRoot}/apps/web/components/data/corpus-panel.tsx`,
    'utf8',
  );

  expect(inspectRoute).toContain("const toolCallId = typeof body.toolCallId === 'string'");
  expect(inspectRoute).toContain('const BOUNDED_INSPECTION_MAX_WAIT_MS = 480_000');
  const gpuActivityRoute = await readFile(
    `${repoRoot}/apps/web/app/api/gpu-activity/route.ts`,
    'utf8',
  );
  expect(gpuActivityRoute).toContain(
    "url.searchParams.get('projectId') ?? url.searchParams.get('serverId')",
  );
  expect(gpuActivityRoute).toContain('runWithProject(projectId, () => readGpuActivity())');
  expect(tools).toContain('asset.durationSecs - LIMITS.durationSecs');
  expect(messageItem).toContain('stripLeakedToolCalls');
  expect(messageItem).toContain('activeKnowledgeProgress');
  expect(messageItem).toContain('keepPreviousData: true');
  const gpuActivityStore = await readFile(
    `${repoRoot}/packages/core/src/gpu-activity-store.ts`,
    'utf8',
  );
  const gpuActivityIndicator = await readFile(
    `${repoRoot}/apps/web/components/chat/gpu-activity-indicator.tsx`,
    'utf8',
  );
  expect(gpuActivityStore).toContain('await fs.rename(temporary, file)');
  expect(gpuActivityIndicator).toContain("activity.phase !== 'waking-up' || activity.toolCallId");
  expect(messageItem).toContain('transition-[width] duration-700 ease-out');
  expect(messageItem).toContain('smoothLiveToolProgress(liveToolActivity.activity, progressClock)');
  expect(messageItem).toContain('smoothPendingToolProgress(');
  expect(messageItem).toContain('pendingToolStartedAt.current[toolCallId] ??= progressClock');
  expect(liveToolProgress).toContain('pre-completion ceiling');
  expect(liveToolProgress).toContain(
    "const ceiling = activity.phase === 'waking-up' ? 28 : RUNNING_PROGRESS_CEILING",
  );
  expect(videoAgent).toContain('INTERACTIVE_INSPECTION_BUDGET_MS = 45_000');
  expect(videoAgent).toContain('INTERACTIVE_REWATCH_BUDGET_MS = 20_000');
  expect(videoAgent).toContain('signal: AbortSignal.timeout(timeoutMs)');
  expect(videoAgent).toContain('deadline: responseDeadline');
  expect(videoAgent).toContain(
    'Do not discard the established attributes merely because the names are unresolved.',
  );
  expect(corpusPanel).toContain('aria-label="View indexed video evidence"');
  expect(corpusPanel).toContain('<VideoKnowledgeInspector');
  const processRoute = await readFile(
    `${repoRoot}/apps/web/app/api/media/process/route.ts`,
    'utf8',
  );
  expect(processRoute).toContain('await primeSemanticEvidenceIndex(asset.id);');
  expect(processRoute).toContain(
    'const semanticEvidenceReady = await primeSemanticEvidenceIndex(asset.id);',
  );
  expect(processRoute).toContain('Video evidence vectors could not be built');
  expect(adapter).toContain(
    "cloudOverallToStagePercent('prepare', progress.percent, progress.stagePercent)",
  );
  // The worker owns smoothing; the host consumes its stage percentage rather
  // than re-deriving progress timing of its own.
  expect(adapter).toContain('progress.stagePercent');
  expect(adapter).not.toContain('smoothCloudProgress');
  expect(adapter).toContain("if (stage === 'synthesize') return 'synthesize';");
});

test('keeps video conclusions evidence-first without scenario-specific outcome rules', async () => {
  const tools = await readFile(`${repoRoot}/apps/web/app/api/chat/tools.ts`, 'utf8');
  const route = await readFile(`${repoRoot}/apps/web/app/api/chat/route.ts`, 'utf8');

  expect(tools).not.toContain('resolveTerminalOutcomeFromEvidence');
  expect(tools).not.toContain('terminalOutcomeResolution');
  expect(route).toContain('distinguish a direct observation from an inference');
  expect(tools).toContain('Video questions deliberately do not reuse answer or miss memory');
  expect(tools).not.toContain("cache: 'durable-hit' as const");
});

test('grounds a named person before presenting an appearance claim', async () => {
  const inspectRoute = await readFile(
    `${repoRoot}/apps/web/app/api/media/inspect/route.ts`,
    'utf8',
  );
  const vision = await readFile(
    `${repoRoot}/packages/marketplace-tools/video-intelligence/runtime/app/services/vision.py`,
    'utf8',
  );

  const videoAgent = await readFile(
    `${repoRoot}/packages/marketplace-tools/video-intelligence/src/agent.ts`,
    'utf8',
  );
  expect(videoAgent).toContain('[ranked, subjectHits, identityHits, visualHits, computedHits]');
  expect(videoAgent).toContain('if (plan.subjectName) hints.push(plan.subjectName)');
  expect(videoAgent).toContain('knownEntities: inspectionEntityHints(hits, plan)');
  expect(inspectRoute).toContain('const knownEntities = Array.isArray(body.knownEntities)');
  // Match on the expression, not on how the formatter happened to wrap it.
  expect(inspectRoute.replace(/\s+/g, ' ')).toContain(
    "knownEntities.length > 0 ? 'thorough'",
  );
  expect(vision).toContain('Name a person only where this clip shows a readable name label');
  expect(vision).toContain('Aligned evidence context for this clip');
  expect(vision).toContain('Named people or entities that require visual grounding');
});

test('publishes a reindex as a fresh revision without one state write per projection', async () => {
  const processRoute = await readFile(
    `${repoRoot}/apps/web/app/api/media/process/route.ts`,
    'utf8',
  );
  const manifestStore = await readFile(
    `${repoRoot}/packages/core/src/video-knowledge/manifest-store.ts`,
    'utf8',
  );

  expect(processRoute).toContain('parentRevisionId: previousRevision?.id');
  expect(processRoute).toContain(
    'idempotencyKey: `${input.asset.id}:${revision.id}:video-knowledge-v1`',
  );
  expect(processRoute).toContain('const projections = await saveVideoKnowledgeProjections(');
  expect(manifestStore).toContain('export function saveVideoKnowledgeProjections(');
  expect(manifestStore).toContain('state.projections.push(...projections)');
});

test('renders video citations through the generic ui.kind contract, opening only the first clip', async () => {
  // The first source clip should make the answer immediately inspectable.
  // Follow-up answers for the same asset stay compact, and every rendering
  // detail still flows through the generic output.ui.kind contract rather
  // than a tool-name-specific component.
  const citations = await readFile(
    `${repoRoot}/apps/web/components/chat/tools/chat-citations.tsx`,
    'utf8',
  );
  const chatWorkspace = await readFile(
    `${repoRoot}/apps/web/components/chat/chat-workspace.tsx`,
    'utf8',
  );
  const supportingClip = await readFile(`${repoRoot}/apps/web/lib/chat-supporting-clip.ts`, 'utf8');
  const messageItem = await readFile(
    `${repoRoot}/apps/web/components/chat/message-item.tsx`,
    'utf8',
  );
  const tools = await readFile(`${repoRoot}/apps/web/app/api/chat/tools.ts`, 'utf8');
  const toolsConstants = await readFile(`${repoRoot}/apps/web/lib/constants/tools.ts`, 'utf8');
  const preview = await readFile(
    `${repoRoot}/apps/web/components/chat/tools/chat-media-preview.tsx`,
    'utf8',
  );

  expect(citations).toContain('useState(false)');
  expect(citations).toContain('autoOpenSupportingClip && ui.mediaUrl');
  expect(citations).toContain('setClipOpen');
  expect(citations).toContain('Sources');
  expect(citations).toContain('ChatMediaPreview');

  expect(chatWorkspace).toContain('shouldAutoOpenSupportingClip(messages, idx)');
  expect(supportingClip).toContain(
    "messageIndex === messages.findIndex((message) => message.role === 'assistant')",
  );

  expect(messageItem).toContain("enterpriseUi?.kind === 'citations'");
  expect(messageItem).toContain('<ChatCitations');
  expect(messageItem).not.toContain("'video-evidence'");
  expect(toolsConstants).not.toContain("'video-evidence'");

  expect(tools).toContain("kind: 'citations' as const");

  expect(preview).toContain('getProviderEmbedUrl');
  expect(preview).toContain('youtube-nocookie.com/embed');
  expect(preview).toContain('player.vimeo.com/video');
});

test('keeps citations compact while exposing the matched indexed video context', async () => {
  const citations = await readFile(
    `${repoRoot}/apps/web/components/chat/tools/chat-citations.tsx`,
    'utf8',
  );
  const knowledgeResult = await readFile(
    `${repoRoot}/apps/web/components/chat/tools/knowledge-base-result.tsx`,
    'utf8',
  );

  expect(citations).not.toContain('{item.detail ?');
  expect(knowledgeResult).not.toContain('{h.text ?');
  expect(citations).toContain('formatTimestamp(item.timestampSecs)');
  expect(knowledgeResult).toContain('SourceTitle hit={h}');
  expect(knowledgeResult).toContain('Indexed context');
  expect(knowledgeResult).toContain('contextForHit(h)');
  expect(knowledgeResult).toContain('formatTimestamp(h.metadata.startSecs!)');
  expect(knowledgeResult).toContain('dir="auto"');
});

test('bounds answer generation and never reuses a cached video answer', async () => {
  const route = await readFile(`${repoRoot}/apps/web/app/api/chat/route.ts`, 'utf8');
  const tools = await readFile(`${repoRoot}/apps/web/app/api/chat/tools.ts`, 'utf8');
  const workspace = await readFile(
    `${repoRoot}/apps/web/components/chat/chat-workspace.tsx`,
    'utf8',
  );
  const toolContext = await readFile(`${repoRoot}/apps/web/lib/chat/tool-context.ts`, 'utf8');

  expect(route).toContain('experimental_transform: ensureNonEmptyTextStream(');
  expect(route).toContain('totalMs: 45_000');
  expect(route).toContain('firstChunkMs: 25_000');
  expect(toolContext).toContain('export function ensureNonEmptyTextStream(');
  expect(tools).not.toContain('rememberVideoCorrection: tool(');
  expect(tools).not.toContain('saveVideoAnswerCorrection');
  expect(workspace).not.toContain('answer-cache-store');
  expect(workspace).not.toContain('getCachedAnswer');
});

test('indexes any fetched source transcript before paid audio transcription', async () => {
  const processRoute = await readFile(
    `${repoRoot}/apps/web/app/api/media/process/route.ts`,
    'utf8',
  );
  const adapter = await readFile(
    `${repoRoot}/apps/web/lib/media/video-intelligence-adapter.ts`,
    'utf8',
  );

  expect(processRoute).toContain(
    'const hasSourceTranscript = Boolean(sourceTranscript?.chunks?.length);',
  );
  expect(processRoute).toContain('skipAudioExtraction: hasSourceTranscript');
  expect(processRoute).toContain('no audio transcription was needed');
  // The adapter resolves the installed marketplace tool at run time; it must
  // never import a vendored copy of the tool's source.
  expect(adapter).toContain("await loadToolExtension<VideoClient>('video-intelligence')");
  expect(adapter).not.toContain('archive/video-audio');
});
