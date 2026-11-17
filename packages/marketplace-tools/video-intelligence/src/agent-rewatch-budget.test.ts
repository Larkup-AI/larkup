import { describe, expect, it, vi } from 'vitest';
import { attachVideoIntelligenceAgentClient } from './agent';
import { VideoIntelligenceClient } from './client';

vi.mock('@larkup/core/analytics-store', () => ({ trackUsageEvent: vi.fn() }));

describe('bounded visual read deadline', () => {
  it('accepts a healthy provider response before spending the remaining turn on indexing', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 }));
      const range = { startSecs: 5, endSecs: 15 };
      const reWatch = vi.fn(
        async (_id: string, _question: string, _ranges: unknown, options: { maxWaitMs: number }) =>
          new Promise<any[]>((resolve) => {
            setTimeout(
              () =>
                resolve([
                  {
                    range,
                    at: '0:05–0:15',
                    found: 'The dial reads seven.',
                    read: ['7'],
                    confidence: 'high',
                    settlesQuestion: true,
                  },
                ]),
              18_000,
            );
            setTimeout(() => resolve([]), options.maxWaitMs);
          }),
      );
      const promise = attachVideoIntelligenceAgentClient(
        new VideoIntelligenceClient({ mode: 'local-docker' }),
        fetcher,
      ).queryVideoEvidence(
        {
          mediaAssetId: 'panel',
          query: 'What does the dial read?',
          investigation: {
            scope: 'focused',
            goal: 'resolve',
            evidence: ['visual'],
            timeRange: range,
          },
        },
        {
          origin: 'https://example.test',
          mediaEvidence: {
            getAsset: async () => ({
              id: 'panel',
              type: 'video',
              processingStatus: 'completed',
              durationSecs: 60,
            }),
            planQuestion: (_query: string, investigation: unknown) => ({
              kinds: ['visual-fact'],
              modalities: ['visual'],
              requiresInspectionWhenInsufficient: true,
              investigation,
            }),
            search: async () => [],
            reWatch,
          },
        } as any,
      );
      await vi.advanceTimersByTimeAsync(18_000);
      const result: any = await promise;
      expect(result.investigation.answerPath).toBe('rag+rewatch');
      expect(result.directObservation.readings[0].found).toContain('seven');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
