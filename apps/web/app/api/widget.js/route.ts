import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * GET /api/widget.js
 *
 * Serves the embeddable Agent Widget bundle to third-party websites:
 *
 * ```html
 * <script async src="https://your-larkup-host/api/widget.js" data-agent="..."></script>
 * ```
 *
 * This is a route rather than a bare `public/` asset because the embed URL is a
 * public contract: it must stay stable across widget versions, carry
 * deliberate cache headers, and be readable cross-origin. Anyone may fetch the
 * bundle — it contains no secret, and the agent's `allowedOrigins` list is
 * enforced on the API calls the widget makes, not on the download.
 */

export const dynamic = 'force-dynamic';

/** Candidate locations, most specific first. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    // Production/standalone: copied into public/ by scripts/copy-widget.mjs.
    path.join(cwd, 'public', 'widget', 'v1.js'),
    path.join(cwd, 'apps', 'web', 'public', 'widget', 'v1.js'),
    // Dev: read straight from the package so `pnpm dev` picks up a rebuild
    // without a copy step.
    path.join(cwd, '..', '..', 'packages', 'agent-widget', 'dist', 'widget.js'),
    path.join(cwd, 'packages', 'agent-widget', 'dist', 'widget.js'),
  ];
}

interface CachedBundle {
  source: string;
  code: string;
  etag: string;
}

let cached: CachedBundle | null = null;

async function loadBundle(): Promise<CachedBundle | null> {
  // In development the bundle is re-read every request so `vite build --watch`
  // changes show up on reload; in production it is read once per process.
  if (cached && process.env.NODE_ENV === 'production') return cached;

  for (const candidate of candidatePaths()) {
    try {
      const code = await readFile(candidate, 'utf8');
      const etag = `"${createHash('sha256').update(code).digest('hex').slice(0, 32)}"`;
      cached = { source: candidate, code, etag };
      return cached;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function GET(req: Request) {
  const bundle = await loadBundle();

  if (!bundle) {
    // 503 rather than 404: the endpoint exists, the artifact is missing.
    return new Response(
      'console.error("[Larkup] widget bundle not built. Run: pnpm --filter @larkup/agent-widget build");',
      {
        status: 503,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/javascript; charset=utf-8',
    // The bundle is public and identical for everyone; revalidation is cheap
    // thanks to the content ETag, so a short max-age keeps upgrades fast.
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    ETag: bundle.etag,
    // A <script src> is not a CORS request, but a customer with a strict CSP
    // may fetch() the bundle instead; allow it explicitly.
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  };

  if (req.headers.get('if-none-match') === bundle.etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(bundle.code, { status: 200, headers });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  });
}
