import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMediaAsset, updateMediaAsset } from '@larkup/core/media-store';
import { appendVideoKnowledgeRefinement } from '@larkup/core/video-knowledge/refinement-store';
import {
  claimBackgroundRefinement,
  createBackgroundRefinement,
  finishBackgroundRefinement,
  getBackgroundRefinement,
  getReservedInspectionBudget,
  reserveInspectionBudget,
  settleInspectionBudget,
} from '@larkup/core/video-knowledge/inspection-store';
import { decideInspection } from '@larkup/core/video-knowledge/inspection-policy';
import type { FrameArtifact, InspectionPurpose } from '@larkup/tool-video-audio';
import type { MetadataValue } from '@larkup/core/video-knowledge/types';
import { trackUsageEvent } from '@larkup/core/analytics-store';
import { runWithServer } from '@larkup/core/workspace';
import { createStorageProvider } from '@larkup/marketplace/storage';
import { isToolInstalled } from '@larkup/marketplace/installer';
import { loadTool } from '@larkup/marketplace/loader';
import {
  createConfiguredOcrAdapter,
  createConfiguredPersonTracker,
  createConfiguredVisionAdapter,
} from '@/lib/video-intelligence/model-adapters';
import { createAnalysisBundle } from '@/lib/video-intelligence/analysis-bundle';
import { analyzeBundle } from '@/lib/video-intelligence/sandbox-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const purposes = new Set(['verify-visual', 'high-res-ocr', 'compare', 'count', 'track', 'code']);

/**
 * Authenticated, bounded rewind. It decodes only a clamped source range and
 * activates validated new evidence as a refinement; no worker path or storage
 * URI is returned to the browser or chat model.
 */
export async function POST(req: Request) {
  const serverId = new URL(req.url).searchParams.get('serverId');
  const handler = () => inspectMedia(req);
  return serverId ? runWithServer(serverId, handler) : handler();
}

