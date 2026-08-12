/**
 * Idempotency for inbound channel messages.
 *
 * Every provider in the delivery order retries a webhook it believes failed —
 * Telegram re-sends an update it did not get a 200 for, Slack retries after
 * 3 seconds, a generic webhook client retries on a timeout. Without a guard,
 * one slow model call becomes three answers to the same question and three
 * times the bill.
 *
 * The default store is in-memory, which is correct for a single self-hosted
 * process and explicitly not correct for a horizontally scaled deployment.
 * `IdempotencyStore` is the seam where TASK 08 swaps in a shared store.
 */

export interface IdempotencyStore {
  /**
   * Reserve a key. Returns true when the caller owns this message and should
   * process it, false when it has already been seen.
   */
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

  /**
   * Drop expired entries. Called on every claim rather than on a timer so the
   * store cannot keep a process alive or leak in a serverless environment.
   */
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

/**
 * Build the idempotency key for a message.
 *
 * Scoped by agent and channel as well as message id: two agents sharing one bot
 * token must not de-duplicate each other's traffic.
 */
export function idempotencyKey(
  agentId: string,
  channelId: string,
  externalMessageId: string,
): string {
  return `${agentId}:${channelId}:${externalMessageId}`;
}
