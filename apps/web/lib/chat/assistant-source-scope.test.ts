import { describe, expect, it } from 'vitest';
import type { SourceDocument } from '@larkup/core/types';
import { assistantSourceScopeFingerprint } from './assistant-source-scope';

const document: SourceDocument = {
  id: 'preference-1',
  title: 'Preferences',
  content: 'Favorite anime: Naruto.',
  source: 'text',
  charCount: 23,
  groupId: 'default',
  enabled: true,
  status: 'indexed',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('Assistant source scope fingerprint', () => {
  it('is stable across document ordering', () => {
    const another = { ...document, id: 'preference-2', content: 'Favorite color: blue.' };
    expect(assistantSourceScopeFingerprint([document, another])).toBe(
      assistantSourceScopeFingerprint([another, document]),
    );
  });

  it('changes when source content, availability, or Assistant configuration changes', () => {
    const baseline = assistantSourceScopeFingerprint([document], {
      configUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(
      assistantSourceScopeFingerprint([{ ...document, content: 'Favorite anime: Frieren.' }], {
        configUpdatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).not.toBe(baseline);
    expect(
      assistantSourceScopeFingerprint([], { configUpdatedAt: '2026-01-01T00:00:00.000Z' }),
    ).not.toBe(baseline);
    expect(
      assistantSourceScopeFingerprint([document], {
        configUpdatedAt: '2026-01-02T00:00:00.000Z',
      }),
    ).not.toBe(baseline);
  });
});
