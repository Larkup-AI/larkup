import { describe, expect, it, vi } from 'vitest';
import { AGENT_TOOLS, attachVideoIntelligenceAgentClient } from './agent';
import { VideoIntelligenceClient } from './client';

describe('Video Intelligence chat extension', () => {
  it('declares its agent action and generic evidence-refinement workflow', () => {
    expect(AGENT_TOOLS).toEqual([
      expect.objectContaining({
        name: 'inspectVideoKnowledge',
        method: 'inspectVideoKnowledge',
        workflow: 'evidence-refinement',
      }),
    ]);
  });

  it('owns a bounded host inspection request and carries project and progress context', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ evidence: [{ id: 'fresh-evidence' }], status: 'completed' }),
    ) as any;
    const client = attachVideoIntelligenceAgentClient(
      new VideoIntelligenceClient({ mode: 'local-docker', fetch: fetcher }),
      fetcher,
    );

    const result = await client.inspectVideoKnowledge(
      {
        mediaAssetId: 'media-1',
        startSecs: 0,
        endSecs: 120,
        purpose: 'verify-visual',
        queryId: 'question-1',
      },
      {
        origin: 'https://larkup.example.test',
        projectId: 'project-1',
        toolCallId: 'call-1',
      },
    );

    expect(result).toMatchObject({ success: true, evidence: [{ id: 'fresh-evidence' }] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'https://larkup.example.test/api/media/inspect?projectId=project-1',
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      startSecs: 60,
      endSecs: 120,
      toolCallId: 'call-1',
    });
  });
});
