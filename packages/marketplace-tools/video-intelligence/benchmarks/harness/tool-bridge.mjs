import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VideoIntelligenceClient } from '../../src/client.ts';
import { attachVideoIntelligenceAgentClient } from '../../src/agent.ts';
import { runWithWorkspaceHost } from '../../../../core/src/workspace-host.ts';
import { readVideoKnowledgeState } from '../../../../core/src/video-knowledge/store.ts';
import { buildVideoKnowledgeFromEvidence } from '../../../../core/src/video-knowledge/knowledge-builder.ts';
import { createVideoKnowledgeRevision, updateVideoKnowledgeRevision } from '../../../../core/src/video-knowledge/revision-store.ts';
import { activateVideoKnowledgeManifest } from '../../../../core/src/video-knowledge/manifest-store.ts';
import { appendVideoKnowledgeRefinement } from '../../../../core/src/video-knowledge/refinement-store.ts';
import { searchVideoKnowledge } from '../../../../core/src/video-knowledge/retrieval.ts';
import { scanVideoKnowledge, aggregateVideoKnowledge } from '../../../../core/src/video-knowledge/query-engine.ts';
import { planVideoQuestion } from '../../../../core/src/video-knowledge/query-planner.ts';
import { planVideoInvestigation } from '../../../../core/src/video-knowledge/investigation.ts';
import { loadConverter } from './build-converter.mjs';
import { collectEvidencePages } from './evidence-pages.mjs';
const { convertEvidence } = await loadConverter();

/** Only a schema boundary: the imported core builder owns evidence/hierarchy behavior. */
export function evidenceInputs(raw) {
  const records = convertEvidence({ visualObservations: [], tracks: [], transcript: [], semanticObservations: [], ...raw });
  for (const t of raw.suppliedSubtitles ?? []) records.push({ modality: 'transcript',
    timeRange: { startSecs: t.startMs / 1000, endSecs: t.endMs / 1000, precision: 'segment' },
    payload: { text: t.text }, source: { kind: 'provider', provider: 'official-subtitles' },
    confidence: { score: 0.8, source: 'provider', calibrationStatus: 'uncalibrated', uncertaintyReasons: ['Supplied dataset subtitle timing.'] } });
  return records;
}

