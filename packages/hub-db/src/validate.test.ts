import { describe, expect, it } from 'vitest';
import { validateToolManifest } from './validate';

const VALID = {
  id: 'my-tool',
  name: 'My Tool',
  description: 'Does a thing.',
  category: 'utility',
  version: '1.0.0',
  pricing: 'free',
  icon: 'Wrench',
  packageName: '@acme/my-tool',
  installSize: '~1 MB',
  author: 'Acme',
  capabilities: ['does-a-thing'],
};

describe('validateToolManifest', () => {
  it('accepts a complete, well-formed manifest', () => {
    expect(validateToolManifest(VALID)).toEqual({ valid: true, errors: [] });
  });

  it('rejects a non-object', () => {
    expect(validateToolManifest(null).valid).toBe(false);
    expect(validateToolManifest('nope').valid).toBe(false);
    expect(validateToolManifest(undefined).valid).toBe(false);
  });

  it('rejects a missing required string field', () => {
    const { valid, errors } = validateToolManifest({ ...VALID, name: undefined });
    expect(valid).toBe(false);
    expect(errors).toContain('"name" is required');
  });

  it('rejects an id with uppercase or invalid characters', () => {
    expect(validateToolManifest({ ...VALID, id: 'My_Tool' }).valid).toBe(false);
    expect(validateToolManifest({ ...VALID, id: '-leading-hyphen' }).valid).toBe(false);
  });

  it('rejects an unknown category', () => {
    const { valid, errors } = validateToolManifest({ ...VALID, category: 'not-a-category' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('category'))).toBe(true);
  });

  it('rejects an unknown pricing tier', () => {
    expect(validateToolManifest({ ...VALID, pricing: 'gold' }).valid).toBe(false);
  });

  it('rejects a non-semver version', () => {
    expect(validateToolManifest({ ...VALID, version: 'v1' }).valid).toBe(false);
    expect(validateToolManifest({ ...VALID, version: '1.0' }).valid).toBe(false);
  });

  it('accepts a semver version with a prerelease/build suffix', () => {
    expect(validateToolManifest({ ...VALID, version: '1.0.0-beta.1' }).valid).toBe(true);
  });

  it('rejects an empty capabilities array', () => {
    const { valid, errors } = validateToolManifest({ ...VALID, capabilities: [] });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('capabilities'))).toBe(true);
  });

  it('collects every violation in one pass rather than stopping at the first', () => {
    const { errors } = validateToolManifest({});
    expect(errors.length).toBeGreaterThan(3);
  });
});
