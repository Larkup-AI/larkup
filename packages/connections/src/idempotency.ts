/** Idempotency contracts for inbound provider retries. */

export interface IdempotencyStore {
  /** Reserve a key; false means another request already owns it. */
  claim(key: string, ttlMs: number): Promise<boolean> | boolean;
  /** Release a claim so a genuine failure can be retried by the provider. */
  release(key: string): Promise<void> | void;
}

/** Process-local store with lazy expiry. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Map<string, number>();

  claim(key: string, ttlMs: number): boolean {
    const now = Date.now();
    this.sweep(now);

    const existing = this.seen.get(key);
    if (existing !== undefined && existing > now) return false;

    this.seen.set(key, now + ttlMs);
    return true;
  }

  release(key: string): void {
    this.seen.delete(key);
  }

  /** Drop expired entries during claims. */
  private sweep(now: number): void {
    if (this.seen.size < 512) return;
    for (const [key, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(key);
    }
  }

  /** Test seam. */
  get size(): number {
    return this.seen.size;
  }
}

/** Build an agent- and channel-scoped message key. */
export function idempotencyKey(
  agentId: string,
  channelId: string,
  externalMessageId: string,
): string {
  return `${agentId}:${channelId}:${externalMessageId}`;
}
