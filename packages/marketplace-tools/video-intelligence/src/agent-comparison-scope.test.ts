import { describe, expect, it, vi } from 'vitest';
import { attachVideoIntelligenceAgentClient } from './agent';
import { VideoIntelligenceClient } from './client';

vi.mock('@larkup/core/analytics-store', () => ({ trackUsageEvent: vi.fn() }));

describe('comparison inspection scope', () => {
  it.each([
    [220, true],
    [1720, true],
    [220, false],
    [1720, false],
  ] as const)('keeps transition at %s local (explicit range: %s)', async (at, explicit) => {
    const reWatch = vi.fn(async () => []);
    const fetcher = vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 }));
    const range = { startSecs: at, endSecs: at + 24 };
    await attachVideoIntelligenceAgentClient(
      new VideoIntelligenceClient({ mode: 'local-docker' }),
      fetcher,
    ).queryVideoEvidence(
      {
        mediaAssetId: 'assembly',
        query: 'What changes when the display switches?',
        investigation: {
          scope: 'temporal',
          goal: 'compare',
          ...(explicit ? { timeRange: range } : {}),
        },
      },
      {
        origin: 'https://example.test',
        mediaEvidence: {
          getAsset: async () => ({
            id: 'assembly',
            type: 'video',
            processingStatus: 'completed',
            durationSecs: 2400,
          }),
          planQuestion: (_query: string, investigation: unknown) => ({
            kinds: ['comparison'],
            modalities: ['visual'],
            requiresBothRanges: true,
            requiresInspectionWhenInsufficient: true,
            investigation,
          }),
          search: async () => [
            {
              evidence: {
                id: 'scene',
                modality: 'visual',
                timeRange: range,
                payload: { text: 'The display is visible; the requested change is unresolved.' },
                confidence: { score: 0.9 },
                createdAt: '2026-01-01',
              },
            },
          ],
          reWatch,
        },
      } as any,
    );
    expect(reWatch).toHaveBeenCalled();
    const ranges = reWatch.mock.calls[0][2] as Array<{ startSecs: number; endSecs: number }>;
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.every((r) => r.startSecs >= at - 60 && r.endSecs <= at + 84)).toBe(true);
  });
});
