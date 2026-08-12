import { describe, expect, it } from 'vitest';
import { lastUserMessage, normalizeAgentMessages } from './protocol';

describe('normalizeAgentMessages', () => {
  it('passes flat { role, content } messages through unchanged (TASK 04 SDK shape)', () => {
    expect(
      normalizeAgentMessages([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('flattens AI SDK UIMessage parts (widget useChat shape)', () => {
    expect(
      normalizeAgentMessages([
        {
          id: 'm1',
          role: 'user',
          parts: [
            { type: 'text', text: 'What is ' },
            { type: 'text', text: 'Larkup?' },
          ],
        },
      ]),
    ).toEqual([{ role: 'user', content: 'What is Larkup?' }]);
  });

  it('drops non-text parts so a client cannot forge tool results', () => {
    expect(
      normalizeAgentMessages([
        {
          role: 'assistant',
          parts: [
            { type: 'tool-search', state: 'output-available', output: { secret: 'leak' } },
            { type: 'reasoning', text: 'internal' },
            { type: 'text', text: 'Answer.' },
          ],
        },
      ]),
    ).toEqual([{ role: 'assistant', content: 'Answer.' }]);
  });

  it('prefers content when both content and parts are present', () => {
    expect(
      normalizeAgentMessages([
        { role: 'user', content: 'flat wins', parts: [{ type: 'text', text: 'parts' }] },
      ]),
    ).toEqual([{ role: 'user', content: 'flat wins' }]);
  });

  it('maps legacy assistant role aliases', () => {
    expect(normalizeAgentMessages([{ role: 'ai', content: 'x' }])).toEqual([
      { role: 'assistant', content: 'x' },
    ]);
  });

  it('drops malformed entries instead of throwing', () => {
    expect(
      normalizeAgentMessages([
        null,
        'nope',
        { role: 'user' },
        { role: 'weird', content: 'x' },
        { role: 'user', content: '   ' },
        { role: 'user', content: 'kept' },
      ]),
    ).toEqual([{ role: 'user', content: 'kept' }]);
  });

  it('returns an empty array for a non-array payload', () => {
    expect(normalizeAgentMessages(undefined)).toEqual([]);
    expect(normalizeAgentMessages({ messages: [] })).toEqual([]);
  });
});

describe('lastUserMessage', () => {
  it('returns the most recent user turn', () => {
    expect(
      lastUserMessage([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
      ]),
    ).toBe('second');
  });

  it('returns an empty string when there is no user turn', () => {
    expect(lastUserMessage([{ role: 'system', content: 'x' }])).toBe('');
  });
});
