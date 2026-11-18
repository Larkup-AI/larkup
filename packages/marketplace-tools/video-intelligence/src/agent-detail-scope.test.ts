import { describe, expect, it, vi } from 'vitest';
import { attachVideoIntelligenceAgentClient } from './agent';
import { VideoIntelligenceClient } from './client';

vi.mock('@larkup/core/analytics-store', () => ({ trackUsageEvent: vi.fn() }));

describe('source search for an unresolved detail', () => {
  it.each(['resolve', 'compare'] as const)(
    'does not treat source coverage as verification (%s)',
    async (goal) => {
      const reWatch = vi.fn(async () => [
        {
          range: { startSecs: 320, endSecs: 340 },
          at: '5:20–5:40',
          found:
            'The same numbered panel changes from matte to reflective beside the striped support.',
          read: ['17'],
          confidence: 'high',
          settlesQuestion: true,
        },
      ]);
      const query = 'What changes on panel 17 beside the striped support?';
      const result: any = await attachVideoIntelligenceAgentClient(
        new VideoIntelligenceClient({ mode: 'local-docker' }),
        vi.fn(),
      ).queryVideoEvidence(
        {
          mediaAssetId: 'independent-workshop',
          query,
          investigation: { scope: 'source', goal, evidence: ['visual'] },
        },
        {
          mediaEvidence: {
            getAsset: async () => ({
              id: 'independent-workshop',
              type: 'video',
              processingStatus: 'completed',
              durationSecs: 1800,
            }),
            planQuestion: (_q: string, investigation: unknown) => ({
              kinds: ['coverage', goal === 'resolve' ? 'outcome' : 'comparison'],
              modalities: ['visual'],
              requiresBothRanges: true,
              requiresInspectionWhenInsufficient: true,
              requiresBroadCoverage: true,
              investigation,
            }),
            search: async () =>
              [0, 50, 330, 800, 1200, 1700].map((at) => ({
                evidence: {
                  id: `indexed-${at}`,
                  modality: 'computed',
                  timeRange: { startSecs: at, endSecs: at === 0 ? 1800 : at + 10 },
                  payload: {
                    text: 'Reconciled event: An operator and a panel are visible; finish not recorded.',
                  },
                  confidence: { score: 0.95 },
                  createdAt: '2026-01-01',
                },
                components: { semantic: 0.9 },
              })),
            locate: async () => [{ startSecs: 320, endSecs: 340 }],
            reWatch,
          },
        } as any,
      );
      expect(reWatch).toHaveBeenCalled();
      expect(reWatch.mock.calls[0][2][0]).toMatchObject({ startSecs: 320, endSecs: 340 });
      expect(result.claimVerification.directlyEstablished).toBe(true);
      expect(result.directObservation.readings[0].found).toContain('reflective');
      expect(result.continuation).toBeUndefined();
      expect(reWatch.mock.calls[0][2].every((r: any) => r.endSecs - r.startSecs <= 60)).toBe(true);
    },
  );
});

describe('healthy but incomplete direct readings', () => {
  it.each(['resolve', 'compare'] as const)(
    'keeps a partial observation without confirming the missing claim (%s)',
    async (goal) => {
      const fetcher = vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 }));
      const result: any = await attachVideoIntelligenceAgentClient(
        new VideoIntelligenceClient({ mode: 'local-docker' }),
        fetcher,
      ).queryVideoEvidence(
        {
          mediaAssetId: 'control-room',
          query: 'What is printed on the badge?',
          investigation: {
            scope: 'focused',
            goal,
            evidence: ['visual'],
            timeRange: { startSecs: 12, endSecs: 20 },
          },
        },
        {
          origin: 'https://example.test',
          mediaEvidence: {
            getAsset: async () => ({
              id: 'control-room',
              type: 'video',
              processingStatus: 'completed',
              durationSecs: 60,
            }),
            planQuestion: (_q: string, investigation: unknown) => ({
              kinds: ['visual-fact'],
              modalities: ['visual'],
              requiresInspectionWhenInsufficient: true,
              investigation,
            }),
            search: async () => [],
            reWatch: async () => [
              {
                range: { startSecs: 12, endSecs: 20 },
                at: '0:12–0:20',
                found: 'The requested badge is visible but its lettering is occluded.',
                read: [],
                confidence: 'high',
                settlesQuestion: false,
                coverageComplete: false,
              },
            ],
          },
        } as any,
      );
      expect(result.success).toBe(true);
      expect(result.claimVerification.directlyEstablished).toBe(false);
      expect(result.directObservation.readings[0].found).toContain('occluded');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
