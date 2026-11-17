import { describe, it, expect, vi } from 'vitest';
import { attachVideoIntelligenceAgentClient } from './agent';
import { VideoIntelligenceClient } from './client';
vi.mock('@larkup/core/analytics-store', () => ({ trackUsageEvent: vi.fn() }));

describe('source-authored temporal evidence', () => {
  it('keeps an early spoken introduction beside a later reconciled trajectory', async () => {
    const record = (id: string, at: number, text: string, modality = 'computed') => ({
      evidence: {
        id,
        modality,
        timeRange: { startSecs: at, endSecs: at + 5 },
        payload: { text },
        confidence: { score: 0.9 },
        createdAt: '2026-01-01',
        source: {
          kind: 'provider',
          provider: modality === 'computed' ? 'video-intelligence-index' : 'transcription',
        },
      },
    });
    const early = record(
      'early-source',
      12,
      'The first process is introduced briefly.',
      'transcript',
    );
    const states = [100, 450, 850].map((at, i) =>
      record(`state-${i}`, at, `Reconciled state: phase ${i}.`),
    );
    const search = vi.fn(async (_id, _q, _limit, options) =>
      options?.modalities?.includes('transcript') ? [early] : states,
    );
    const client = attachVideoIntelligenceAgentClient(
      new VideoIntelligenceClient({ mode: 'local-docker' }),
      vi.fn(),
    );
    const result: any = await client.queryVideoEvidence(
      {
        mediaAssetId: 'source',
        query: 'In which order were the processes introduced?',
        investigation: { scope: 'temporal', goal: 'trace', evidence: ['speech', 'computed'] },
      },
      {
        mediaEvidence: {
          getAsset: async () => ({
            id: 'source',
            type: 'video',
            processingStatus: 'completed',
            durationSecs: 1000,
          }),
          planQuestion: () => ({
            kinds: ['state-change'],
            modalities: ['transcript', 'computed'],
            requiresBothRanges: true,
            requiresBroadCoverage: false,
            requiresInspectionWhenInsufficient: false,
          }),
          search,
        },
      } as any,
    );
    expect(result.temporalContext.sourceReadings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ atSecs: 12, text: 'The first process is introduced briefly.' }),
      ]),
    );
    expect(result.temporalContext.readings.length).toBeGreaterThan(0);
  });
});