export async function inspectMedia(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON inspection request.' }, { status: 400 });
  }
  const mediaAssetId = typeof body.mediaAssetId === 'string' ? body.mediaAssetId : '';
  const startSecs = Number(body.startSecs);
  const endSecs = Number(body.endSecs);
  const purpose =
    typeof body.purpose === 'string' && purposes.has(body.purpose)
      ? (body.purpose as InspectionPurpose)
      : undefined;
  const maxFrames = Math.floor(Number(body.maxFrames ?? 12));
  const maxWidth = Math.floor(Number(body.maxWidth ?? 1280));
  const queryId =
    typeof body.queryId === 'string' && body.queryId.trim()
      ? body.queryId.trim().slice(0, 128)
      : `${mediaAssetId}:${purpose ?? 'inspection'}:${startSecs}:${endSecs}`;
  if (
    !mediaAssetId ||
    !Number.isFinite(startSecs) ||
    !Number.isFinite(endSecs) ||
    endSecs < startSecs ||
    !purpose
  ) {
    return NextResponse.json(
      { error: 'mediaAssetId, finite startSecs/endSecs, and a supported purpose are required.' },
      { status: 400 },
    );
  }
  const reserved = await getReservedInspectionBudget(mediaAssetId, queryId);
  const estimate = {
    durationSecs: Math.min(30, endSecs - startSecs),
    bytes: 64 * 1024 * 1024,
    sandboxSeconds: 0,
    spendUsd: 0,
    // Required source verification may run under the hard cap without a
    // calibration estimate; optional inspection remains conservative.
    lowerResolutionProbability: purpose === 'verify-visual' || purpose === 'compare' ? 0.65 : 0,
  };
  const decision = decideInspection({
    required: ['high-res-ocr', 'count', 'track', 'code'].includes(purpose),
    plausibleRange: endSecs > startSecs,
    estimate,
    budget: {
      remainingDurationSecs: 180 - reserved.durationSecs,
      remainingBytes: 1024 * 1024 * 1024 - reserved.bytes,
      remainingSandboxSeconds: 600 - reserved.sandboxSeconds,
      remainingSpendUsd: 0.5 - reserved.spendUsd,
      usedBundleRuns: 0,
    },
  });
  if (decision.decision === 'denied') {
    return NextResponse.json(
      { error: decision.reason, inspectionDecision: decision },
      { status: 409 },
    );
  }
  if (decision.decision === 'background-refinement') {
    const asset = await getMediaAsset(mediaAssetId);
    if (!asset?.activeVideoKnowledgeRevisionId) {
      return NextResponse.json(
        { error: 'A completed active video knowledge revision is required for refinement.' },
        { status: 409 },
      );
    }
    const job = await createBackgroundRefinement({
      mediaAssetId,
      parentRevisionId: asset.activeVideoKnowledgeRevisionId,
      queryId,
      coveragePlan: [{ startSecs, endSecs, purpose }],
      estimate: {
        maxDurationSecs: endSecs - startSecs,
        maxBytes:
          Math.ceil((endSecs - startSecs) / Math.max(1, estimate.durationSecs)) * estimate.bytes,
        maxCostUsd:
          Math.ceil((endSecs - startSecs) / Math.max(1, estimate.durationSecs)) * estimate.spendUsd,
      },
    });
    return NextResponse.json(
      { inspectionDecision: decision, backgroundRefinement: job },
      { status: 202 },
    );
  }
  const asset = await getMediaAsset(mediaAssetId);
  if (!asset || asset.type !== 'video' || asset.processingStatus !== 'completed') {
    return NextResponse.json(
      { error: 'A completed video asset is required for inspection.' },
      { status: 404 },
    );
  }
  if (!(await isToolInstalled('video-audio'))) {
    return NextResponse.json({ error: 'Video & Audio tool is not installed.' }, { status: 503 });
  }
  const tool = await loadTool<any>('video-audio');
  if (!tool?.inspectTimeRange && !tool?.inspectBoundedSource) {
    return NextResponse.json(
      { error: 'Installed Video & Audio tool does not support bounded inspection.' },
      { status: 503 },
    );
  }
  const reservation = await reserveInspectionBudget({
    mediaAssetId,
    queryId,
    purpose,
    durationSecs: estimate.durationSecs,
    bytes: estimate.bytes,
    sandboxSeconds: estimate.sandboxSeconds,
    spendUsd: estimate.spendUsd,
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-video-inspection-'));
  try {
    const storage = createStorageProvider();
    const local = await storage.resolvePath?.(asset.storageUri);
    const sourcePath =
      local || path.join(tmpDir, `source.${asset.fileName.split('.').pop() || 'mp4'}`);
    if (!local) await fs.writeFile(sourcePath, await storage.retrieve(asset.storageUri));
    const inspect = tool.inspectBoundedSource ?? tool.inspectTimeRange;
    const result = (await inspect({
      mediaPath: sourcePath,
      startSecs,
      endSecs,
      purpose,
      maxFrames: Math.max(1, Math.min(maxFrames, 24)),
      maxWidth: Math.max(64, Math.min(maxWidth, 1920)),
      maxOutputBytes: 256 * 1024 * 1024,
      outputDir: path.join(tmpDir, 'frames'),
    })) as { frames: FrameArtifact[]; actualRange: { startSecs: number; endSecs: number } };
    // Count/track operations get a sandbox-owned derivative bundle. This is a
    // deliberate capability boundary: no source file, storage URI, host path,
    // or generated code is ever given to the sandbox.
    let bundleEvidence:
      | Parameters<typeof appendVideoKnowledgeRefinement>[0]['evidence'][number]
      | undefined;
    if ((purpose === 'count' || purpose === 'track') && result.frames.length > 0) {
      const bundle = await createAnalysisBundle({
        mediaAssetId,
        range: result.actualRange,
        frames: result.frames.map((frame) => ({
          path: frame.path,
          timestampSecs: frame.timestampSecs,
        })),
        maxBytes: Math.min(32 * 1024 * 1024, estimate.bytes),
      });
      try {
        const sandboxResult = await analyzeBundle(bundle, 'frame-inventory');
        const stdout = String((sandboxResult as any).stdout ?? '').slice(0, 8_000);
        bundleEvidence = {
          modality: 'computed',
          timeRange: {
            startSecs: result.actualRange.startSecs,
            endSecs: result.actualRange.endSecs,
            precision: 'estimated',
          },
          payload: {
            method: 'sandbox-frame-inventory-v1',
            bundleId: bundle.id,
            frameCount: bundle.manifest.frames.length,
            result: stdout,
            limitations: [
              'Frame inventory establishes bounded coverage, not object identity or a count by itself.',
            ],
          },
          source: { kind: 'sandbox', version: 'frame-inventory-v1' },
          confidence: {
            score: 1,
            source: 'heuristic',
            calibrationStatus: 'uncalibrated',
            coverage: result.actualRange.endSecs - result.actualRange.startSecs,
            uncertaintyReasons: ['Computed from the bounded derivative-frame bundle.'],
          },
          observation: {
            kind: 'computed',
            value: {
              frameCount: bundle.manifest.frames.length,
              method: 'sandbox-frame-inventory-v1',
            },
          },
        };
      } catch (error) {
        // The detector/tracker evidence remains valid when a supplemental
        // aggregate fails. Report this as a limitation rather than widening
        // the source range or silently running unsandboxed code.
        console.warn('[video-inspection] sandbox frame inventory unavailable:', error);
      }
    }
    const adapter = createConfiguredVisionAdapter();
    const batches: FrameArtifact[][] = [];
    for (let index = 0; index < result.frames.length; index += 6)
      batches.push(result.frames.slice(index, index + 6));
    const evidence = [] as Array<
      Parameters<typeof appendVideoKnowledgeRefinement>[0]['evidence'][number]
    >;
    if (bundleEvidence) evidence.push(bundleEvidence);
    if (purpose === 'count' || purpose === 'track') {
      const tracks = await createConfiguredPersonTracker().track(result.frames);
      if (tracks.length > 0) {
        evidence.push({
          modality: 'computed',
          timeRange: {
            startSecs: result.actualRange.startSecs,
            endSecs: result.actualRange.endSecs,
            precision: 'estimated',
          },
          payload: {
            method: 'anonymous-bounded-visual-tracking',
            tracks: tracks.map((track) => ({
              trackId: track.trackId,
              startSecs: track.startSecs,
              endSecs: track.endSecs,
              frameTimestamps: [...track.frameTimestamps],
              confidence: track.confidence,
              limitations: [...track.limitations],
            })) as MetadataValue[],
            coverage: {
              startSecs: result.actualRange.startSecs,
              endSecs: result.actualRange.endSecs,
            },
          },
          source: {
            kind: 'provider',
            provider: 'configured-vision',
            version: 'anonymous-track-v1',
          },
          confidence: {
            score: Math.min(...tracks.map((track) => track.confidence)),
            source: 'provider',
            calibrationStatus: 'uncalibrated',
            coverage: result.actualRange.endSecs - result.actualRange.startSecs,
            uncertaintyReasons: [...new Set(tracks.flatMap((track) => track.limitations))],
          },
          observation: {
            kind: 'computed',
            value: {
              count: tracks.length,
              tracks: tracks.map((track) => ({
                id: track.trackId,
                startSecs: track.startSecs,
                endSecs: track.endSecs,
              })),
            },
          },
        });
      }
    }
    if (purpose === 'high-res-ocr' || purpose === 'code') {
      const ocr = createConfiguredOcrAdapter();
      for (const frame of result.frames) {
        const raw = await ocr.recognize({ imagePath: frame.path });
        if (raw.blocks.length === 0) continue;
        evidence.push({
          modality: 'ocr',
          timeRange: {
            startSecs: frame.timestampSecs,
            endSecs: frame.timestampSecs,
            precision: frame.timestampPrecision === 'frame' ? 'frame' : 'estimated',
          },
          payload: {
            blocks: raw.blocks.map((block) => ({
              text: block.text,
              left: block.left,
              top: block.top,
              width: block.width,
              height: block.height,
              confidence: block.confidence,
              language: block.language,
              direction: block.direction,
            })) as MetadataValue[],
            ...(raw.provider ? { provider: raw.provider } : {}),
            ...(raw.model ? { model: raw.model } : {}),
          },
          source: { kind: 'provider', provider: raw.provider, model: raw.model },
          confidence: {
            score: Math.min(...raw.blocks.map((block) => block.confidence)),
            source: 'provider',
            calibrationStatus: 'uncalibrated',
            uncertaintyReasons: ['OCR extracted during a bounded source inspection.'],
          },
          observation: {
            kind: 'ocr',
            value: { text: raw.blocks.map((block) => block.text).join('\n') },
          },
        });
      }
    }
    let previousContext = '';
    for (const frames of batches) {
      let analysis;
      try {
        analysis = await adapter.analyze({ frames, previousContext });
      } catch {
        // One retry follows the schema-repair rule. Invalid output is never
        // persisted as a guessed observation.
        analysis = await adapter.analyze({
          frames,
          previousContext: `${previousContext}\nReturn valid JSON only.`,
        });
      }
      for (const observation of analysis.observations) {
        const observedFrames = frames.filter((frame) =>
          observation.frameTimestamps.includes(frame.timestampSecs),
        );
        if (observedFrames.length === 0) continue;
        const stateValue =
          observation.kind === 'state' ? tryParseStateValue(observation.value) : observation.value;
        evidence.push({
          modality: observation.kind === 'ui' || observation.kind === 'chart' ? 'visual' : 'visual',
          timeRange: {
            startSecs: observedFrames[0].timestampSecs,
            endSecs: observedFrames.at(-1)!.timestampSecs,
            precision: observedFrames.every((frame) => frame.timestampPrecision === 'frame')
              ? 'frame'
              : 'estimated',
          },
          payload: { text: observation.value, inspectionPurpose: purpose },
          source: { kind: 'provider', provider: 'configured-vision' },
          confidence: {
            score: observation.confidence,
            source: 'provider',
            calibrationStatus: 'uncalibrated',
            coverage: result.actualRange.endSecs - result.actualRange.startSecs,
            uncertaintyReasons: observation.uncertaintyReasons,
          },
          observation: { kind: observation.kind, value: stateValue },
        });
        previousContext = observation.value.slice(-500);
      }
    }
    if (evidence.length === 0) {
      return NextResponse.json(
        {
          error: 'Inspection produced no validated visual evidence.',
          inspectionDecision: decision,
        },
        { status: 422 },
      );
    }
    const refinement = await appendVideoKnowledgeRefinement({ mediaAssetId, evidence });
    await updateMediaAsset(mediaAssetId, {
      activeVideoKnowledgeRevisionId: refinement.revision.id,
      activeVideoKnowledgeManifestId: refinement.manifest.id,
    });
    void trackUsageEvent({
      type: 'media_processing',
      mediaType: 'video',
      mediaOperation: 'inspection',
      durationSecs: result.actualRange.endSecs - result.actualRange.startSecs,
      frameCount: result.frames.length,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({
      inspectionDecision: decision,
      actualRange: result.actualRange,
      revisionId: refinement.revision.id,
      evidence: refinement.built.evidenceIds.map((id, index) => ({
        evidenceId: id,
        startSecs: evidence[index].timeRange.startSecs,
        endSecs: evidence[index].timeRange.endSecs,
        precision: evidence[index].timeRange.precision,
      })),
    });
  } catch (error) {
    await settleInspectionBudget(reservation.id, 'released').catch(() => {});
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Inspection failed.' },
      { status: 500 },
    );
  } finally {
    await settleInspectionBudget(reservation.id, 'consumed').catch(() => {});
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Executes the exact, approved refinement plan in bounded 30-second requests.
 * Each request remains subject to the same tool, validation, and evidence
 * activation path as a user-initiated inspection.
 */
export async function executeApprovedBackgroundRefinement(jobId: string) {
  const job = await claimBackgroundRefinement(jobId);
  if (!job) return undefined;
  try {
    let sequence = 0;
    for (const item of job.coveragePlan) {
      for (let startSecs = item.startSecs; startSecs < item.endSecs; startSecs += 30) {
        const endSecs = Math.min(item.endSecs, startSecs + 30);
        const response = await inspectMedia(
          new Request('http://larkup.internal/api/media/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mediaAssetId: job.mediaAssetId,
              startSecs,
              endSecs,
              purpose: item.purpose,
              maxFrames: 24,
              queryId: `${job.queryId}:background:${sequence++}`,
            }),
          }),
        );
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            detail.error || `Background inspection failed with HTTP ${response.status}.`,
          );
        }
      }
    }
    return await finishBackgroundRefinement(job.id, 'completed');
  } catch (error) {
    return await finishBackgroundRefinement(
      job.id,
      'failed',
      error instanceof Error ? error.message : 'Background refinement failed.',
    );
  }
}

function tryParseStateValue(
  value: string,
): string | { subject: string; property: string; value: string } {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.subject === 'string' &&
      typeof parsed.property === 'string' &&
      parsed.value !== undefined
    ) {
      return { subject: parsed.subject, property: parsed.property, value: String(parsed.value) };
    }
  } catch {}
  return value;
}
