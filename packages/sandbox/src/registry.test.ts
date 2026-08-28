import { describe, expect, it } from 'vitest';
import {
  SANDBOX_PROVIDER_LIST,
  getSandboxProvider,
  validateSandboxCredentials,
} from './registry.js';

const EXPECTED_PROVIDER_IDS = [
  'e2b',
  'vercel',
  'modal',
  'daytona',
  'browserbase',
  'flyio',
  'northflank',
  'cloudflare',
  'webcontainers',
];

describe('SANDBOX_PROVIDER_LIST', () => {
  it('registers exactly the nine remote providers', () => {
    expect(SANDBOX_PROVIDER_LIST.map((p) => p.id).sort()).toEqual(
      [...EXPECTED_PROVIDER_IDS].sort(),
    );
  });

  it('gives every provider a label, docs link, and public icon path', () => {
    for (const provider of SANDBOX_PROVIDER_LIST) {
      expect(provider.label.length).toBeGreaterThan(0);
      expect(provider.docsUrl).toMatch(/^https:\/\//);
      expect(provider.icon.startsWith('/')).toBe(true);
    }
  });

  it('requires an executionCaveat exactly when executionSupport is unsupported', () => {
    for (const provider of SANDBOX_PROVIDER_LIST) {
      if (provider.executionSupport === 'unsupported') {
        expect(
          provider.executionCaveat,
          `${provider.id} should explain its limitation`,
        ).toBeTruthy();
      }
    }
  });

  it('flags browserbase, cloudflare, and webcontainers as not general code-execution backends', () => {
    const unsupported = SANDBOX_PROVIDER_LIST.filter(
      (p) => p.executionSupport === 'unsupported',
    ).map((p) => p.id);
    expect(unsupported.sort()).toEqual(['browserbase', 'cloudflare', 'webcontainers']);
  });
});

describe('getSandboxProvider', () => {
  it('returns undefined for local, docker, and custom, which are not registry-backed', () => {
    expect(getSandboxProvider('local')).toBeUndefined();
    expect(getSandboxProvider('docker')).toBeUndefined();
    expect(getSandboxProvider('custom')).toBeUndefined();
  });

  it('returns the matching descriptor for a registered provider', () => {
    expect(getSandboxProvider('e2b')?.label).toBe('E2B');
  });
});

describe('validateSandboxCredentials', () => {
  it('flags every missing required field', () => {
    const vercel = getSandboxProvider('vercel')!;
    const errors = validateSandboxCredentials(vercel, {});
    expect(Object.keys(errors).sort()).toEqual(['projectId', 'teamId', 'token']);
  });

  it('passes once all required fields are present, ignoring optional ones', () => {
    const daytona = getSandboxProvider('daytona')!;
    const errors = validateSandboxCredentials(daytona, { apiKey: 'dtn_123' });
    expect(errors).toEqual({});
  });

  it('treats whitespace-only values as missing', () => {
    const e2b = getSandboxProvider('e2b')!;
    const errors = validateSandboxCredentials(e2b, { apiKey: '   ' });
    expect(errors.apiKey).toBeTruthy();
  });
});
