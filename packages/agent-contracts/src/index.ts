/**
 * @larkup/agent-contracts — public barrel.
 *
 * Re-exports every stable contract from the package. Import from here
 * for the widest surface, or import from sub-paths for tree-shaking:
 *
 * ```ts
 * import type { AgentDefinition } from '@larkup/agent-contracts';
 * import type { ToolContract }    from '@larkup/agent-contracts/tool';
 * import type { AgentOutputBlock } from '@larkup/agent-contracts/output';
 * import type { ToolManifestV2 }  from '@larkup/agent-contracts/manifest';
 * import type { ExecutionEnvironment } from '@larkup/agent-contracts/execution';
 * import { checkAgentOrigin }     from '@larkup/agent-contracts/origin';
 * import { normalizeAgentMessages } from '@larkup/agent-contracts/protocol';
 * ```
 */

// Agent definition & release
export type {
  AgentDefinition,
  AgentRelease,
  AgentChannelConfig,
  AgentKnowledgeSource,
  AgentWidgetStyle,
  LockedExtension,
  KeyScope,
  ToolTrustLevel,
} from './agent';
export { DEFAULT_WIDGET_STYLE } from './agent';

// Tool & skill runtime contracts
export type {
  ToolContract,
  ToolSchema,
  ToolInputField,
  ToolPermissions,
  ToolSecretRequirement,
  ToolExecutionContext,
  ToolResult,
  ToolSuccess,
  ToolError,
  SkillDefinition,
} from './tool';
export { isTrustSufficient, validateToolContract } from './tool';

// Output blocks
export type {
  AgentOutputBlock,
  OutputBlockBase,
  TextOutputBlock,
  JsonOutputBlock,
  ImageOutputBlock,
  VideoOutputBlock,
  AudioOutputBlock,
  DocumentEditOutputBlock,
  CodeOutputBlock,
  ErrorOutputBlock,
  TableOutputBlock,
  CitationOutputBlock,
  RawOutputBlock,
} from './output';
export { normalizeOutputBlock } from './output';

// Manifest v2
export type {
  ToolManifestV2,
  ExtensionKind,
  ExtensionCategory,
  ExtensionPricing,
  ManifestConfigField,
  ManifestValidationResult,
} from './manifest-v2';
export { validateManifestV2, migrateManifestV1toV2 } from './manifest-v2';

// Execution environment
export type {
  ExecutionTarget,
  ExecutionEnvironment,
  ExecutionLimits,
  ExecutionDecision,
  ToolExecutionRequirements,
} from './execution';
export {
  ENVIRONMENT_PROFILES,
  admitTool,
  resolveExecutionEnvironment,
  selectEnvironment,
} from './execution';

// Browser origin policy (widget / CORS boundary)
export type { OriginDecision } from './origin';
export {
  agentCorsHeaders,
  checkAgentOrigin,
  isOriginAllowed,
  normalizeOrigin,
  originDenialMessage,
  resolveRequestOrigin,
} from './origin';

// Wire protocol
export type { AgentWireMessage } from './protocol';
export { lastUserMessage, normalizeAgentMessages } from './protocol';

// Observability (plan §12)
export type { AgentEvent, AgentEventName, EventCorrelation, EventSink } from './observability';
export {
  consoleSink,
  emitAgentEvent,
  redactEventPayload,
  setEventSink,
  startTimer,
} from './observability';

// Secret redaction
export { REDACTED, isRedacted, mergeAgentUpdate, redactAgentSecrets } from './redaction';

// Rate limiting (plan §8.5)
export type { RateLimitDecision, RateLimiter, TokenBucketConfig } from './rate-limit';
export {
  dailyBucket,
  MemoryRateLimiter,
  MESSAGES_PER_SESSION,
  ratePerWindow,
  REQUESTS_PER_MINUTE,
  trustedClientIp,
  visitorRateLimitKey,
} from './rate-limit';
