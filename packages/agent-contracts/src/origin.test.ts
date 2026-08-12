import { describe, expect, it } from 'vitest';
import {
  agentCorsHeaders,
  checkAgentOrigin,
  isOriginAllowed,
  normalizeOrigin,
  resolveRequestOrigin,
} from './origin';

describe('normalizeOrigin', () => {
  it('reduces a full URL to its origin', () => {
    expect(normalizeOrigin('https://acme.com/support/chat?x=1')).toBe('https://acme.com');
  });

  it('lower-cases the host and drops a default port', () => {
    expect(normalizeOrigin('https://ACME.com:443')).toBe('https://acme.com');
  });

  it('keeps a non-default port', () => {
    expect(normalizeOrigin('http://localhost:4567')).toBe('http://localhost:4567');
  });

  it('returns null for empty, opaque, or unparsable values', () => {
    expect(normalizeOrigin(undefined)).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('acme.com')).toBeNull();
  });
});

describe('resolveRequestOrigin', () => {
  it('prefers Origin over Referer', () => {
    expect(resolveRequestOrigin({ origin: 'https://a.com', referer: 'https://b.com/page' })).toBe(
      'https://a.com',
    );
  });

  it('falls back to the Referer origin only, never its path', () => {
    expect(resolveRequestOrigin({ referer: 'https://b.com/deep/page?q=1' })).toBe('https://b.com');
  });

  it('ignores an opaque Origin and uses the Referer', () => {
    expect(resolveRequestOrigin({ origin: 'null', referer: 'https://b.com/x' })).toBe(
      'https://b.com',
    );
  });
});

describe('isOriginAllowed', () => {
  it('matches an exact origin', () => {
    expect(isOriginAllowed('https://acme.com', ['https://acme.com'])).toBe(true);
  });

  it('tolerates a trailing slash in the allow-list entry', () => {
    expect(isOriginAllowed('https://acme.com', ['https://acme.com/'])).toBe(true);
  });

  it('ignores a path pasted into the allow-list entry', () => {
    expect(isOriginAllowed('https://acme.com', ['https://acme.com/support'])).toBe(true);
  });

  it('rejects a different host', () => {
    expect(isOriginAllowed('https://evil.com', ['https://acme.com'])).toBe(false);
  });

  it('rejects a scheme downgrade when the entry pins https', () => {
    expect(isOriginAllowed('http://acme.com', ['https://acme.com'])).toBe(false);
  });

  it('allows both schemes for a host-only entry', () => {
    expect(isOriginAllowed('http://acme.com', ['acme.com'])).toBe(true);
    expect(isOriginAllowed('https://acme.com', ['acme.com'])).toBe(true);
  });

  it('requires a pinned port to match', () => {
    expect(isOriginAllowed('http://localhost:4567', ['http://localhost:4567'])).toBe(true);
    expect(isOriginAllowed('http://localhost:5000', ['http://localhost:4567'])).toBe(false);
  });

  it('treats an omitted port as the scheme default', () => {
    expect(isOriginAllowed('https://acme.com', ['https://acme.com'])).toBe(true);
    expect(isOriginAllowed('https://acme.com:8443', ['https://acme.com'])).toBe(false);
  });

  it('matches subdomains for a wildcard entry but not the apex', () => {
    expect(isOriginAllowed('https://shop.acme.com', ['https://*.acme.com'])).toBe(true);
    expect(isOriginAllowed('https://eu.shop.acme.com', ['https://*.acme.com'])).toBe(true);
    expect(isOriginAllowed('https://acme.com', ['https://*.acme.com'])).toBe(false);
  });

  it('does not let a wildcard leak into a lookalike domain', () => {
    expect(isOriginAllowed('https://notacme.com', ['https://*.acme.com'])).toBe(false);
    expect(isOriginAllowed('https://acme.com.evil.com', ['https://*.acme.com'])).toBe(false);
  });

  it('allows everything for "*"', () => {
    expect(isOriginAllowed('https://anything.example', ['*'])).toBe(true);
  });

  it('allows "*" even with no origin present', () => {
    expect(isOriginAllowed(null, ['*'])).toBe(true);
  });

  it('denies when the allow-list is empty or missing', () => {
    expect(isOriginAllowed('https://acme.com', [])).toBe(false);
    expect(isOriginAllowed('https://acme.com', undefined)).toBe(false);
  });

  it('ignores blank entries', () => {
    expect(isOriginAllowed('https://acme.com', ['', '  ', 'https://acme.com'])).toBe(true);
    expect(isOriginAllowed('https://acme.com', ['', '  '])).toBe(false);
  });

  it('is case-insensitive on host', () => {
    expect(isOriginAllowed('https://ACME.com', ['https://acme.COM'])).toBe(true);
  });

  it('matches IPv6 literals with a port', () => {
    expect(isOriginAllowed('http://[::1]:8080', ['http://[::1]:8080'])).toBe(true);
    expect(isOriginAllowed('http://[::1]:8080', ['http://[::1]:9090'])).toBe(false);
  });
});

describe('checkAgentOrigin', () => {
  it('allows server-to-server calls that carry no Origin', () => {
    const decision = checkAgentOrigin({ allowedOrigins: ['https://acme.com'] });
    expect(decision).toEqual({ allowed: true, origin: null, reason: 'no-origin' });
  });

  it('allows a same-origin request without requiring an allow-list entry', () => {
    const decision = checkAgentOrigin({
      origin: 'http://localhost:4567',
      selfOrigin: 'http://localhost:4567/api/agents/x/chat',
      allowedOrigins: [],
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('same-origin');
  });

  it('denies a cross-origin request when the allow-list is empty', () => {
    const decision = checkAgentOrigin({
      origin: 'https://evil.com',
      selfOrigin: 'http://localhost:4567',
      allowedOrigins: [],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('empty-allow-list');
  });

  it('denies a cross-origin request that is not allow-listed', () => {
    const decision = checkAgentOrigin({
      origin: 'https://evil.com',
      selfOrigin: 'http://localhost:4567',
      allowedOrigins: ['https://acme.com'],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('not-allow-listed');
  });

  it('allows an allow-listed cross-origin request', () => {
    const decision = checkAgentOrigin({
      origin: 'https://shop.acme.com',
      selfOrigin: 'https://agents.larkup.ai',
      allowedOrigins: ['https://*.acme.com'],
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('allow-listed');
  });

  it('reports the wildcard reason so the dashboard can warn about it', () => {
    const decision = checkAgentOrigin({
      origin: 'https://evil.com',
      allowedOrigins: ['*'],
    });
    expect(decision).toMatchObject({ allowed: true, reason: 'wildcard' });
  });
});

describe('agentCorsHeaders', () => {
  it('echoes the caller origin instead of "*" and always varies on Origin', () => {
    const headers = agentCorsHeaders({
      allowed: true,
      origin: 'https://acme.com',
      reason: 'allow-listed',
    });
    expect(headers['Access-Control-Allow-Origin']).toBe('https://acme.com');
    expect(headers.Vary).toBe('Origin');
  });

  it('still echoes the origin on a denial so the browser can surface the reason', () => {
    // The denial body has no agent data in it, and without this header the
    // widget only ever sees an opaque "Failed to fetch".
    const headers = agentCorsHeaders({
      allowed: false,
      origin: 'https://evil.com',
      reason: 'not-allow-listed',
    });
    expect(headers['Access-Control-Allow-Origin']).toBe('https://evil.com');
  });

  it('omits Access-Control-Allow-Origin for originless calls', () => {
    const headers = agentCorsHeaders({ allowed: true, origin: null, reason: 'no-origin' });
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
