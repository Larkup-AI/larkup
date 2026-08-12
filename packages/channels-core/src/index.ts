/**
 * @larkup/channels-core — normalized channel adapter contract (plan §9).
 *
 * ```ts
 * import { dispatchInbound, type ChannelAdapter } from '@larkup/channels-core';
 * ```
 */

export type {
  ChannelAdapter,
  ChannelConfigField,
  ChannelHealth,
  DeliveryResult,
  InboundRequest,
  NormalizedAttachment,
  NormalizedMessage,
  OutboundMessage,
  VerificationResult,
} from './types';

export type { ChannelEvent, DispatchOptions, DispatchResult, RunAgent } from './dispatch';
export { dispatchInbound } from './dispatch';

export type { IdempotencyStore } from './idempotency';
export { MemoryIdempotencyStore, idempotencyKey } from './idempotency';

export type { ChannelSession } from './session';
export { deriveSession } from './session';

export type { RetryOptions } from './retry';
export { deliverWithRetry, parseRetryAfter } from './retry';

export { validateChannelSettings, type ChannelValidationResult } from './validate';

export {
  getChannel,
  listChannels,
  registerChannel,
  slackChannel,
  telegramChannel,
  webhookChannel,
} from './registry';
export { computeWebhookSignature } from './adapters/webhook';
export { splitForTelegram } from './adapters/telegram';
export { slackUrlVerificationChallenge, splitForSlack } from './adapters/slack';
