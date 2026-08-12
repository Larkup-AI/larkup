/**
 * Outbound delivery retries.
 *
 * Providers rate-limit aggressively and fail transiently. A channel that drops
 * the agent's answer on the first 429 is worse than no channel at all, because
 * the user has already been charged for the model call.
 */

import type { DeliveryResult } from './types';

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Base delay; doubles each attempt. */
  baseDelayMs?: number;
  /** Ceiling for a single wait, so a bad `Retry-After` cannot stall a request. */
  maxDelayMs?: number;
  /** Injected in tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run a delivery, retrying only failures the adapter marked retryable.
 *
 * A provider-supplied `retryAfterMs` always wins over the backoff curve —
 * ignoring it is how an app gets its bot token rate-limited harder.
 */
export async function deliverWithRetry(
  deliver: () => Promise<DeliveryResult>,
  options: RetryOptions = {},
): Promise<DeliveryResult> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 400;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const sleep = options.sleep ?? defaultSleep;

  let last: DeliveryResult = { ok: false, error: 'delivery never ran', retryable: false };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await deliver();
    } catch (error) {
      // A thrown error is a transport failure: retryable by definition.
      last = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }

    if (last.ok || !last.retryable) return last;
    if (attempt === attempts - 1) break;

    const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
    await sleep(Math.min(last.retryAfterMs ?? backoff, maxDelayMs));
  }

  return last;
}

/** Parse a `Retry-After` header (seconds, or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return undefined;
}
