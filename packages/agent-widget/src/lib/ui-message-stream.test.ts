import { describe, expect, it } from 'vitest';
import { applyChunk, createTurnState, parseSseBuffer } from './ui-message-stream';

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Fold a whole conversation of chunks, the way the reader does at runtime. */
function fold(chunks: unknown[]) {
  return chunks.reduce(applyChunk, createTurnState());
}

describe('parseSseBuffer', () => {
  it('decodes complete frames and keeps the partial tail', () => {
    const buffer = frame({ type: 'text-delta', id: '0', delta: 'Hel' }) + 'data: {"type":"text-de';
    const result = parseSseBuffer(buffer);

    expect(result.chunks).toEqual([{ type: 'text-delta', id: '0', delta: 'Hel' }]);
    expect(result.rest).toBe('data: {"type":"text-de');
    expect(result.done).toBe(false);
  });

  it('returns the whole buffer as rest when no frame is complete', () => {
    const result = parseSseBuffer('data: {"type":"star');
    expect(result.chunks).toEqual([]);
    expect(result.rest).toBe('data: {"type":"star');
  });

  it('recognizes the [DONE] sentinel', () => {
    const result = parseSseBuffer(frame({ type: 'finish' }) + 'data: [DONE]\n\n');
    expect(result.done).toBe(true);
    expect(result.chunks).toEqual([{ type: 'finish' }]);
  });

  it('normalizes CRLF framing from proxies', () => {
    const result = parseSseBuffer('data: {"type":"finish"}\r\n\r\n');
    expect(result.chunks).toEqual([{ type: 'finish' }]);
  });

  it('ignores comments and non-data SSE fields', () => {
    const result = parseSseBuffer(': keep-alive\n\nevent: ping\ndata: {"type":"finish"}\n\n');
    expect(result.chunks).toEqual([{ type: 'finish' }]);
  });

  it('drops an undecodable frame instead of throwing', () => {
    const result = parseSseBuffer('data: {not json}\n\n' + frame({ type: 'finish' }));
    expect(result.chunks).toEqual([{ type: 'finish' }]);
  });
});

describe('applyChunk', () => {
  it('accumulates streamed text in order', () => {
    const state = fold([
      { type: 'start' },
      { type: 'text-start', id: '0' },
      { type: 'text-delta', id: '0', delta: 'Hello' },
      { type: 'text-delta', id: '0', delta: ', world' },
      { type: 'text-end', id: '0' },
      { type: 'finish' },
    ]);

    expect(state.text).toBe('Hello, world');
    expect(state.finished).toBe(true);
    expect(state.blocks).toEqual([]);
  });

  it('ignores unknown chunk types without breaking the turn', () => {
    const state = fold([
      { type: 'text-delta', id: '0', delta: 'a' },
      { type: 'some-future-chunk', payload: 1 },
      { type: 'text-delta', id: '0', delta: 'b' },
    ]);
    expect(state.text).toBe('ab');
  });

  it('does not render reasoning as answer text', () => {
    const state = fold([
      { type: 'reasoning-start', id: 'r' },
      { type: 'reasoning-delta', id: 'r', delta: 'internal chain of thought' },
      { type: 'reasoning-end', id: 'r' },
      { type: 'text-delta', id: '0', delta: 'Answer' },
    ]);
    expect(state.text).toBe('Answer');
  });

  it('flips a tool status block from running to done in place', () => {
    const running = fold([{ type: 'tool-input-start', toolCallId: 't1', toolName: 'search_docs' }]);
    expect(running.blocks).toEqual([
      { key: 'tool:t1', type: 'status', label: 'search_docs', state: 'running' },
    ]);

    const done = applyChunk(running, {
      type: 'tool-output-available',
      toolCallId: 't1',
      output: {},
    });
    expect(done.blocks).toHaveLength(1);
    expect(done.blocks[0]).toMatchObject({ key: 'tool:t1', state: 'done', label: 'search_docs' });
  });

  it('marks a failed tool call as an error status', () => {
    const state = fold([
      { type: 'tool-input-start', toolCallId: 't1', toolName: 'search_docs', title: 'Search docs' },
      { type: 'tool-output-error', toolCallId: 't1', errorText: 'timeout' },
    ]);
    expect(state.blocks[0]).toMatchObject({ state: 'error', label: 'Search docs' });
  });

  it('turns sources into citation blocks', () => {
    const state = fold([
      { type: 'source-url', sourceId: 's1', url: 'https://acme.com/faq', title: 'FAQ' },
      { type: 'source-document', sourceId: 's2', title: 'Handbook', mediaType: 'application/pdf' },
    ]);
    expect(state.blocks).toEqual([
      { key: 'source:s1', type: 'citation', label: 'FAQ', url: 'https://acme.com/faq' },
      { key: 'source:s2', type: 'citation', label: 'Handbook', url: undefined },
    ]);
  });

  it('renders a data-* table payload as a table block', () => {
    const state = fold([
      {
        type: 'data-report',
        id: 'd1',
        data: { type: 'table', columns: ['Plan', 'Seats'], rows: [['Pro', 5]] },
      },
    ]);
    expect(state.blocks[0]).toEqual({
      key: 'data:d1',
      type: 'table',
      columns: ['Plan', 'Seats'],
      rows: [['Pro', 5]],
    });
  });

  it('falls back to a generic data block for unrecognized data-* payloads', () => {
    const state = fold([{ type: 'data-weather', id: 'd2', data: { tempC: 21 } }]);
    expect(state.blocks[0]).toEqual({
      key: 'data:d2',
      type: 'data',
      label: 'weather',
      json: { tempC: 21 },
    });
  });

  it('captures a server error and ends the turn', () => {
    const state = fold([
      { type: 'text-delta', id: '0', delta: 'partial' },
      { type: 'error', errorText: 'model unavailable' },
    ]);
    expect(state.errorText).toBe('model unavailable');
    expect(state.finished).toBe(true);
    expect(state.text).toBe('partial');
  });

  it('records an aborted run', () => {
    const state = fold([{ type: 'abort', reason: 'client disconnect' }]);
    expect(state.aborted).toBe(true);
    expect(state.finished).toBe(true);
  });

  it('returns the identical state object when a chunk changes nothing', () => {
    const before = createTurnState();
    expect(applyChunk(before, { type: 'start-step' })).toBe(before);
    expect(applyChunk(before, null)).toBe(before);
    expect(applyChunk(before, 'nonsense')).toBe(before);
  });
});
