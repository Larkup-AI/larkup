import type { ToolDescriptor, ToolCategory, ToolPricing } from './types';

/**
 * Tool manifest schema validation.
 *
 * Provides a validation utility for `tool.manifest.json` files.
 * Contributors creating new tools can validate their manifest
 * against this schema to ensure correctness before publishing.
 *
 * Schema version: 1.0
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const MANIFEST_SCHEMA_VERSION = '1.0';

export const VALID_CATEGORIES: ToolCategory[] = [
  'media',
  'search',
  'analytics',
  'integration',
  'embedding',
  'ai',
  'automation',
  'utility',
];

export const VALID_PRICING_TIERS: ToolPricing[] = ['free', 'pro', 'enterprise'];

export const VALID_CONFIG_FIELD_TYPES = ['text', 'password', 'select', 'toggle'] as const;

/* ------------------------------------------------------------------ */
/* Validation result                                                   */
/* ------------------------------------------------------------------ */

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Validator                                                           */
/* ------------------------------------------------------------------ */

/**
 * Validate a tool manifest object against the ToolDescriptor schema.
 *
 * @example
 * ```typescript
 * import { validateToolManifest } from "@larkup/marketplace/manifest"
 * import manifest from "./tool.manifest.json"
 *
 * const result = validateToolManifest(manifest)
 * if (!result.valid) {
 *   console.error("Manifest errors:", result.errors)
 * }
 * ```
 */
export function validateToolManifest(manifest: Record<string, unknown>): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required string fields
  const requiredStrings = [
    'id',
    'name',
    'description',
    'version',
    'packageName',
    'installSize',
    'author',
    'icon',
  ] as const;
  for (const field of requiredStrings) {
    if (!manifest[field] || typeof manifest[field] !== 'string') {
      errors.push(`Missing or invalid required field: "${field}" (expected string)`);
    }
  }

  // id format: lowercase, hyphenated
  if (typeof manifest.id === 'string' && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(manifest.id)) {
    errors.push(`"id" must be lowercase alphanumeric with hyphens (e.g., "video-audio")`);
  }

  // category
  if (!manifest.category || !VALID_CATEGORIES.includes(manifest.category as ToolCategory)) {
    errors.push(`"category" must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  // pricing
  if (!manifest.pricing || !VALID_PRICING_TIERS.includes(manifest.pricing as ToolPricing)) {
    errors.push(`"pricing" must be one of: ${VALID_PRICING_TIERS.join(', ')}`);
  }

  // version semver-ish check
  if (typeof manifest.version === 'string' && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push(`"version" should follow semver format (e.g., "0.1.0")`);
  }

  // capabilities
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    errors.push(`"capabilities" must be a non-empty array of strings`);
  }

  // downloads must be a number
  if (manifest.downloads !== undefined && typeof manifest.downloads !== 'number') {
    errors.push(`"downloads" must be a number`);
  }

  // Optional field checks
  if (manifest.emoji !== undefined && typeof manifest.emoji !== 'string') {
    warnings.push(`"emoji" should be a string (e.g., "🎬")`);
  }

  if (manifest.tags !== undefined) {
    if (!Array.isArray(manifest.tags)) {
      warnings.push(`"tags" should be an array of strings`);
    }
  }

  if (manifest.systemDeps !== undefined) {
    if (!Array.isArray(manifest.systemDeps)) {
      warnings.push(`"systemDeps" should be an array of strings`);
    }
  }

  if (manifest.configSchema !== undefined) {
    if (!Array.isArray(manifest.configSchema)) {
      errors.push(`"configSchema" must be an array`);
    } else {
      for (let i = 0; i < manifest.configSchema.length; i++) {
        const field = manifest.configSchema[i] as Record<string, unknown>;
        if (!field.key || !field.label || !field.type) {
          errors.push(`configSchema[${i}]: must have "key", "label", and "type"`);
        }
        if (field.type && !VALID_CONFIG_FIELD_TYPES.includes(field.type as any)) {
          errors.push(
            `configSchema[${i}].type must be one of: ${VALID_CONFIG_FIELD_TYPES.join(', ')}`,
          );
        }
      }
    }
  }

  // Warnings for missing recommended fields
  if (!manifest.emoji && !manifest.iconUrl) {
    warnings.push(`Consider adding "emoji" or "iconUrl" for a better marketplace experience`);
  }
  if (!manifest.tags || (Array.isArray(manifest.tags) && manifest.tags.length === 0)) {
    warnings.push(`Consider adding "tags" for better discoverability`);
  }
  if (!manifest.license) {
    warnings.push(`Consider adding "license" (e.g., "MIT", "Apache-2.0")`);
  }
  if (!manifest.repositoryUrl) {
    warnings.push(`Consider adding "repositoryUrl" for collaboration`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Generate a minimal tool manifest template.
 * Useful for bootstrapping new tool packages.
 */
export function generateManifestTemplate(toolId: string): Partial<ToolDescriptor> {
  return {
    id: toolId,
    name: '',
    description: '',
    category: 'utility',
    version: '0.1.0',
    pricing: 'free',
    emoji: '',
    icon: '',
    packageName: `@larkup/tool-${toolId}`,
    installSize: '~1 MB',
    author: '',
    capabilities: [],
    tags: [],
    downloads: 0,
    license: 'Apache-2.0',
  };
}
