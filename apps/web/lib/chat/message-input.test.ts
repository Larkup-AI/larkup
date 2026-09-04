import { describe, expect, it } from 'vitest';
import { normalizeIncomingMessages } from './message-input';

describe('normalizeIncomingMessages', () => {
  it('accepts the curl-friendly role/content message shape', () => {
    expect(normalizeIncomingMessages([{ role: 'user', content: 'hi' }])).toEqual([
      expect.objectContaining({
        id: 'incoming-0',
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
      }),
    ]);
  });

  it('drops null parts and messages without usable content', () => {
    expect(
      normalizeIncomingMessages([
        { id: 'one', role: 'user', parts: [undefined, { type: 'text', text: 'question' }] },
        { role: 'assistant', parts: [null] },
        { role: 'unknown', content: 'ignored' },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: 'one',
        role: 'user',
        parts: [{ type: 'text', text: 'question' }],
      }),
    ]);
  });
});
