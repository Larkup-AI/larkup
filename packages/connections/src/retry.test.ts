import { describe, expect, it, vi } from 'vitest';
import { deliverWithRetry, parseRetryAfter } from './retry';
import { MemoryIdempotencyStore, idempotencyKey } from './idempotency';

const noSleep = async () => {};

describe('deliverWithRetry', () => {
  it('returns immediately on success', async () => {
    const deliver = vi.fn(async () => ({ ok: true as const }));
    expect(await deliverWithRetry(deliver, { sleep: noSleep })).toEqual({ ok: true });
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('does not retry a permanent failure', async () => {
    const deliver = vi.fn(async () => ({
      ok: false as const,
      error: 'bot was blocked by the user',
      retryable: false,
    }));

    const result = await deliverWithRetry(deliver, { sleep: noSleep });

    expect(result.ok).toBe(false);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('retries a transient failure and succeeds', async () => {
    const deliver = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'rate limited', retryable: true })
      .mockResolvedValueOnce({ ok: true });

    expect(await deliverWithRetry(deliver, { sleep: noSleep })).toEqual({ ok: true });
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt budget and returns the last error', async () => {
    const deliver = vi.fn(async () => ({
      ok: false as const,
      error: 'still down',
      retryable: true,
    }));

    const result = await deliverWithRetry(deliver, { attempts: 3, sleep: noSleep });

    expect(result).toMatchObject({ ok: false, error: 'still down' });
    expect(deliver).toHaveBeenCalledTimes(3);
  });

  it('treats a thrown transport error as retryable', async () => {
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ ok: true });

    expect(await deliverWithRetry(deliver, { sleep: noSleep })).toEqual({ ok: true });
  });

  it('honours a provider retry-after over its own backoff', async () => {
    const waits: number[] = [];
    const deliver = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: '429', retryable: true, retryAfterMs: 7000 })
      .mockResolvedValueOnce({ ok: true });

    await deliverWithRetry(deliver, {
      baseDelayMs: 100,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([7000]);
  });

  it('caps a hostile retry-after so one bad header cannot stall the request', async () => {
    const waits: number[] = [];
    const deliver = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: '429',
        retryable: true,
        retryAfterMs: 60 * 60 * 1000,
      })
      .mockResolvedValueOnce({ ok: true });

    await deliverWithRetry(deliver, {
      maxDelayMs: 5000,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([5000]);
  });

  it('backs off exponentially without a provider hint', async () => {
    const waits: number[] = [];
    const deliver = vi.fn(async () => ({ ok: false as const, error: 'x', retryable: true }));

    await deliverWithRetry(deliver, {
      attempts: 4,
      baseDelayMs: 100,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([100, 200, 400]);
  });
});

describe('parseRetryAfter', () => {
  it('reads a seconds value', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('reads an HTTP date', () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const parsed = parseRetryAfter(future);
    expect(parsed).toBeGreaterThan(50_000);
    expect(parsed).toBeLessThanOrEqual(60_000);
  });

  it('returns undefined for junk or an absent header', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('MemoryIdempotencyStore', () => {
  it('claims a key once', () => {
    const store = new MemoryIdempotencyStore();
    expect(store.claim('k', 1000)).toBe(true);
    expect(store.claim('k', 1000)).toBe(false);
  });

  it('allows a re-claim after release', () => {
    const store = new MemoryIdempotencyStore();
    store.claim('k', 1000);
    store.release('k');
    expect(store.claim('k', 1000)).toBe(true);
  });

  it('expires a claim once its TTL passes', () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryIdempotencyStore();
      expect(store.claim('k', 1000)).toBe(true);
      vi.advanceTimersByTime(1500);
      expect(store.claim('k', 1000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('builds keys that cannot collide across agents or channels', () => {
    expect(idempotencyKey('a1', 'telegram', 'm1')).not.toBe(idempotencyKey('a2', 'telegram', 'm1'));
    expect(idempotencyKey('a1', 'telegram', 'm1')).not.toBe(idempotencyKey('a1', 'webhook', 'm1'));
  });
});
