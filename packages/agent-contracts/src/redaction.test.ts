import { describe, expect, it } from 'vitest';
import { DEFAULT_WIDGET_STYLE } from './agent';
import type { AgentDefinition } from './agent';
import { REDACTED, isRedacted, mergeAgentUpdate, redactAgentSecrets } from './redaction';

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'a1',
    name: 'Agent',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    chatProvider: 'openai',
    chatModelId: 'gpt-4o-mini',
    systemPrompt: 'You are helpful.',
    knowledgeSources: [
      { label: 'Docs', baseUrl: 'https://ks.acme.com', retrievalKey: 'sk-live-real-key' },
    ],
    enabledToolIds: [],
    enabledSkillIds: [],
    allowedOrigins: ['https://acme.com'],
    authMode: 'join-code',
    joinCode: 'sesame',
    widgetStyle: DEFAULT_WIDGET_STYLE,
    channels: {
      telegram: {
        enabled: true,
        settings: { botToken: '12345:AAreal', chatMode: 'private' },
      },
    },
    ...overrides,
  };
}

describe('redactAgentSecrets', () => {
  it('masks every stored credential', () => {
    const redacted = redactAgentSecrets(agent());

    expect(redacted.joinCode).toBe(REDACTED);
    expect(redacted.knowledgeSources[0].retrievalKey).toBe(REDACTED);
    expect(redacted.channels?.telegram.settings.botToken).toBe(REDACTED);
  });

  it('leaves non-secret fields alone', () => {
    const redacted = redactAgentSecrets(agent());

    expect(redacted.systemPrompt).toBe('You are helpful.');
    expect(redacted.knowledgeSources[0].baseUrl).toBe('https://ks.acme.com');
    expect(redacted.channels?.telegram.settings.chatMode).toBe('private');
    expect(redacted.channels?.telegram.enabled).toBe(true);
  });

  it('distinguishes "not configured" from "configured, hidden"', () => {
    const redacted = redactAgentSecrets(
      agent({
        joinCode: undefined,
        knowledgeSources: [{ label: 'D', baseUrl: 'https://x', retrievalKey: '' }],
      }),
    );

    expect(redacted.joinCode).toBeUndefined();
    expect(redacted.knowledgeSources[0].retrievalKey).toBe('');
  });

  it('does not mutate the input', () => {
    const original = agent();
    redactAgentSecrets(original);
    expect(original.joinCode).toBe('sesame');
    expect(original.knowledgeSources[0].retrievalKey).toBe('sk-live-real-key');
  });

  it('never leaves a real credential anywhere in the serialized output', () => {
    const serialized = JSON.stringify(redactAgentSecrets(agent()));
    expect(serialized).not.toContain('sk-live-real-key');
    expect(serialized).not.toContain('sesame');
    expect(serialized).not.toContain('12345:AAreal');
  });
});

describe('mergeAgentUpdate', () => {
  it('keeps the stored secret when the caller echoes the sentinel back', () => {
    const current = agent();
    const roundTripped = redactAgentSecrets(current);

    const merged = mergeAgentUpdate(current, {
      ...roundTripped,
      name: 'Renamed',
    });

    expect(merged.name).toBe('Renamed');
    expect(merged.joinCode).toBe('sesame');
    expect(merged.knowledgeSources[0].retrievalKey).toBe('sk-live-real-key');
    expect(merged.channels?.telegram.settings.botToken).toBe('12345:AAreal');
  });

  it('accepts a genuinely new secret', () => {
    const merged = mergeAgentUpdate(agent(), {
      joinCode: 'new-code',
      channels: { telegram: { enabled: true, settings: { botToken: '999:BBnew' } } },
    });

    expect(merged.joinCode).toBe('new-code');
    expect(merged.channels?.telegram.settings.botToken).toBe('999:BBnew');
  });

  it('matches knowledge sources by baseUrl so reordering cannot swap credentials', () => {
    const current = agent({
      knowledgeSources: [
        { label: 'A', baseUrl: 'https://a.com', retrievalKey: 'key-a' },
        { label: 'B', baseUrl: 'https://b.com', retrievalKey: 'key-b' },
      ],
    });

    const merged = mergeAgentUpdate(current, {
      knowledgeSources: [
        { label: 'B', baseUrl: 'https://b.com', retrievalKey: REDACTED },
        { label: 'A', baseUrl: 'https://a.com', retrievalKey: REDACTED },
      ],
    });

    expect(merged.knowledgeSources[0].retrievalKey).toBe('key-b');
    expect(merged.knowledgeSources[1].retrievalKey).toBe('key-a');
  });

  it('leaves a new source without a stored counterpart empty rather than borrowing one', () => {
    const merged = mergeAgentUpdate(agent(), {
      knowledgeSources: [
        { label: 'Docs', baseUrl: 'https://ks.acme.com', retrievalKey: REDACTED },
        { label: 'New', baseUrl: 'https://new.acme.com', retrievalKey: REDACTED },
      ],
    });

    expect(merged.knowledgeSources[0].retrievalKey).toBe('sk-live-real-key');
    expect(merged.knowledgeSources[1].retrievalKey).toBe('');
  });

  it('preserves channel settings the caller omitted entirely', () => {
    const merged = mergeAgentUpdate(agent(), {
      channels: { telegram: { enabled: false, settings: { botToken: REDACTED } } },
    });

    expect(merged.channels?.telegram.enabled).toBe(false);
    expect(merged.channels?.telegram.settings.botToken).toBe('12345:AAreal');
  });

  it('refuses to change immutable identity fields', () => {
    const merged = mergeAgentUpdate(agent(), {
      id: 'hijacked',
      createdAt: '1999-01-01T00:00:00.000Z',
    });

    expect(merged.id).toBe('a1');
    expect(merged.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(merged.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('isRedacted', () => {
  it('recognizes only the exact sentinel', () => {
    expect(isRedacted(REDACTED)).toBe(true);
    expect(isRedacted('sesame')).toBe(false);
    expect(isRedacted(undefined)).toBe(false);
    expect(isRedacted('')).toBe(false);
  });
});
