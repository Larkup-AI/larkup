import { describe, expect, it, vi } from 'vitest';
import {
  dailyBucket,
  MemoryRateLimiter,
  MESSAGES_PER_SESSION,
  ratePerWindow,
  REQUESTS_PER_MINUTE,
  trustedClientIp,
  visitorRateLimitKey,
  type TokenBucketConfig,
} from './rate-limit';

describe('MemoryRateLimiter', () => {
  it('allows requests up to the bucket capacity', () => {
    const limiter = new MemoryRateLimiter();
    const config: TokenBucketConfig = { capacity: 3, refillPerMs: 0 };

    expect(limiter.consume('a', 1, config)).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.consume('a', 1, config)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume('a', 1, config)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('denies once the bucket is empty and reports a positive retryAfterSeconds', () => {
    const limiter = new MemoryRateLimiter();
    const config: TokenBucketConfig = ratePerWindow(20, 60_000); // 20/min

    for (let i = 0; i < 20; i += 1) expect(limiter.consume('a', 1, config).allowed).toBe(true);

    const denied = limiter.consume('a', 1, config);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refills over time and lets a caller back in', () => {
    const limiter = new MemoryRateLimiter();
    const config: TokenBucketConfig = { capacity: 1, refillPerMs: 1 / 1000 }; // 1 token/sec

    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(0);
    expect(limiter.consume('a', 1, config).allowed).toBe(true);
    expect(limiter.consume('a', 1, config).allowed).toBe(false);

    now.mockReturnValue(1000); // one full second later — one token back
    expect(limiter.consume('a', 1, config).allowed).toBe(true);

    now.mockRestore();
  });

  it('never lets refill push tokens past capacity (no free burst from idling)', () => {
    const limiter = new MemoryRateLimiter();
    const config: TokenBucketConfig = { capacity: 2, refillPerMs: 1 };

    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(0);
    limiter.consume('a', 0, config); // seed the bucket at t=0

    now.mockReturnValue(1_000_000); // a long idle gap
    const decision = limiter.consume('a', 1, config);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(1); // capacity(2) - cost(1), not capacity - cost + leftover refill

    now.mockRestore();
  });

  it('keeps buckets independent by key', () => {
    const limiter = new MemoryRateLimiter();
    const config: TokenBucketConfig = { capacity: 1, refillPerMs: 0 };

    expect(limiter.consume('visitor-a', 1, config).allowed).toBe(true);
    expect(limiter.consume('visitor-b', 1, config).allowed).toBe(true); // independent bucket
    expect(limiter.consume('visitor-a', 1, config).allowed).toBe(false); // visitor-a's is spent
  });

  it('a zero-refill bucket (session cap) never recovers within the session and reports the no-refill sentinel', () => {
    const limiter = new MemoryRateLimiter();
    expect(MESSAGES_PER_SESSION.refillPerMs).toBe(0);

    for (let i = 0; i < MESSAGES_PER_SESSION.capacity; i += 1) {
      expect(limiter.consume('s', 1, MESSAGES_PER_SESSION).allowed).toBe(true);
    }
    const denied = limiter.consume('s', 1, MESSAGES_PER_SESSION);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(86_400);
  });

  it('charge() unconditionally records a spend, even past the ceiling, so the *next* precheck is what gets denied', () => {
    const limiter = new MemoryRateLimiter();
    const config = dailyBucket(1000);

    // A precheck (cost 0) passes while the bucket is not yet in the red.
    expect(limiter.consume('agent-1', 0, config).allowed).toBe(true);

    // A single expensive run's actual cost is only known after it completes.
    // charge() always applies it, even when it overshoots the ceiling — the
    // run that caused the overshoot still gets to finish.
    limiter.charge('agent-1', 5000, config);

    // The *next* precheck is what actually gets denied.
    const denied = limiter.consume('agent-1', 0, config);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it('consume() never applies a cost it rejects — a denied attempt leaves the bucket untouched (net of refill)', () => {
    const limiter = new MemoryRateLimiter();
    const config: TokenBucketConfig = { capacity: 10, refillPerMs: 0 };

    limiter.consume('a', 3, config); // 7 left
    const denied = limiter.consume('a', 100, config); // far more than available
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(7); // unchanged by the rejected attempt

    expect(limiter.consume('a', 7, config).allowed).toBe(true); // the 7 are still there
  });
});

describe('platform defaults', () => {
  it('REQUESTS_PER_MINUTE bursts 5 and sustains 20/min', () => {
    expect(REQUESTS_PER_MINUTE.capacity).toBe(5);
    expect(REQUESTS_PER_MINUTE.refillPerMs * 60_000).toBeCloseTo(20);
  });

  it('MESSAGES_PER_SESSION is a hard 50-message cap with no refill', () => {
    expect(MESSAGES_PER_SESSION.capacity).toBe(50);
    expect(MESSAGES_PER_SESSION.refillPerMs).toBe(0);
  });
});

describe('visitorRateLimitKey', () => {
  it('is stable for the same inputs', () => {
    expect(visitorRateLimitKey('agt_1', '1.2.3.4', 'UA/1')).toBe(
      visitorRateLimitKey('agt_1', '1.2.3.4', 'UA/1'),
    );
  });

  it('scopes by agent so one visitor does not share a budget across agents', () => {
    expect(visitorRateLimitKey('agt_1', '1.2.3.4', 'UA/1')).not.toBe(
      visitorRateLimitKey('agt_2', '1.2.3.4', 'UA/1'),
    );
  });

  it('differs by IP and by user agent', () => {
    const base = visitorRateLimitKey('agt_1', '1.2.3.4', 'UA/1');
    expect(visitorRateLimitKey('agt_1', '5.6.7.8', 'UA/1')).not.toBe(base);
    expect(visitorRateLimitKey('agt_1', '1.2.3.4', 'UA/2')).not.toBe(base);
  });
});

describe('trustedClientIp', () => {
  it('trusts only the last hop, which the reverse proxy itself appended', () => {
    expect(trustedClientIp('203.0.113.1, 10.0.0.5')).toBe('10.0.0.5');
  });

  it('is not fooled by a client spoofing extra hops in front of the real one', () => {
    // A client can send whatever it wants as the header value on the way in;
    // what matters is that our own proxy appends *its* observed peer last.
    expect(trustedClientIp('9.9.9.9, 8.8.8.8, 203.0.113.1')).toBe('203.0.113.1');
  });

  it('falls back to "unknown" rather than throwing when the header is absent', () => {
    expect(trustedClientIp(null)).toBe('unknown');
    expect(trustedClientIp(undefined)).toBe('unknown');
    expect(trustedClientIp('')).toBe('unknown');
    expect(trustedClientIp('   ')).toBe('unknown');
  });
});
