import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consoleSink,
  emitAgentEvent,
  redactEventPayload,
  setEventSink,
  type AgentEvent,
} from './observability';

afterEach(() => setEventSink(consoleSink));

function capture(): AgentEvent[] {
  const events: AgentEvent[] = [];
  setEventSink((event) => events.push(event));
  return events;
}

describe('redactEventPayload', () => {
  it('drops values whose key names a credential', () => {
    expect(
      redactEventPayload({ botToken: '123:AAreal', apiKey: 'sk-live', label: 'Docs' }),
    ).toEqual({ botToken: '[redacted]', apiKey: '[redacted]', label: 'Docs' });
  });

  it('scrubs a credential pasted into a free-text message', () => {
    const redacted = redactEventPayload({
      error: 'request failed with sk-proj-abcdefghijklmnopqrstuvwxyz123456',
    }) as { error: string };

    expect(redacted.error).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456');
    expect(redacted.error).toContain('[redacted]');
  });

  it('scrubs a bearer header echoed into an error', () => {
    const redacted = redactEventPayload({
      detail: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    }) as { detail: string };
    expect(redacted.detail).toContain('[redacted]');
  });

  it('scrubs a telegram bot token anywhere in the payload', () => {
    const redacted = redactEventPayload({
      url: 'https://api.telegram.org/bot123456789:AAHrandomtokenvaluegoeshere12345/sendMessage',
    }) as { url: string };
    expect(redacted.url).not.toContain('AAHrandomtokenvaluegoeshere12345');
  });

  it('redacts nested structures', () => {
    const redacted = redactEventPayload({
      channel: { settings: { webhookSecret: 'shh', mode: 'private' } },
    }) as Record<string, any>;

    expect(redacted.channel.settings.webhookSecret).toBe('[redacted]');
    expect(redacted.channel.settings.mode).toBe('private');
  });

  it('bounds depth so a hostile object cannot hang the logger', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 40; i += 1) {
      const next = {};
      cursor.next = next;
      cursor = next as Record<string, unknown>;
    }
    expect(() => redactEventPayload(deep)).not.toThrow();
  });

  it('caps long arrays', () => {
    const redacted = redactEventPayload(Array.from({ length: 500 }, (_, i) => i)) as unknown[];
    expect(redacted.length).toBe(50);
  });

  it('leaves ordinary values alone', () => {
    expect(redactEventPayload({ tokens: 1200, model: 'gpt-4o-mini', ok: true })).toEqual({
      // "tokens" matches the credential key pattern — a deliberate false
      // positive: losing a token count beats leaking an auth token.
      tokens: '[redacted]',
      model: 'gpt-4o-mini',
      ok: true,
    });
  });
});

describe('emitAgentEvent', () => {
  it('emits a correlated, timestamped event', () => {
    const events = capture();
    emitAgentEvent('run.started', { agentId: 'a1', runId: 'r1', releaseId: 'rel1' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'run.started',
      level: 'info',
      correlation: { agentId: 'a1', runId: 'r1', releaseId: 'rel1' },
    });
    expect(Date.parse(events[0].timestamp)).not.toBeNaN();
  });

  it('defaults failures and denials to warn', () => {
    const events = capture();
    emitAgentEvent('run.failed', { agentId: 'a1' });
    emitAgentEvent('security.origin_denied', { agentId: 'a1' });

    expect(events.map((e) => e.level)).toEqual(['warn', 'warn']);
  });

  it('redacts the payload on the way out', () => {
    const events = capture();
    emitAgentEvent('channel.delivered', { agentId: 'a1' }, { payload: { botToken: 'secret' } });

    expect(events[0].payload?.botToken).toBe('[redacted]');
  });

  it('never lets a broken sink break the request it describes', () => {
    setEventSink(() => {
      throw new Error('collector is down');
    });

    expect(() => emitAgentEvent('run.completed', { agentId: 'a1' })).not.toThrow();
  });

  it('records a duration when one is supplied', () => {
    const events = capture();
    emitAgentEvent('model.called', { agentId: 'a1' }, { durationMs: 1234 });
    expect(events[0].durationMs).toBe(1234);
  });
});

describe('consoleSink', () => {
  it('routes by level and writes one JSON line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      consoleSink({
        name: 'run.started',
        timestamp: new Date().toISOString(),
        level: 'info',
        correlation: { agentId: 'a1' },
      });
      consoleSink({
        name: 'run.failed',
        timestamp: new Date().toISOString(),
        level: 'error',
        correlation: { agentId: 'a1' },
      });

      expect(log).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledOnce();
      expect(() => JSON.parse(log.mock.calls[0][0] as string)).not.toThrow();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
