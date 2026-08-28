/** Channel adapters and shared dispatch utilities. */

export type {
  ChannelAdapter,
  ChannelConfigField,
  ChannelHealth,
  DeliveryResult,
  InboundInterception,
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
  listConnectionSummaries,
  listChannelSummaries,
  registerChannel,
  discordChannel,
  slackChannel,
  telegramChannel,
  webhookChannel,
} from './registry';
export type { ChannelSummary, ComingSoonConnectionSummary, ConnectionSummary } from './registry';
export { computeWebhookSignature } from './adapters/webhook';
export { splitForTelegram } from './adapters/telegram';
export { slackUrlVerificationChallenge, splitForSlack } from './adapters/slack';
export { discordInteractionResponse, discordPingResponse } from './adapters/discord';
