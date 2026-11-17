import { describe, expect, it, vi } from 'vitest';
import { attachVideoIntelligenceAgentClient } from './agent';
import { VideoIntelligenceClient } from './client';

vi.mock('@larkup/core/analytics-store', () => ({ trackUsageEvent: vi.fn() }));

describe('complementary source readings', () => {
  it('returns both observed states without claiming either window establishes the complete comparison', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 }));
    const reWatch = vi.fn(async () => [
      {
        range: { startSecs: 10, endSecs: 60 },
        at: '0:10–1:00',
        found: 'The display shows three under MODE A.',
        read: ['MODE A', '3'],
        confidence: 'high',
        settlesQuestion: false,
      },
      {
        range: { startSecs: 60, endSecs: 110 },
        at: '1:00–1:50',
        found: 'The display shows eight under MODE B.',
        read: ['MODE B', '8'],
        confidence: 'high',
        settlesQuestion: false,
      },
    ]);
    const result: any = await attachVideoIntelligenceAgentClient(
      new VideoIntelligenceClient({ mode: 'local-docker' }),
      fetcher,
    ).queryVideoEvidence(
      {
        mediaAssetId: 'display',
        query: 'How does the display change?',
        investigation: {
          scope: 'temporal',
          goal: 'compare',
          evidence: ['visual'],
          timeRange: { startSecs: 10, endSecs: 110 },
        },
      },
      {
        origin: 'https://example.test',
        mediaEvidence: {
          getAsset: async () => ({
            id: 'display',
            type: 'video',
            processingStatus: 'completed',
            durationSecs: 120,
          }),
          planQuestion: (_query: string, investigation: unknown) => ({
            kinds: ['comparison'],
            modalities: ['visual'],
            requiresBothRanges: true,
            requiresInspectionWhenInsufficient: true,
            investigation,
          }),
          search: async () =>
            [10, 45, 90].map((at, i) => ({
              evidence: {
                id: `indexed-${i}`,
                modality: 'computed',
                timeRange: { startSecs: at, endSecs: at + 5 },
                payload: {
                  text: 'Reconciled state: A display is visible, without the requested value.',
                },
                confidence: { score: 0.95 },
                createdAt: '2026-01-01',
                source: { kind: 'provider', provider: 'video-intelligence-index' },
              },
              components: { semantic: 0.8 },
            })),
          reWatch,
        },
      } as any,
    );
    expect(result.success).toBe(true);
    expect(result.directObservation.readings).toHaveLength(2);
    expect(result.claimVerification.directlyEstablished).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
