/**
 * @larkup/agent-contracts — Tool & Skill Runtime contract.
 *
 * A **Tool** is a typed, permissioned function that an Agent can call.
 * Tools declare: input schema, output type, required permissions,
 * timeout budget, secret requirements, and a trust level.
 *
 * A **Skill** is a SKILL.md folder convention: a set of instructions +
 * optional scripts that run as explicitly permissioned tool calls.
 * Skills extend Agent reasoning; they do NOT execute arbitrary JS.
 *
 * Schema version: 2.0
 */

import type { ToolTrustLevel } from './agent';

/* ------------------------------------------------------------------ */
/* Tool input / output schemas                                         */
/* ------------------------------------------------------------------ */

/**
 * JSON Schema-compatible field descriptor for tool input.
 * Validated at call time against the incoming arguments.
 */
export interface ToolInputField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  defaultValue?: unknown;
  /** Enum of allowed values */
  enum?: unknown[];
}

/** The schema that describes a tool's callable interface. */
export interface ToolSchema {
  /** Unique tool name used in LLM function-calling */
  name: string;
  /** One-sentence description given to the model */
  description: string;
  /** Input parameters */
  parameters: ToolInputField[];
}

/* ------------------------------------------------------------------ */
/* Permission model                                                    */
/* ------------------------------------------------------------------ */

/**
 * Declared permissions a tool requires. Evaluated against the trust
 * level at invocation time. Exceeding trust = invocation blocked.
 */
export interface ToolPermissions {
  /**
   * HTTP domains the tool is allowed to call.
   * Use `['*']` for standard-trust catch-all (not allowed for safe tools).
   */
  httpAllow?: string[];
  /** Whether the tool may read from the local filesystem */
  fsRead?: boolean;
  /** Whether the tool may write to the local filesystem */
  fsWrite?: boolean;
  /** Whether the tool may spawn subprocesses */
  exec?: boolean;
  /** Whether the tool may call the Knowledge Server's ingest endpoints */
  knowledgeIngest?: boolean;
}

/* ------------------------------------------------------------------ */
/* Secret requirements                                                 */
/* ------------------------------------------------------------------ */

/**
 * A secret the tool needs at runtime.
 * Secrets are resolved from Secret Manager / .larkup/credentials.json;
 * they are NEVER passed through the LLM context.
 */
export interface ToolSecretRequirement {
  /** Environment variable name the tool expects, e.g. "OPENAI_API_KEY" */
  envVar: string;
  /** User-facing label for configuration UI */
  label: string;
  /** Whether the tool cannot function without this secret */
  required: boolean;
  /** Short explanation of how the secret is used */
  description?: string;
}

/* ------------------------------------------------------------------ */
/* Tool Runtime contract                                               */
/* ------------------------------------------------------------------ */

/**
 * The full runtime contract for a Larkup tool.
 *
 * Implementors must export a `toolContract: ToolContract` from their
 * package entry point. The loader validates this at install time.
 */
