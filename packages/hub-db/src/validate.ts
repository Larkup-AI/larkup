/**
 * Manifest validation for `POST /v1/tools/publish`.
 *
 * The pre-migration publish route checked only that `id` and `packageName`
 * were present — everything else in `ToolDescriptor` was trusted as-is. This
 * is the same field list `GET /v1/schema/tool-manifest.v1` has always
 * documented, now actually enforced rather than merely published as a
 * schema nobody checked publishers against.
 *
 * Hand-written rather than a JSON-Schema library: the shape is small, static,
 * and already fully described by this one function — pulling in ajv for six
 * field checks would be the dependency, not the validation.
 */

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+/;
const CATEGORIES = [
  'media',
  'search',
  'analytics',
  'integration',
  'embedding',
  'ai',
  'automation',
  'utility',
] as const;
const PRICING = ['free', 'pro', 'enterprise'] as const;

export function validateToolManifest(manifest: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['manifest must be an object'] };
  }
  const m = manifest as Record<string, unknown>;

  const requireString = (key: string) => {
    if (typeof m[key] !== 'string' || !m[key]) errors.push(`"${key}" is required`);
  };

  requireString('id');
  if (typeof m.id === 'string' && !ID_PATTERN.test(m.id)) {
    errors.push('"id" must be lowercase alphanumeric with hyphens, e.g. "video-audio"');
  }
  requireString('name');
  requireString('description');
  requireString('icon');
  requireString('packageName');
  requireString('installSize');
  requireString('author');

  if (typeof m.category !== 'string' || !CATEGORIES.includes(m.category as any)) {
    errors.push(`"category" must be one of: ${CATEGORIES.join(', ')}`);
  }
  if (typeof m.pricing !== 'string' || !PRICING.includes(m.pricing as any)) {
    errors.push(`"pricing" must be one of: ${PRICING.join(', ')}`);
  }
  if (typeof m.version !== 'string' || !VERSION_PATTERN.test(m.version)) {
    errors.push('"version" must be semver, e.g. "1.0.0"');
  }
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    errors.push('"capabilities" must be a non-empty array');
  }

  return { valid: errors.length === 0, errors };
}
