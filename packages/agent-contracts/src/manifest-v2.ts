/**
 * @larkup/agent-contracts — Manifest v2 schema.
 *
 * Every extension (tool, skill, channel, knowledge-integration) ships a
 * `tool.manifest.json` conforming to this schema.
 *
 * Manifest v2 replaces the v1 ToolDescriptor from @larkup/marketplace.
 * A v1→v2 migration adapter is exported for backwards compatibility.
 *
 * Extension kinds:
 * - `tool`                  — callable typed function (ToolContract)
 * - `skill`                 — SKILL.md folder with optional scripts
 * - `channel`               — I/O connector (Slack, email, webhook, …)
 * - `knowledge-integration` — data source adapter for Knowledge Server
 *
 * Schema version: 2.0
 */

import type { ToolTrustLevel } from './agent';
import type { ToolPermissions, ToolSecretRequirement } from './tool';

/* ------------------------------------------------------------------ */
/* Extension kinds                                                     */
/* ------------------------------------------------------------------ */

export type ExtensionKind = 'tool' | 'skill' | 'channel' | 'knowledge-integration';

export type ExtensionCategory =
  | 'media'
  | 'search'
  | 'analytics'
  | 'integration'
  | 'embedding'
  | 'ai'
  | 'automation'
  | 'utility';

export type ExtensionPricing = 'free' | 'pro' | 'enterprise';

/* ------------------------------------------------------------------ */
/* Manifest v2                                                         */
/* ------------------------------------------------------------------ */

/**
 * The canonical v2 manifest for every Larkup extension.
 * Stored as `tool.manifest.json` at the root of the extension package.
 *
 * @example
 * ```json
 * {
 *   "manifestVersion": "2.0",
 *   "kind": "tool",
 *   "id": "web-search",
 *   "name": "Web Search",
 *   "description": "Search the web using Tavily or Serper",
 *   "version": "1.0.0",
 *   "packageName": "@larkup/tool-web-search",
 *   "author": "Larkup GmbH",
 *   "trustLevel": "standard",
 *   "permissions": { "httpAllow": ["api.tavily.com", "serper.dev"] },
 *   "secrets": [
 *     { "envVar": "TAVILY_API_KEY", "label": "Tavily API Key", "required": true }
 *   ],
 *   "capabilities": ["web-search"],
 *   "category": "search",
 *   "pricing": "free",
 *   "installSize": "12 kB",
 *   "icon": "Search",
 *   "downloads": 0
 * }
 * ```
 */
export interface ToolManifestV2 {
  /** Must be "2.0" */
  manifestVersion: '2.0';
  /** Extension kind */
  kind: ExtensionKind;

  /* ---- Identity -------------------------------------------------- */

  /** Unique identifier: lowercase alphanumeric + hyphens */
  id: string;
  /** User-facing display name */
  name: string;
  /** Short one-line description */
  description: string;
  /** Longer description shown in detail view */
  longDescription?: string;
  /** Semver version string */
  version: string;
  /** npm package name */
  packageName: string;
  /** Author or publisher */
  author: string;

  /* ---- Trust & security ----------------------------------------- */

  /**
   * Minimum trust level required to invoke this extension.
   * Defaults to `standard` if not specified.
   */
  trustLevel?: ToolTrustLevel;
  /** Declared permissions — validated against trustLevel at load time */
  permissions?: ToolPermissions;
  /** Secrets the extension requires */
  secrets?: ToolSecretRequirement[];

  /* ---- Capabilities --------------------------------------------- */

  /** Feature tokens this extension provides (e.g. ["video-transcription"]) */
  capabilities: string[];
  /** Extension category for marketplace filtering */
  category: ExtensionCategory;

  /* ---- Marketplace metadata -------------------------------------- */