export async function execute(input) {
  const raw = JSON.parse(await readFile(input.evidencePath, 'utf8'));
  raw.suppliedSubtitles = input.officialSubtitles ?? [];
  const state = new Map();
  const host = {
    project: { id: 'isolated-video-benchmark', name: 'Video benchmark' },
    readState: async (key) => structuredClone(state.get(key) ?? null),
    writeState: async (key, value) => { state.set(key, structuredClone(value)); },
    trackUsage: async (event) => ({ ...event, id: randomUUID() }),
  };
  const actions = [];
  const runtime = new VideoIntelligenceClient({ mode: input.runtimeMode ?? 'custom-remote', endpoint: input.runtimeEndpoint, apiKey: input.runtimeToken });
  return runWithWorkspaceHost(host, async () => {
    const revision = await createVideoKnowledgeRevision({ mediaAssetId: input.sourceId,
      sourceFingerprint: input.evidencePath, pipelineVersion: 'canonical-benchmark-v1',
      budget: {}, coverage: { complete: true } });
    const built = await buildVideoKnowledgeFromEvidence({ mediaAssetId: input.sourceId,
      knowledgeRevisionId: revision.id, evidence: evidenceInputs(raw) });
    await activateVideoKnowledgeManifest({ mediaAssetId: input.sourceId, knowledgeRevisionId: revision.id,
      activeEvidenceRevisionIds: Object.fromEntries(built.evidenceLineageIds.map((id, i) => [id, built.evidenceIds[i]])),
      activeObservationRevisionIds: Object.fromEntries(built.observationLineageIds.map((id, i) => [id, built.observationIds[i]])),
      activeProjectionIds: [], activationReason: 'initial' });
    await updateVideoKnowledgeRevision(revision.id, { status: 'completed' });
    let inspections = 0;
    let readbackCompleted = false;
    const inspect = async (url, options) => {
      const parsed = new URL(url);
      if (parsed.origin !== 'http://127.0.0.1:8892' || parsed.pathname !== '/api/media/inspect') throw Error('UNSUPPORTED_PRIVATE_OPERATION');
      const request = JSON.parse(options.body);
      if (request.mediaAssetId !== input.sourceId || request.startSecs < 0 || request.endSecs <= request.startSecs || request.endSecs - request.startSecs > 60 + 1e-6 || request.endSecs > raw.durationMs / 1000 || ++inspections > 2) {
        return Response.json({ error: 'Bounded inspection limit reached.' }, { status: 422 });
      }
      actions.push({ action: 'inspectVideoKnowledge', startMs: request.startSecs * 1000, endMs: request.endSecs * 1000 });
      let uploadId = input.runtimeUploadId;
      if (!uploadId) throw Error('SOURCE_UPLOAD_UNAVAILABLE');
      const checkpoint = input.inspectionStatePath;
      let saved = {};
      try { saved = JSON.parse(await readFile(checkpoint, 'utf8')); } catch {}
      const key = `${request.startSecs}:${request.endSecs}`;
      let jobId = saved[key]?.jobId;
      if (!jobId && input.reconcileOnly) {
        actions.push({ action: 'inspectionReadbackUnavailable' });
        return Response.json({ error: 'Read-back cannot submit a new inspection.' }, { status: 503 });
      }
      if (!jobId) {
        // An explicit unknown fence survives a crash between submit and handle persistence.
        if (saved[key]?.submitted) throw Error('REMOTE_OUTCOME_UNKNOWN');
        saved[key] = { submitted: true };
        await save(checkpoint, saved);
        const job = await runtime.submitJob({ source: { uploadId,
          ...(input.runtimeMode === 'managed-cloud' ? { durationSecs: request.endSecs - request.startSecs,
            timelineDurationSecs: raw.durationMs / 1000 } : {}) },
          ...(!input.proxyMode ? { modelConfiguration: Object.fromEntries(Object.entries(input.roles).map(([role, spec]) => [role,
            { provider: spec.provider, model: spec.model, apiKey: spec.apiKey }])) } : {}),
          brief: { indexingMode: 'thorough', processingAuthorityConfirmed: true, retainSourceHours: 24,
            goal: request.question, expectedQuestions: [request.question],
            importantRanges: [{ startSecs: request.startSecs, endSecs: request.endSecs, reason: request.question }],
            interactive: true, requireSemanticVision: true, skipVideoEmbeddings: true,
            skipTranscription: input.proxyMode || !request.includeSpeech,
            ...(input.proxyMode ? { transcriptContext: (raw.transcript ?? []).filter((s) => s.endMs >= request.startSecs * 1000 && s.startMs <= request.endSecs * 1000) } : {}),
            continuousSequence: request.continuousSequence ?? false,
            maxFrames: Math.min(24, request.maxFrames ?? 12) } });
        jobId = job.id;
        saved[key] = { submitted: true, jobId };
        await save(checkpoint, saved);
      }
      const deadline = Date.now() + Math.min(120000, request.maxWaitMs ?? 40000);
      while (Date.now() < deadline) {
        const job = await runtime.getJob(jobId);
        if (job.status === 'completed' && job.result) {
          const evidence = evidenceInputs(job.result);
          await appendVideoKnowledgeRefinement({ mediaAssetId: input.sourceId, evidence });
          readbackCompleted = true;
          return Response.json({ evidence: evidence.map((x) => ({ ...x, id: randomUUID() })), jobId });
        }
        if (['failed', 'cancelled'].includes(job.status)) return Response.json({ error: 'Inspection failed.' }, { status: 503 });
        await new Promise((r) => setTimeout(r, 1000));
      }
      actions.push({ action: 'inspectionPending', jobId });
      return Response.json({ error: 'Inspection still processing; outcome requires reconciliation.', jobId }, { status: 503 });
    };
    const fetcher = async (url, options) => {
      try {
        const response = await inspect(url, options);
        if (!response.ok && !actions.some((a) => a.action === 'inspectionPending' || a.action === 'inspectionReadbackUnavailable')) {
          actions.push({ action: 'inspectionFailed', status: response.status });
        }
        return response;
      } catch {
        actions.push({ action: 'inspectionFailed' });
        return Response.json({ error: 'Runtime inspection failed; not a correctness result.' }, { status: 503 });
      }
    };
    const client = attachVideoIntelligenceAgentClient(runtime, fetcher);
    const context = { origin: 'http://127.0.0.1:8892', projectId: 'isolated-video-benchmark', mediaEvidence: {
      getAsset: async (id) => id === input.sourceId ? { id, type: 'video', processingStatus: 'completed',
        durationSecs: raw.durationMs / 1000, fileName: 'benchmark-source.mp4', sourceLanguage: raw.detectedLanguage } : undefined,
      ...(process.env.BENCHMARK_ENABLE_REWATCH === '1'
        ? { reWatch: (await import('./quick-look-bridge.mjs')).benchmarkReWatch(input, raw, actions) }
        : {}),
      planQuestion: planVideoQuestion,
      planInvestigation: planVideoInvestigation,
      search: searchVideoKnowledge,
      scan: scanVideoKnowledge,
      aggregate: aggregateVideoKnowledge,
    } };
    if (input.simpleRetrieval) {
      const hits = await searchVideoKnowledge(input.sourceId, input.question.question, 12);
      return { success: true, evidence: hits, actions: [{ action: 'simpleRetrieval', limit: 12 }] };
    }
    const collected = await collectEvidencePages(async (cursor) => {
      actions.push({ action: 'queryVideoEvidence', cursor: cursor ?? 0 });
      return client.queryVideoEvidence({ mediaAssetId: input.sourceId,
        query: input.question.question, ...(input.investigation ? { investigation: input.investigation } : {}),
        limit: 48, ...(cursor !== undefined ? { cursor } : {}) }, context);
    }, { maxPages: input.protocol.maxEvidencePages ?? 64 });
    if (actions.some((action) => action.action === 'canonicalReWatchFailed' && action.outcomeRequiresReconciliation)) return { ...collected, success: false, toolExecutionValid: false, error: 'Canonical re-watch incomplete; reconcile saved requests before retry.', actions };
    if (actions.some((action) => action.action === 'inspectionFailed' || action.action === 'inspectionPending' || (action.action === 'inspectionReadbackUnavailable' && !readbackCompleted))) {
      return { ...collected, success: false, toolExecutionValid: false, actions };
    }
    return { ...collected, actions, readbackCompleted };
  });
}

async function save(path, document) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + '.' + randomUUID();
  await writeFile(temporary, JSON.stringify(document), { mode: 0o600 });
  await rename(temporary, path);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    process.stdout.write(JSON.stringify(await execute(JSON.parse(text))));
  } catch {
    process.stderr.write('Canonical benchmark tool adapter failed.\n');
    process.exitCode = 1;
  }
}
