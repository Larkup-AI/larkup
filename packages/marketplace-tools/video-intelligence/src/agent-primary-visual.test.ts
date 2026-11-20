import { describe, expect, it, vi } from 'vitest';
import { attachVideoIntelligenceAgentClient } from './agent';
import { VideoIntelligenceClient } from './client';

vi.mock('@larkup/core/analytics-store', () => ({ trackUsageEvent: vi.fn() }));

describe('primary visual evidence beside reconciled accounts', () => {
  it('delivers a source-described action when computed notes occupy the ranked results', async () => {
    const hit = (id: string, modality: string, at: number, text: string) => ({
      evidence: {
        id,
        modality,
        timeRange: { startSecs: at, endSecs: at + 3 },
        payload: { text },
        confidence: { score: 0.9 },
        createdAt: '2026-01-01',
        source: {
          kind: 'provider',
          provider:
            modality === 'visual' ? 'video-intelligence-vision' : 'video-intelligence-index',
        },
      },
    });
    const summary = Array.from({ length: 16 }, (_, i) =>
      hit(`summary-${i}`, 'computed', i * 5, `Reconciled state: work station phase ${i}.`),
    );
    const primary = hit(
      'primary-action',
      'visual',
      6,
      'Visible subject: {"identity":"operator in blue","identityBasis":"source-described"}\n' +
        'Happened: operator in blue places the tool on the bench.\nDirect component: The tool rests beside the panel.',
    );
    const search = vi.fn(async (_id, _q, _limit, options) =>
      options?.modalities?.length === 1 && options.modalities[0] === 'visual' ? [primary] : summary,
    );
    const result: any = await attachVideoIntelligenceAgentClient(
      new VideoIntelligenceClient({ mode: 'local-docker' }),
      vi.fn(),
    ).queryVideoEvidence(
      {
        mediaAssetId: 'independent-source',
        query: 'How does the operator react after the first cycle?',
        limit: 12,
      },
      {
        mediaEvidence: {
          getAsset: async () => ({
            id: 'independent-source',
            type: 'video',
            processingStatus: 'completed',
            durationSecs: 100,
          }),
          planQuestion: () => ({
            kinds: ['visual-fact'],
            modalities: ['visual', 'computed'],
            requiresInspectionWhenInsufficient: false,
          }),
          search,
        },
      } as any,
    );
    expect(result.evidence.map((e: any) => e.id)).toContain('primary-action');
    expect(result.evidence.find((e: any) => e.id === 'primary-action').payload.text).toContain(
      'places the tool on the bench',
    );
    expect(result.evidence.some((e: any) => e.modality === 'computed')).toBe(true);
    expect(result.evidence.length).toBeLessThanOrEqual(12);
  });
});

describe('resolving an unresolved detail', () => {
  it('watches the located scene rather than treating a relevant account as the requested fact', async () => {
    const reWatch = vi.fn(async () => []);
    const fetcher = vi.fn(async () => Response.json({ success: false, error: 'unavailable' }));
    const result: any = await attachVideoIntelligenceAgentClient(
      new VideoIntelligenceClient({ mode: 'local-docker' }),
      fetcher,
    ).queryVideoEvidence(
      {
        mediaAssetId: 'workshop',
        query: 'What symbol is engraved on the handle?',
        investigation: {
          scope: 'focused',
          goal: 'resolve',
          evidence: ['visual'],
          timeRange: { startSecs: 20, endSecs: 25 },
        },
      },
      {
        origin: 'http://example.test',
        mediaEvidence: {
          getAsset: async () => ({
            id: 'workshop',
            type: 'video',
            processingStatus: 'completed',
            durationSecs: 80,
          }),
          planQuestion: (_query: string, investigation: any) => ({
            kinds: ['visual-fact'],
            modalities: ['visual'],
            requiresInspectionWhenInsufficient: true,
            investigation,
          }),
          search: async () => [
            {
              evidence: {
                id: 'scene',
                modality: 'visual',
                timeRange: { startSecs: 20, endSecs: 25 },
                payload: { text: 'An operator holds a metal handle beside a workbench.' },
                confidence: { score: 0.95 },
                createdAt: '2026-01-01',
              },
              components: { semantic: 0.9 },
            },
          ],
          reWatch,
        },
      } as any,
    );
    expect(reWatch).toHaveBeenCalled();
    expect(result.claimVerification.directlyEstablished).toBe(false);
  });
});
