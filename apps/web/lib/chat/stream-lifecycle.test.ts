import { describe, expect, it } from 'vitest';
import { assistantReplyCanClose } from './stream-lifecycle';

describe('assistantReplyCanClose', () => {
  it('accepts visible text after all tool outputs settled', () => {
    expect(
      assistantReplyCanClose({
        role: 'assistant',
        parts: [
          { type: 'tool-searchKnowledgeBase', state: 'output-available' },
          { type: 'text', text: 'The second side finished ahead.' },
        ],
      }),
    ).toBe(true);
  });

  it('keeps the stream open while a tool is active or no answer exists', () => {
    expect(
      assistantReplyCanClose({
        role: 'assistant',
        parts: [
          { type: 'tool-queryVideoEvidence', state: 'input-available' },
          { type: 'text', text: 'Working' },
        ],
      }),
    ).toBe(false);
    expect(assistantReplyCanClose({ role: 'assistant', parts: [] })).toBe(false);
  });
});
