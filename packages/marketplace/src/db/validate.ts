/** Validates Marketplace tool manifests. */

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
const DISTRIBUTIONS = ['public', 'private'] as const;

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
  if (m.distribution !== undefined && !DISTRIBUTIONS.includes(m.distribution as any)) {
    errors.push('"distribution" must be "public" or "private" when provided');
  }
  if (typeof m.version !== 'string' || !VERSION_PATTERN.test(m.version)) {
    errors.push('"version" must be semver, e.g. "1.0.0"');
  }
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    errors.push('"capabilities" must be a non-empty array');
  }
  if (m.requiresSandbox !== undefined && typeof m.requiresSandbox !== 'boolean') {
    errors.push('"requiresSandbox" must be a boolean when provided');
  }
  if (m.manifestVersion === '3.0') {
    const entrypoints = m.entrypoints as Record<string, unknown> | undefined;
    const runtime = m.runtime as Record<string, unknown> | undefined;
    if (m.kind !== 'tool') errors.push('v3 manifests must set "kind" to "tool"');
    if (!entrypoints || typeof entrypoints.server !== 'string') {
      errors.push('v3 manifests must declare "entrypoints.server"');
    }
    if (
      !runtime ||
      typeof runtime.protocolVersion !== 'string' ||
      typeof runtime.defaultMode !== 'string' ||
      !Array.isArray(runtime.modes) ||
      runtime.modes.length === 0
    ) {
      errors.push(
        'v3 manifests must declare runtime.protocolVersion, runtime.defaultMode, and runtime.modes',
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