  pricing: ExtensionPricing;
  /** Approximate install size for UI display */
  installSize: string;
  /** Lucide icon name fallback */
  icon: string;
  /** Emoji icon — preferred over icon when set */
  emoji?: string;
  /** URL to a custom icon image */
  iconUrl?: string;
  /** Tags for search and filtering */
  tags?: string[];
  /** Total install count */
  downloads: number;
  /** Repository / homepage URL */
  repositoryUrl?: string;
  /** License identifier (e.g. "MIT") */
  license?: string;
  /** Changelog / release notes */
  changelog?: string;
  /** Minimum Larkup version required */
  minLarkupVersion?: string;
  /** ISO-8601 last updated timestamp */
  updatedAt?: string;
  /** Whether this is a placeholder (coming soon) */
  comingSoon?: boolean;

  /* ---- Config schema --------------------------------------------- */

  /** User-configurable fields shown in the installation UI */
  configSchema?: ManifestConfigField[];

  /* ---- System deps ----------------------------------------------- */

  /** System-level dependencies required (e.g. ["ffmpeg"]) */
  systemDeps?: string[];
}

export interface ManifestConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'toggle';
  defaultValue?: string;
  help?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateManifestV2(manifest: Record<string, unknown>): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (manifest.manifestVersion !== '2.0') {
    errors.push(`manifestVersion must be "2.0" — got "${manifest.manifestVersion}"`);
  }

  const validKinds: ExtensionKind[] = ['tool', 'skill', 'channel', 'knowledge-integration'];
  if (!manifest.kind || !validKinds.includes(manifest.kind as ExtensionKind)) {
    errors.push(`"kind" must be one of: ${validKinds.join(', ')}`);
  }

  const requiredStrings = ['id', 'name', 'description', 'version', 'packageName', 'author', 'icon'];
  for (const field of requiredStrings) {
    if (!manifest[field] || typeof manifest[field] !== 'string') {
      errors.push(`Missing or invalid required field: "${field}" (expected string)`);
    }
  }

  if (typeof manifest.id === 'string' && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(manifest.id)) {
    errors.push(`"id" must be lowercase alphanumeric with hyphens`);
  }

  if (typeof manifest.version === 'string' && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push(`"version" must follow semver format (e.g., "0.1.0")`);
  }

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    errors.push(`"capabilities" must be a non-empty array`);
  }

  const validTrustLevels: ToolTrustLevel[] = ['safe', 'standard', 'elevated', 'privileged'];
  if (manifest.trustLevel && !validTrustLevels.includes(manifest.trustLevel as ToolTrustLevel)) {
    errors.push(`"trustLevel" must be one of: ${validTrustLevels.join(', ')}`);
  }

  if (!manifest.repositoryUrl) {
    warnings.push(`"repositoryUrl" is recommended for community extensions`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/* ------------------------------------------------------------------ */
/* v1 → v2 migration adapter                                          */
/* ------------------------------------------------------------------ */

/**
 * Convert a v1 ToolDescriptor (from @larkup/marketplace) to a v2 manifest.
 * Used during import/install of existing marketplace tools.
 */
export function migrateManifestV1toV2(v1: Record<string, unknown>): ToolManifestV2 {
  return {
    manifestVersion: '2.0',
    kind: 'tool',
    id: String(v1.id ?? ''),
    name: String(v1.name ?? ''),
    description: String(v1.description ?? ''),
    longDescription: v1.longDescription as string | undefined,
    version: String(v1.version ?? '0.0.1'),
    packageName: String(v1.packageName ?? ''),
    author: String(v1.author ?? 'Unknown'),
    // v1 has no trustLevel — default to standard (safest non-read-only)
    trustLevel: 'standard',
    permissions: {},
    capabilities: Array.isArray(v1.capabilities) ? (v1.capabilities as string[]) : [],
    category: (v1.category ?? 'utility') as ExtensionCategory,
    pricing: (v1.pricing ?? 'free') as ExtensionPricing,
    installSize: String(v1.installSize ?? '?'),
    icon: String(v1.icon ?? 'Package'),
    emoji: v1.emoji as string | undefined,
    tags: v1.tags as string[] | undefined,
    downloads: Number(v1.downloads ?? 0),
    repositoryUrl: v1.repositoryUrl as string | undefined,
    license: v1.license as string | undefined,
    systemDeps: v1.systemDeps as string[] | undefined,
    configSchema: v1.configSchema as ManifestConfigField[] | undefined,
  };
}
