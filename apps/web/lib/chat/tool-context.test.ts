import { describe, expect, it } from 'vitest';
import { compactToolContextForModel, withFinalAnswerNudge } from './tool-context';

function toolResultMessage(toolName: string, output: unknown) {
  return {
    role: 'tool',
    content: [{ type: 'tool-result', toolName, output }],
  };
}

describe('compactToolContextForModel', () => {
  it('preserves the evidence-first videoEvidence field on a searchKnowledgeBase result', () => {
    // Regression: compaction only kept {query, hits}, silently dropping the
    // embedded video investigation the evidence-first shortcut relies on --
    // the model's next step then had nothing to answer a video question
    // from (observed live as a completely empty final chat response, even
    // though the video had been found correctly).
    const videoEvidence = { success: true, mediaAssetId: 'asset-1', citations: ['clip-1'] };
    const [message] = compactToolContextForModel([
      toolResultMessage('searchKnowledgeBase', {
        query: 'what crashed',
        hits: [{ documentId: 'd1', title: 't1', text: 'x'.repeat(2000) }],
        videoEvidence,
      }),
    ]);
    const output = (message.content[0] as any).output;
    expect(output.videoEvidence).toEqual(videoEvidence);
  });

  it('still bounds hits and truncates long text as before', () => {
    const manyHits = Array.from({ length: 10 }, (_, i) => ({
      documentId: `d${i}`,
      title: `t${i}`,
      text: 'x'.repeat(5_000),
    }));
    const [message] = compactToolContextForModel([
      toolResultMessage('searchKnowledgeBase', { query: 'q', hits: manyHits }),
    ]);
    const output = (message.content[0] as any).output;
    expect(output.hits).toHaveLength(4);
    expect(output.hits[0].text.length).toBe(1_200);
    expect(output.videoEvidence).toBeUndefined();
  });

  it('leaves messages without array content untouched', () => {
    const message = { role: 'user', content: 'plain text' };
    expect(compactToolContextForModel([message])).toEqual([message]);
  });

  it('still compacts queryTabularData results as before', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const [message] = compactToolContextForModel([
      toolResultMessage('queryTabularData', { columns: ['id'], rows, totalRows: 100 }),
    ]);
    const output = (message.content[0] as any).output;
    expect(output.rows).toHaveLength(50);
  });
});

describe('withFinalAnswerNudge', () => {
  it('appends one explicit user message instructing the model to answer now', () => {
    // Regression: removing every tool for the final-answer step
    // (activeTools: [], toolChoice: 'none') wasn't reliable signal on its
    // own for every model -- reproduced live with a reasoning-tagged model
    // (Claude Sonnet 4.6) on a real, evidence-heavy video question: it
    // finished with zero tool calls AND zero text, leaving the chat turn
    // silently empty despite citations already having rendered from the
    // tool result. The explicit nudge fixed it, confirmed by re-running the
    // exact same live request afterward.
    const original = [{ role: 'user', content: 'original question' }];
    const nudged = withFinalAnswerNudge(original);

    expect(nudged).toHaveLength(2);
    expect(nudged[0]).toBe(original[0]);
    expect(nudged[1].role).toBe('user');
    expect(nudged[1].content[0].text).toMatch(/answer.*now/i);
  });

  it('does not mutate the input array', () => {
    const original = [{ role: 'user', content: 'q' }];
    withFinalAnswerNudge(original);
    expect(original).toHaveLength(1);
  });
});
