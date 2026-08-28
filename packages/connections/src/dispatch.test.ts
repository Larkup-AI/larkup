import { describe, expect, it, vi } from 'vitest';
import { dispatchInbound, type ChannelEvent } from './dispatch';
import { MemoryIdempotencyStore } from './idempotency';
import type { ChannelAdapter, InboundRequest, OutboundMessage } from './types';

function request(overrides: Partial<InboundRequest> = {}): InboundRequest {
  return {
    method: 'POST',
    headers: {},
    rawBody: '{}',
    body: {},
    query: {},
    ...overrides,
  };
}

/** A minimal adapter whose every step can be steered from the test. */
function fakeAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter {
  return {
    id: 'fake',
    name: 'Fake',
    description: '',
    icon: '/icons/fake.png',
    supportsStreaming: false,
    configFields: [],
    verify: () => ({ ok: true }),
    parse: () => ({
      externalMessageId: 'm1',
      conversationId: 'c1',
      endUserId: 'u1',
      text: 'hello',
      replyContext: {},
    }),
    send: async () => ({ ok: true }),
    health: async () => ({ status: 'ok', detail: '' }),
    ...overrides,
  };
}

const runAgent = async () => ({ text: 'the answer' });

describe('dispatchInbound', () => {
  it('verifies, runs, and delivers the answer', async () => {
    const delivered: OutboundMessage[] = [];
    const send = vi.fn(async (message: OutboundMessage) => {
      delivered.push(message);
      return { ok: true as const, externalMessageId: 'x1' };
    });
    const events: ChannelEvent[] = [];

    const result = await dispatchInbound({
      adapter: fakeAdapter({ send }),
      agentId: 'a1',
      settings: {},
      request: request(),
      runAgent,
      idempotency: new MemoryIdempotencyStore(),
      onEvent: (e) => events.push(e),
    });

    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
    expect(delivered[0].text).toBe('the answer');
    expect(events.map((e) => e.type)).toEqual(['run.started', 'delivered']);
  });

  it('rejects an unverified request before running the agent', async () => {
    const agent = vi.fn(runAgent);
    const parse = vi.fn();

    const result = await dispatchInbound({
      adapter: fakeAdapter({
        verify: () => ({ ok: false, status: 401, reason: 'bad signature' }),
        parse,
      }),
      agentId: 'a1',
      settings: {},
      request: request(),
      runAgent: agent,
      idempotency: new MemoryIdempotencyStore(),
    });

    expect(result.status).toBe(401);
    expect(result.body.error).toBe('bad signature');
    // The whole point: verification is cheap, the agent is not.
    expect(agent).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it('acknowledges an event with nothing to answer instead of failing it', async () => {
    const agent = vi.fn(runAgent);

    const result = await dispatchInbound({
      adapter: fakeAdapter({ parse: () => null }),
      agentId: 'a1',
      settings: {},
      request: request(),
      runAgent: agent,
      idempotency: new MemoryIdempotencyStore(),
    });

    // 200, or the provider retries this forever.
    expect(result.status).toBe(200);
    expect(agent).not.toHaveBeenCalled();
  });

  it('acknowledges an unparsable payload rather than starting a retry storm', async () => {
    const result = await dispatchInbound({
      adapter: fakeAdapter({
        parse: () => {
          throw new Error('unexpected shape');
        },
      }),
      agentId: 'a1',
      settings: {},
      request: request(),
      runAgent,
      idempotency: new MemoryIdempotencyStore(),
    });

    expect(result.status).toBe(200);
  });

  it('answers a duplicate delivery only once', async () => {
    const agent = vi.fn(runAgent);
    const store = new MemoryIdempotencyStore();
    const options = {
      adapter: fakeAdapter(),
      agentId: 'a1',
      settings: {},
      request: request(),
      runAgent: agent,
      idempotency: store,
    };

    const first = await dispatchInbound(options);
    const second = await dispatchInbound(options);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(agent).toHaveBeenCalledOnce();
  });

  it('scopes de-duplication per agent so two agents can share a bot', async () => {
    const agent = vi.fn(runAgent);
    const store = new MemoryIdempotencyStore();
    const base = {
      adapter: fakeAdapter(),
      settings: {},
      request: request(),
      runAgent: agent,
      idempotency: store,
    };

    await dispatchInbound({ ...base, agentId: 'a1' });
    await dispatchInbound({ ...base, agentId: 'a2' });

    expect(agent).toHaveBeenCalledTimes(2);
  });

  it('releases the claim when the agent fails, so the provider retry works', async () => {
    const store = new MemoryIdempotencyStore();
    const agent = vi
      .fn()
      .mockRejectedValueOnce(new Error('model timeout'))
      .mockResolvedValueOnce({ text: 'recovered' });

    const options = {
      adapter: fakeAdapter(),
      agentId: 'a1',
      settings: {},
      request: request(),
      runAgent: agent,
      idempotency: store,
    };

    const first = await dispatchInbound(options);
    expect(first.status).toBe(500);

    const second = await dispatchInbound(options);
    expect(second.status).toBe(200);
    expect(agent).toHaveBeenCalledTimes(2);
  });

  it('reports 502 when the answer exists but could not be delivered', async () => {
    const events: ChannelEvent[] = [];

    const result = await dispatchInbound({
      adapter: fakeAdapter({
        send: async () => ({ ok: false, error: 'bot was blocked', retryable: false }),
      }),
      agentId: 'a1',
      settings: {},
      request: request(),
      runAgent,
      idempotency: new MemoryIdempotencyStore(),
      onEvent: (e) => events.push(e),
    });

    expect(result.status).toBe(502);
    expect(result.body.error).toBe('bot was blocked');
    expect(events.at(-1)).toMatchObject({ type: 'delivery.failed', retryable: false });
  });

  it('does not deliver an empty agent answer', async () => {
    const send = vi.fn(async () => ({ ok: true as const }));

    const result = await dispatchInbound({
      adapter: fakeAdapter({ send }),
      agentId: 'a1',
      settings: {},
      request: request(),
      runAgent: async () => ({ text: '   ' }),
      idempotency: new MemoryIdempotencyStore(),
    });

    expect(result.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it('gives the runtime a stable session id that does not leak the provider id', async () => {
    const seen: { sessionId: string; endUserId: string }[] = [];
    const options = {
      adapter: fakeAdapter(),
      agentId: 'a1',
      settings: {},
      request: request(),
      runAgent: async (input: { sessionId: string; endUserId: string }) => {
        seen.push({ sessionId: input.sessionId, endUserId: input.endUserId });
        return { text: 'ok' };
      },
      idempotency: new MemoryIdempotencyStore(),
    };

    await dispatchInbound(options);
    await dispatchInbound({
      ...options,
      adapter: fakeAdapter({
        parse: () => ({
          externalMessageId: 'm2',
          conversationId: 'c1',
          endUserId: 'u1',
          text: 'again',
          replyContext: {},
        }),
      }),
    });

    // Same conversation → same session, so context carries across turns.
    expect(seen[0].sessionId).toBe(seen[1].sessionId);
    expect(seen[0].sessionId).not.toContain('c1');
    expect(seen[0].endUserId).not.toContain('u1');
  });
});
