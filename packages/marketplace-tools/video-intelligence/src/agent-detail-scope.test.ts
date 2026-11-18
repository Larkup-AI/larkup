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
          answerOptions: ['matte', 'reflective'],
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
      expect(reWatch.mock.calls[0][1]).toContain('A. matte');
      expect(reWatch.mock.calls[0][1]).toContain('B. reflective');
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

describe('source evidence for supplied alternatives', () => {
  it('finds a specific source claim when the question itself contains no topic terms', async () => {
    const query = 'What topic does this explanation cover?';
    const alternatives = [
      'Bearing wear and coolant flow',
      'Optical alignment of an inspection window',
    ];
    const search = vi.fn(async (_id: string, text: string) =>
      text === alternatives[0]
        ? [
            {
              evidence: {
                id: 'source-bearing-claim',
                modality: 'transcript',
                timeRange: { startSecs: 12, endSecs: 18 },
                payload: {
                  text: `Claim question: ${query}\nClaim verdict: direct\nClaim answer: It compares bearing wear with coolant flow through the housing.`,
                },
                confidence: { score: 0.95 },
                createdAt: '2026-01-01',
              },
            },
          ]
        : [],
    );
    const result: any = await attachVideoIntelligenceAgentClient(
      new VideoIntelligenceClient({ mode: 'local-docker' }),
      vi.fn(),
    ).queryVideoEvidence(
      {
        mediaAssetId: 'independent-maintenance',
        query,
        answerOptions: alternatives,
        investigation: { scope: 'focused', goal: 'answer', evidence: ['speech'] },
      },
      {
        mediaEvidence: {
          getAsset: async () => ({
            id: 'independent-maintenance',
            type: 'video',
            processingStatus: 'completed',
            durationSecs: 40,
          }),
          planQuestion: (_q: string, investigation: unknown) => ({
            kinds: ['direct-speech'],
            modalities: ['transcript'],
            requiresInspectionWhenInsufficient: false,
            investigation,
          }),
          search,
        },
      } as any,
    );
    expect(result.success).toBe(true);
    expect(result.evidence.some((e: any) => e.id === 'source-bearing-claim')).toBe(true);
    expect(result.claimVerification.directlyEstablished).toBe(true);
  });
});

describe('bounded whole-source synthesis', () => {
  it.each([false, true])(
    'keeps broad context without forcing a raw inventory (explicit inventory: %s)',
    async (inventory) => {
      const records = Array.from({ length: 160 }, (_, i) => ({
        evidence: {
          id: `section-${i}`,
          modality: 'transcript',
          timeRange: { startSecs: i * 10, endSecs: i * 10 + 8 },
          payload: {
            text:
              i < 80
                ? 'Claim verdict: direct\nClaim answer: Early source detail.'
                : `Later source section ${i}.`,
          },
          confidence: { score: 0.9 },
          createdAt: '2026-01-01',
        },
      }));
      const search = vi.fn(async (_id: string, _q: string, limit: number, options: any) =>
        records
          .filter(
            (r) =>
              !options?.timeRange ||
              (r.evidence.timeRange.startSecs < options.timeRange.endSecs &&
                r.evidence.timeRange.endSecs > options.timeRange.startSecs),
          )
          .slice(0, limit),
      );
      const result: any = await attachVideoIntelligenceAgentClient(
        new VideoIntelligenceClient({ mode: 'local-docker' }),
        vi.fn(),
      ).queryVideoEvidence(
        {
          mediaAssetId: 'independent-recording',
          query: 'Summarize the main themes.',
          limit: 12,
          investigation: { scope: 'source', goal: 'synthesize', evidence: ['speech'] },
          ...(inventory ? { exhaustive: true } : {}),
        },
        {
          mediaEvidence: {
            getAsset: async () => ({
              id: 'independent-recording',
              type: 'video',
              processingStatus: 'completed',
              durationSecs: 1600,
            }),
            planQuestion: (_q: string, investigation: unknown) => ({
              kinds: ['coverage'],
              modalities: ['transcript'],
              requiresBroadCoverage: true,
              requiresInspectionWhenInsufficient: false,
              investigation,
            }),
            search,
          },
        } as any,
      );
      expect(result.evidence.length).toBeLessThanOrEqual(12);
      if (inventory) expect(result.continuation.hasMore).toBe(true);
      else {
        expect(result.continuation).toBeUndefined();
        expect(result.evidence.some((e: any) => e.timeRange.startSecs >= 1400)).toBe(true);
        expect(result.evidence.some((e: any) => e.timeRange.startSecs <= 40)).toBe(true);
      }
    },
  );
});
