/**
 * Origin policy — the browser-facing security boundary for an Agent.
 *
 * The embedded Widget carries only a public Agent ID (per ADR-004 there is no
 * browser secret). The only thing standing between "my agent" and "anyone's
 * website driving my model bill" is the allow-list on
 * `AgentDefinition.allowedOrigins`, so the matcher lives here in the contracts
 * package: the dashboard route, generated agent servers, and future channel
 * adapters must all decide identically.
 *
 * Rules:
 * - Matching is on **origin** only (`scheme://host[:port]`), never on path.
 * - `*` allows every origin. It is the permissive default for local
 *   development and must be narrowed before a public launch.
 * - `https://*.example.com` matches any single-or-multi-label subdomain of
 *   `example.com`, but not the apex `https://example.com`.
 * - A host-only entry (`example.com`) matches both `http` and `https`, which
 *   keeps hand-typed dashboard input usable.
 * - An explicit port must match. `https://example.com` implies port 443 and
 *   `http://example.com` implies port 80, so the default port may be omitted.
 */

/** Outcome of an origin check, including why the decision was made. */
export interface OriginDecision {
  allowed: boolean;
  /** The normalized origin that was evaluated, or null when none was present. */
  origin: string | null;
  /**
   * Why the request was allowed or denied. Safe to log and to return in an
   * error body — it contains no secrets.
   */
  reason:
    | 'no-origin'
    | 'same-origin'
    | 'wildcard'
    | 'allow-listed'
    | 'not-allow-listed'
    | 'empty-allow-list';
}

/** Normalize any URL or origin string down to `scheme://host[:port]`. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') return null;
  try {
    const url = new URL(trimmed);
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resolve the requesting origin from raw headers.
 *
 * `Origin` is authoritative. `Referer` is only a fallback for the handful of
 * browsers/proxies that strip `Origin` from same-site POSTs; it is reduced to
 * its origin so a path can never influence the decision.
 */
export function resolveRequestOrigin(headers: {
  origin?: string | null;
  referer?: string | null;
}): string | null {
  return normalizeOrigin(headers.origin) ?? normalizeOrigin(headers.referer);
}

function defaultPort(scheme: string): string | null {
  if (scheme === 'https:') return '443';
  if (scheme === 'http:') return '80';
  return null;
}

/** Split an allow-list entry into the parts we compare against. */
function parseEntry(
  entry: string,
): { scheme: string | null; host: string; port: string | null } | null {
  const trimmed = entry.trim().toLowerCase().replace(/\/+$/, '');
  if (!trimmed) return null;

  const schemeMatch = /^([a-z][a-z0-9+.-]*:)\/\//.exec(trimmed);
  const scheme = schemeMatch ? schemeMatch[1] : null;
  let rest = schemeMatch ? trimmed.slice(schemeMatch[0].length) : trimmed;

  // Entries are origins; drop anything a user pasted after the host.
  rest = rest.split('/')[0];
  if (!rest) return null;

  // IPv6 literals keep their brackets; only split a port off the tail.
  let host = rest;
  let port: string | null = null;
  const portMatch = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(rest);
  if (portMatch) {
    host = portMatch[1];
    port = portMatch[2];
  }

  return { scheme, host, port };
}

function hostMatches(pattern: string, host: string): boolean {
  if (pattern === host) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return false;
}

