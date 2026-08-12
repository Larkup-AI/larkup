/**
 * @larkup/agent-contracts — Agent definition & release contracts.
 *
 * An **Agent** is an addressable, versioned AI entity that:
 * - Owns a system prompt and a set of installed tools/skills
 * - Connects to one or more Knowledge Servers for retrieval
 * - Can be launched locally, on Docker/VPS, or as a Cloud Run service
 *
 * An **AgentRelease** is an immutable snapshot of a particular Agent version
 * (per ADR-002). Releases are content-addressed by their `releaseId` and
 * can only be created — never mutated. Rollback = switch to a prior release.
 *
 * Schema version: 2.0
 */

/* ------------------------------------------------------------------ */
/* Key scopes (per ADR-004)                                            */
/* ------------------------------------------------------------------ */

/**
 * Scope tokens that determine what a caller can do.
 *
 * Knowledge Server scopes (knowledge plane):
 * - `retrieval` — query/search only
 * - `ingest`    — add/delete documents
 * - `admin`     — full access including config
 *
 * Agent scopes (execution plane):
 * - `agent:chat`   — send messages and receive responses
 * - `agent:invoke` — call typed tools directly
 * - `agent:admin`  — manage agent config, releases, and deployments
 */
export type KeyScope =
  | 'retrieval'
  | 'ingest'
  | 'admin'
  | 'agent:chat'
  | 'agent:invoke'
  | 'agent:admin';

/**
 * Trust levels that govern what a tool is allowed to do at runtime.
 * This maps to the ToolManifestV2.trustLevel field.
 *
 * - `safe`       — read-only, pure computation, no I/O side effects
 * - `standard`   — can perform HTTP requests to allow-listed domains
 * - `elevated`   — can write to local filesystem, spawn subprocesses
 * - `privileged` — unrestricted; requires explicit admin approval
 */
export type ToolTrustLevel = 'safe' | 'standard' | 'elevated' | 'privileged';

/* ------------------------------------------------------------------ */
/* Agent Definition                                                    */
/* ------------------------------------------------------------------ */

/**
 * The mutable configuration of an Agent (the "blueprint").
 * Saved under .larkup/agents/<agentId>/config.json.
 *
 * When an agent is published, a snapshot of this config is captured
 * as an `AgentRelease`.
 */
export interface AgentDefinition {
  /** Stable identifier, e.g. "customer-support-bot" */
  id: string;
  /** User-facing display name */
  name: string;
  /** Short one-line description */
  description: string;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-modified timestamp */
  updatedAt: string;

  /* ---- Model config ---------------------------------------------- */

  /** Vercel AI provider id, e.g. "openai", "anthropic" */
  chatProvider: string;
  /** Model identifier, e.g. "gpt-4o", "claude-3-5-sonnet-20241022" */
  chatModelId: string;
  /** System prompt that governs agent behaviour */
  systemPrompt: string;

  /* ---- Knowledge Server connections ------------------------------ */

  /**
   * Ordered list of Knowledge Server endpoints this Agent calls for
   * retrieval. The Agent issues a parallel fan-out and merges results.
   */
  knowledgeSources: AgentKnowledgeSource[];

  /* ---- Extension slots ------------------------------------------- */

  /** Installed tool IDs (from @larkup/marketplace) */
  enabledToolIds: string[];
  /** Installed skill IDs */
  enabledSkillIds: string[];

  /* ---- Safety ---------------------------------------------------- */

  /** Minimum trust level required for any tool to be invoked */
  minTrustLevel?: ToolTrustLevel;
  /** CORS allow-list for the embedded widget */
  allowedOrigins: string[];

  /* ---- Auth ------------------------------------------------------ */
  authMode: 'none' | 'api-key' | 'join-code';
  joinCode?: string;

  /* ---- Rate limiting (plan §8.5) ---------------------------------- */

  /**
   * Daily token ceiling for this agent, summed across every browser-facing
   * request. `undefined` (the default) means no ceiling — an operator opts
   * in, matching plan §8.5's "operator-set, off by default." Tokens rather
   * than a dollar amount: the registry has no per-model pricing table, and a
   * token count is the honest thing `run.completed`'s `usage` actually gives.
   */
  dailyTokenCeiling?: number;