export interface ToolContract {
  /** Callable schema (name, description, parameters) */
  schema: ToolSchema;
  /**
   * Minimum trust level required for this tool to be invoked.
   * Defaults to `standard`.
   */
  trustLevel: ToolTrustLevel;
  /** Declared permissions — validated against trustLevel at call time */
  permissions: ToolPermissions;
  /** Secrets the tool requires */
  secrets?: ToolSecretRequirement[];
  /**
   * Maximum execution time in milliseconds.
   * Agent runtime enforces this with AbortSignal.timeout().
   * Defaults to 30 000 ms.
   */
  timeoutMs?: number;
  /**
   * Whether the tool can be safely retried on network failure.
   * Defaults to false.
   */
  idempotent?: boolean;
  /**
   * Maximum number of automatic retries on timeout/network error.
   * Only applies when `idempotent` is true.
   * Defaults to 0.
   */
  maxRetries?: number;
  /**
   * Optional OpenTelemetry span name prefix for tracing.
   * Defaults to `tool.<name>`.
   */
  tracingSpanPrefix?: string;
  /**
   * The callable function. Receives typed input and an execution context,
   * returns a typed output block.
   *
   * Implementors MUST NOT throw — return a ToolError output block instead.
   */
  execute(input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>;
}

/* ------------------------------------------------------------------ */
/* Execution context                                                   */
/* ------------------------------------------------------------------ */

/**
 * Passed to `execute()` at invocation time.
 * Contains runtime services, abort signal, and observability hooks.
 */
export interface ToolExecutionContext {
  /** Unique invocation ID for tracing/logging */
  invocationId: string;
  /** Agent ID that triggered this invocation */
  agentId: string;
  /** The trust level the Agent has granted this tool */
  grantedTrustLevel: ToolTrustLevel;
  /** AbortSignal hooked to the tool's timeout budget */
  signal: AbortSignal;
  /** Resolved secrets (env var name → value) — never log or return to LLM */
  secrets: Record<string, string>;
  /** Emit a structured trace event */
  trace(event: string, data?: Record<string, unknown>): void;
  /** Log a debug message */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void;
}

/* ------------------------------------------------------------------ */
/* Tool result                                                         */
/* ------------------------------------------------------------------ */

/** Successful tool result */
export interface ToolSuccess {
  ok: true;
  /** Output block to render in the chat (any AgentOutputBlock) */
  output: unknown;
  /** Optional structured data to pass back to the model */
  modelData?: unknown;
}

/** Tool error result — tools MUST return this rather than throw */
export interface ToolError {
  ok: false;
  error: string;
  /** Machine-readable error code */
  code?: string;
  /** Whether the error is retryable */
  retryable?: boolean;
}

export type ToolResult = ToolSuccess | ToolError;

/* ------------------------------------------------------------------ */
/* Skill convention                                                    */
/* ------------------------------------------------------------------ */

/**
 * A Skill is a SKILL.md folder with instructions + optional scripts.
 * Scripts run as explicitly permissioned ToolContracts — they do NOT
 * get arbitrary execution rights.
 */
export interface SkillDefinition {
  /** Unique skill identifier, e.g. "web-search" */
  id: string;
  /** Human name */
  name: string;
  /** Short description for the Agent's system prompt */
  description: string;
  /** Path to SKILL.md (relative to workspace root) */
  instructionsPath: string;
  /** Optional list of tool IDs this skill delegates to */
  delegateToolIds?: string[];
  /** Trust level required to run this skill's scripts */
  trustLevel: ToolTrustLevel;
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

const TRUST_RANK: Record<ToolTrustLevel, number> = {
  safe: 0,
  standard: 1,
  elevated: 2,
  privileged: 3,
};

/**
 * Returns true if `granted` is sufficient to satisfy `required`.
 *
 * @example
 * isTrustSufficient('standard', 'elevated') // false
 * isTrustSufficient('elevated', 'standard') // true
 */
export function isTrustSufficient(granted: ToolTrustLevel, required: ToolTrustLevel): boolean {
  return TRUST_RANK[granted] >= TRUST_RANK[required];
}

/**
 * Validate a ToolContract at load time. Returns a list of validation errors.
 * An empty array means the contract is valid.
 */
export function validateToolContract(contract: ToolContract): string[] {
  const errs: string[] = [];
  if (!contract.schema?.name) errs.push('contract.schema.name is required');
  if (!contract.schema?.description) errs.push('contract.schema.description is required');
  if (!contract.trustLevel) errs.push('contract.trustLevel is required');
  if (typeof contract.execute !== 'function') errs.push('contract.execute must be a function');
  // safe tools must not declare fs or exec permissions
  if (contract.trustLevel === 'safe') {
    const p = contract.permissions;
    if (p.fsRead || p.fsWrite || p.exec) {
      errs.push('safe tools cannot declare fsRead, fsWrite, or exec permissions');
    }
    if (p.httpAllow?.includes('*')) {
      errs.push("safe tools cannot use httpAllow: ['*']");
    }
  }
  return errs;
}
