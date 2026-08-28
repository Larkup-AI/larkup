import { describe, expect, it } from 'vitest';
import { shouldAutoOpenSupportingClip } from './chat-supporting-clip';

describe('shouldAutoOpenSupportingClip', () => {
  it('opens only the first assistant message', () => {
    const messages = [{ role: 'user' }, { role: 'assistant' }, { role: 'user' }, { role: 'assistant' }];

    expect(shouldAutoOpenSupportingClip(messages, 0)).toBe(false);
    expect(shouldAutoOpenSupportingClip(messages, 1)).toBe(true);
    expect(shouldAutoOpenSupportingClip(messages, 3)).toBe(false);
  });

  it('does not open a clip when no assistant response exists yet', () => {
    expect(shouldAutoOpenSupportingClip([{ role: 'user' }], 0)).toBe(false);
  });
});