  /* ---- Widget style ---------------------------------------------- */
  widgetStyle: AgentWidgetStyle;

  /* ---- Channels (TASK 06) ---------------------------------------- */

  /**
   * Per-channel configuration, keyed by channel id ('telegram', 'webhook', …).
   *
   * Channel credentials (bot tokens, signing secrets) live here and are
   * therefore stored server-side alongside `knowledgeSources[].retrievalKey`.
   * They must never reach a browser — see `redactAgentSecrets`.
   */
  channels?: Record<string, AgentChannelConfig>;
}

/** One channel binding on an agent. */
export interface AgentChannelConfig {
  /** Whether inbound messages on this channel are accepted. */
  enabled: boolean;
  /**
   * Adapter-specific settings and secrets, validated against the adapter's
   * `configFields` before being stored.
   */
  settings: Record<string, string>;
  /** ISO-8601 timestamp of the last successful inbound message. */
  lastInboundAt?: string;
  /** ISO-8601 timestamp of the last delivery failure. */
  lastErrorAt?: string;
  /** Most recent delivery error, for the dashboard health card. */
  lastError?: string;
}

/** A Knowledge Server connection registered on an Agent. */
export interface AgentKnowledgeSource {
  /** Human label for the source, e.g. "Product Docs" */
  label: string;
  /** Full base URL of the Knowledge Server */
  baseUrl: string;
  /**
   * Retrieval-scoped API key. Stored in Secret Manager / server credentials;
   * NEVER serialised into a browser bundle or client response.
   */
  retrievalKey: string;
  /** Maximum results to fetch from this source per query */
  topK?: number;
}

/* ------------------------------------------------------------------ */
/* Agent Release (ADR-002 — immutable snapshot)                       */
/* ------------------------------------------------------------------ */

/**
 * An immutable snapshot of an Agent at a point in time.
 *
 * Releases are content-addressed: releaseId is a SHA-256 hash of the
 * serialised `AgentDefinition` + `installedExtensions` manifest.
 *
 * To "rollback", the active pointer is moved to a prior release ID.
 */
export interface AgentRelease {
  /** Stable agent identifier */
  agentId: string;
  /** Unique content-hash ID for this release */
  releaseId: string;
  /** Semver-ish tag, e.g. "1.0.0", "1.1.0-beta.1" */
  version: string;
  /** ISO-8601 publish timestamp */
  publishedAt: string;
  /** Snapshot of the agent config at publish time */
  definition: AgentDefinition;
  /**
   * Locked extension manifest: maps toolId → { packageName, version, resolvedPath }.
   * Ensures exact reproducibility of every release.
   */
  installedExtensions: Record<string, LockedExtension>;
  /** Optional human-readable release notes */
  releaseNotes?: string;
  /** Whether this release is the currently active one */
  isActive: boolean;
  /** Which user or system published this release */
  publishedBy?: string;
}

/** Locked extension entry inside a release manifest. */
export interface LockedExtension {
  packageName: string;
  version: string;
  resolvedPath: string;
  trustLevel: ToolTrustLevel;
  /** SHA-256 integrity hash of the package bundle */
  integrity?: string;
}

/* ------------------------------------------------------------------ */
/* Agent Widget Style                                                  */
/* ------------------------------------------------------------------ */

/** Controls the appearance of the embedded chat widget. */
export interface AgentWidgetStyle {
  primaryColor: string;
  position: 'bottom-right' | 'bottom-left';
  title: string;
  welcomeMessage: string;
  placeholder: string;
  avatarUrl?: string;
  darkMode: boolean;
  borderRadius: 'sm' | 'md' | 'lg' | 'full';
}

export const DEFAULT_WIDGET_STYLE: AgentWidgetStyle = {
  primaryColor: '#6366f1',
  position: 'bottom-right',
  title: 'Chat with Agent',
  welcomeMessage: 'Hi! How can I help you today?',
  placeholder: 'Type a message…',
  darkMode: false,
  borderRadius: 'lg',
};