/** Does `origin` satisfy at least one entry of `allowedOrigins`? */
export function isOriginAllowed(
  origin: string | null | undefined,
  allowedOrigins: readonly string[] | null | undefined,
): boolean {
  const entries = (allowedOrigins ?? []).map((e) => e.trim()).filter(Boolean);
  if (entries.some((e) => e === '*')) return true;

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(normalized);
  } catch {
    return false;
  }

  const originScheme = parsedOrigin.protocol;
  const originHost = parsedOrigin.hostname.toLowerCase();
  const originPort = parsedOrigin.port || defaultPort(originScheme);

  return entries.some((entry) => {
    const parsed = parseEntry(entry);
    if (!parsed) return false;
    if (parsed.scheme && parsed.scheme !== originScheme) return false;

    // `URL.hostname` keeps the brackets on IPv6 literals, and `parseEntry`
    // preserves them too, so a direct comparison is correct for both forms.
    if (!hostMatches(parsed.host, originHost)) return false;

    if (parsed.port === null) {
      // No port declared: accept the scheme's default port, or any port when
      // the entry did not pin a scheme either (host-only entries are loose by
      // design so `localhost` keeps working across dev ports).
      if (!parsed.scheme) return true;
      return originPort === defaultPort(parsed.scheme);
    }
    return parsed.port === originPort;
  });
}

/**
 * Full authorization decision for a browser-originated Agent request.
 *
 * Two carve-outs keep server-side and dashboard usage working without
 * loosening the browser boundary:
 * - **No origin at all** → allowed. Server-to-server SDK/CLI calls never send
 *   `Origin`; they are authorized by their API key instead, not by this check.
 * - **Same-origin** → allowed. The dashboard's own playground and any agent
 *   served from the same host must not require the operator to allow-list
 *   themselves.
 */
export function checkAgentOrigin(options: {
  /** Raw `Origin` header value. */
  origin?: string | null;
  /** Raw `Referer` header value, used only when `Origin` is absent. */
  referer?: string | null;
  /** Origin of the server handling the request, for the same-origin carve-out. */
  selfOrigin?: string | null;
  /** `AgentDefinition.allowedOrigins`. */
  allowedOrigins?: readonly string[] | null;
}): OriginDecision {
  const origin = resolveRequestOrigin(options);
  if (!origin) return { allowed: true, origin: null, reason: 'no-origin' };

  const selfOrigin = normalizeOrigin(options.selfOrigin);
  if (selfOrigin && selfOrigin === origin) {
    return { allowed: true, origin, reason: 'same-origin' };
  }

  const entries = (options.allowedOrigins ?? []).map((e) => e.trim()).filter(Boolean);
  if (entries.some((e) => e === '*')) return { allowed: true, origin, reason: 'wildcard' };
  if (entries.length === 0) return { allowed: false, origin, reason: 'empty-allow-list' };

  return isOriginAllowed(origin, entries)
    ? { allowed: true, origin, reason: 'allow-listed' }
    : { allowed: false, origin, reason: 'not-allow-listed' };
}

/**
 * CORS headers for an Agent response.
 *
 * `Access-Control-Allow-Origin` echoes the caller instead of using `*` so that
 * credentialed requests stay possible and so a cached response can never be
 * replayed to a different site. `Vary: Origin` is therefore mandatory.
 *
 * The header is set on **denials too**, which looks surprising but is both safe
 * and necessary. Safe: a denial body carries no agent data, only the sentence
 * explaining the rejection, and anyone can read that by calling the endpoint
 * from a server where CORS does not apply. Necessary: without it the browser
 * hides the 403 behind an opaque `TypeError: Failed to fetch`, so a developer
 * embedding the widget on a domain they forgot to allow-list would see nothing
 * but a generic network error. Enforcement does not depend on this header —
 * it depends on the endpoint refusing to run the agent, and on the preflight
 * returning a non-2xx status, which fails the request no matter what headers
 * accompany it.
 */
export function agentCorsHeaders(decision: OriginDecision): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Larkup-Join-Code',
    'Access-Control-Max-Age': '86400',
  };
  if (decision.origin) {
    headers['Access-Control-Allow-Origin'] = decision.origin;
  }
  return headers;
}

/** Human-readable explanation for a denied request. */
export function originDenialMessage(decision: OriginDecision): string {
  if (decision.reason === 'empty-allow-list') {
    return `Origin "${decision.origin}" is not allowed: this agent has an empty allowed-origins list. Add the origin in Settings → Agents → Connect.`;
  }
  return `Origin "${decision.origin}" is not in this agent's allowed-origins list.`;
}
