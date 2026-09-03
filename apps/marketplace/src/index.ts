import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getMarketplaceDb } from '@larkup/marketplace/db';
import {
  getExtension,
  InvalidAccessKeyError,
  issueAccessKey,
  listAccessKeys,
  listExtensions,
  ManifestInvalidError,
  NotAuthorizedError,
  NotOwnerError,
  publishExtension,
  recordInstall,
  redeemAccessKey,
  revokeAccessKey,
  VersionExistsError,
} from '@larkup/marketplace/db/repo';
import type { CatalogEntry } from '@larkup/marketplace/db/repo';
import type {
  ToolDescriptor,
  ToolDetailResponse,
  ToolListResponse,
  PublishRequest,
} from './types.js';
import { toolManifestV1Schema, toolManifestV2Schema, toolManifestV3Schema } from './schemas.js';

// App setup                                                           */

const app = new Hono();

// Allow requests from Larkup clients.
app.use('*', cors());

/** Builds the public tool descriptor. */
function toDescriptor(entry: CatalogEntry): ToolDescriptor {
  return {
    ...(entry.manifest as ToolDescriptor),
    requiresSandbox: entry.requiresSandbox,
    downloads: entry.installs,
  };
}

function slugifyPublisherId(author: string): string {
  const slug = author
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unknown-publisher';
}
// Health                                                              */

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'larkup-hub',
    version: '0.2.0',
    description: 'Larkup Marketplace Hub API — tool catalog, install tracking, and publishing.',
  });
});

// Tool catalog                                                        */

/**
 * GET /v1/tools — List all available tools.
 *
 * Query params:
 *   ?category=media     — Filter by category
 *   ?search=video       — Full-text search
 *   ?page=1&limit=20    — Pagination
 *   ?workspaceId=ws_1   — Include private extensions granted to this workspace
 */
app.get('/v1/tools', async (c) => {
  const category = c.req.query('category');
  const search = c.req.query('search');
  const workspaceId = c.req.query('workspaceId');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 100);

  const db = getMarketplaceDb();
  const { entries, total } = await listExtensions(db, {
    category,
    search,
    workspaceId,
    limit,
    offset: (page - 1) * limit,
  });

  const response: ToolListResponse = { tools: entries.map(toDescriptor), total };

  // Cache catalog responses at edge for 60 seconds
  c.header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return c.json(response);
});

/**
 * GET /v1/tools/:id — Get full tool details.
 */
app.get('/v1/tools/:id', async (c) => {
  const toolId = c.req.param('id');
  const workspaceId = c.req.query('workspaceId');
  const found = await getExtension(getMarketplaceDb(), toolId, { workspaceId });

  if (!found) {
    return c.json({ error: 'Tool not found' }, 404);
  }

  const response: ToolDetailResponse = {
    tool: toDescriptor(found.entry),
    installs: found.entry.installs,
    versions: found.versions.map((v) => ({
      version: v.version,
      publishedAt: v.publishedAt.toISOString(),
    })),
    authorized: found.authorized,
  };

  c.header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return c.json(response);
});

// Install tracking

/**
 * POST /v1/tools/:id/installed — Track an install.
 *
 * Called by the marketplace installer after a successful install.
 * Fire-and-forget from the client side. Body is optional for backward
 * compatibility — `packages/marketplace`'s installer sends none today, so
 * installs from it bucket under a shared "anonymous" workspace until it is
 * updated to send a real one; a caller that does send `workspaceId` gets
 * accurate per-workspace tracking immediately, no Hub change required.
 */
app.post('/v1/tools/:id/installed', async (c) => {
  const toolId = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as { workspaceId?: string }));
  const workspaceId = body.workspaceId || 'anonymous';

  try {
    const result = await recordInstall(getMarketplaceDb(), toolId, workspaceId);
    if (!result) {
      return c.json({ error: 'Tool not found' }, 404);
    }
    return c.json({ toolId, installs: result.installs });
  } catch (err) {
    if (err instanceof NotAuthorizedError) {
      return c.json({ error: err.message }, 403);
    }
    throw err;
  }
});

// Private tool access keys                                            */

/** Hub-side publisher/admin auth, shared by every access-key management route. */
function requireHubAdminKey(c: import('hono').Context): Response | null {
  const expectedKey = process.env.HUB_PUBLISH_KEY;
  if (process.env.VERCEL_ENV === 'production' && !expectedKey) {
    return c.json({ error: 'Marketplace publishing is not configured.' }, 503);
  }
  const received = c.req.header('x-hub-admin-key');
  if (expectedKey && received !== expectedKey) {
    return c.json({ error: 'Invalid API key' }, 401);
  }
  return null;
}

/**
 * POST /v1/tools/:id/access-keys — issue a new private-tool access key.
 * Admin-authenticated (same HUB_PUBLISH_KEY used by /v1/tools/publish).
 */
app.post('/v1/tools/:id/access-keys', async (c) => {
  const denied = requireHubAdminKey(c);
  if (denied) return denied;

  const toolId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    scope?: 'workspace' | 'organization' | 'user';
    scopeId?: string;
    maxInstalls?: number;
    expiresAt?: string;
    createdBy?: string;
  };
  if (!body.scope) return c.json({ error: '"scope" is required.' }, 400);

  try {
    const result = await issueAccessKey(getMarketplaceDb(), {
      extensionId: toolId,
      scope: body.scope,
      scopeId: body.scopeId,
      maxInstalls: body.maxInstalls,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      createdBy: body.createdBy || 'hub-admin',
    });
    return c.json(result, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not issue key' }, 400);
  }
});

/** GET /v1/tools/:id/access-keys — list issued keys (hashes never returned). */
app.get('/v1/tools/:id/access-keys', async (c) => {
  const denied = requireHubAdminKey(c);
  if (denied) return denied;
  const keys = await listAccessKeys(getMarketplaceDb(), c.req.param('id'));
  return c.json({ keys });
});

/** POST /v1/tools/:id/access-keys/:keyId/revoke — revoke a key. */
app.post('/v1/tools/:id/access-keys/:keyId/revoke', async (c) => {
  const denied = requireHubAdminKey(c);
  if (denied) return denied;
  try {
    await revokeAccessKey(
      getMarketplaceDb(),
      c.req.param('id'),
      c.req.param('keyId'),
      c.req.header('x-hub-admin-key') || 'hub-admin',
    );
    return c.json({ revoked: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not revoke key' }, 400);
  }
});

/**
 * POST /v1/tools/:id/redeem-key — the only public access-key route. Turns a
 * valid, unexpired, unrevoked key into a standing workspace grant.
 */
app.post('/v1/tools/:id/redeem-key', async (c) => {
  const toolId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    accessKey?: string;
    workspaceId?: string;
  };
  if (!body.accessKey || !body.workspaceId) {
    return c.json({ error: '"accessKey" and "workspaceId" are required.' }, 400);
  }

  try {
    await redeemAccessKey(getMarketplaceDb(), toolId, body.accessKey, body.workspaceId);
    return c.json({ authorized: true });
  } catch (err) {
    if (err instanceof InvalidAccessKeyError) {
      return c.json({ error: err.message }, 403);
    }
    throw err;
  }
});

// curl install script

/**
 * GET /v1/tools/:id/install.sh — Returns a shell script that installs the tool.
 *
 * Usage: curl -sL hub.larkup.de/v1/tools/video-audio/install.sh | sh
 */
app.get('/v1/tools/:id/install.sh', async (c) => {
  const toolId = c.req.param('id');
  const found = await getExtension(getMarketplaceDb(), toolId);

  if (!found) {
    return c.text('echo "Error: Tool not found"; exit 1', 404);
  }

  const manifest = toDescriptor(found.entry);
  const script = `#!/bin/sh
# Larkup Marketplace — Install ${manifest.name}
# Generated by hub.larkup.de
set -e

echo "🚀 Installing ${manifest.name} v${manifest.version}..."
echo ""

# Check system dependencies
${
  manifest.systemDeps?.length
    ? manifest.systemDeps
        .map(
          (dep) => `if ! command -v ${dep} > /dev/null 2>&1; then
  echo "❌ Missing system dependency: ${dep}"
  echo "   Please install ${dep} first."
  exit 1
fi`,
        )
        .join('\n')
    : '# No system dependencies required'
}

# Create tools directory
TOOLS_DIR=".larkup/tools"
mkdir -p "$TOOLS_DIR"

# Initialize package.json if needed
if [ ! -f "$TOOLS_DIR/package.json" ]; then
  echo '{"name":"larkup-tools","version":"1.0.0","private":true}' > "$TOOLS_DIR/package.json"
fi

# Install the tool
echo "📦 Downloading ${manifest.packageName}@${manifest.version}..."
npm install ${manifest.packageName}@${
    manifest.version
  } --prefix "$TOOLS_DIR" --save --no-audit --no-fund

# Record in installed.json
MANIFEST_FILE="$TOOLS_DIR/installed.json"
if [ ! -f "$MANIFEST_FILE" ]; then
  echo '{"tools":[],"downloadCounts":{},"updatedAt":""}' > "$MANIFEST_FILE"
fi

# Update installed.json using node
node -e "
  const fs = require('fs');
  const manifest = JSON.parse(fs.readFileSync('$MANIFEST_FILE', 'utf8'));
  const entry = {
    id: '${manifest.id}',
    version: '${manifest.version}',
    installedAt: new Date().toISOString(),
    packageName: '${manifest.packageName}',
    resolvedPath: '$TOOLS_DIR/node_modules/${manifest.packageName}',
    source: 'registry',
    config: {}
  };
  manifest.tools = manifest.tools.filter(t => t.id !== '${manifest.id}');
  manifest.tools.push(entry);
  manifest.downloadCounts['${manifest.id}'] = (manifest.downloadCounts['${manifest.id}'] || 0) + 1;
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync('$MANIFEST_FILE', JSON.stringify(manifest, null, 2));
"

echo ""
echo "✅ ${manifest.name} installed successfully!"
echo "   Version: ${manifest.version}"
echo "   Location: $TOOLS_DIR/node_modules/${manifest.packageName}"
`;

  c.header('Content-Type', 'text/plain; charset=utf-8');
  c.header('Content-Disposition', `inline; filename="install-${toolId}.sh"`);
  return c.text(script);
});

/** Publishes a Marketplace tool from CI. */
app.post('/v1/tools/publish', async (c) => {
  let body: PublishRequest;
  try {
    body = (await c.req.json()) as PublishRequest;
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const expectedKey = process.env.HUB_PUBLISH_KEY;
  if (process.env.VERCEL_ENV === 'production' && !expectedKey) {
    console.error('[marketplace] HUB_PUBLISH_KEY is not configured for production publishing');
    return c.json({ error: 'Marketplace publishing is not configured.' }, 503);
  }
  if (expectedKey && body.apiKey !== expectedKey) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  if (!body.manifest || typeof body.manifest !== 'object') {
    return c.json({ error: 'Invalid manifest: manifest object is required' }, 400);
  }

  const publisherId = slugifyPublisherId(body.manifest.author ?? '');

  try {
    const result = await publishExtension(getMarketplaceDb(), {
      manifest: body.manifest as unknown as Record<string, unknown>,
      publisherId,
      publisherName: body.manifest.author,
    });
    return c.json(
      { status: 'published', toolId: result.extensionId, version: result.version },
      201,
    );
  } catch (err) {
    if (err instanceof ManifestInvalidError) {
      return c.json({ error: err.message, errors: err.errors }, 400);
    }
    if (err instanceof NotOwnerError) {
      return c.json({ error: err.message }, 403);
    }
    if (err instanceof VersionExistsError) {
      return c.json({ error: err.message }, 409);
    }
    console.error('[hub] publish failed:', err);
    return c.json({ error: 'Publish failed' }, 500);
  }
});

// JSON Schema for tool.manifest.json                                  */

app.get('/v1/schema/tool-manifest.v1', (c) => {
  c.header('Cache-Control', 'public, s-maxage=3600');
  return c.json(toolManifestV1Schema);
});

/**
 * These are the exact URLs every tool.manifest.json points to via `$schema`
 * (https://hub.larkup.de/schemas/tool-manifest.v{1,2}.json). The catch-all
 * Vercel rewrite in vercel.json routes every path to this Hono app, so a copy
 * under `public/schemas/` alone never gets served — it must be an explicit
 * route here.
 */
app.get('/schemas/tool-manifest.v1.json', (c) => {
  c.header('Cache-Control', 'public, s-maxage=3600');
  return c.json(toolManifestV1Schema);
});

app.get('/schemas/tool-manifest.v2.json', (c) => {
  c.header('Cache-Control', 'public, s-maxage=3600');
  return c.json(toolManifestV2Schema);
});

app.get('/schemas/tool-manifest.v3.json', (c) => {
  c.header('Cache-Control', 'public, s-maxage=3600');
  return c.json(toolManifestV3Schema);
});

// Export                                                               */

export default app;

// Local dev server (tsx watch)

if (!process.env.VERCEL && !process.env.VITEST) {
  import('@hono/node-server').then(({ serve }) => {
    const port = Number(process.env.PORT || 3456);
    serve({ fetch: app.fetch, port }, () => {
      console.log(`[larkup-hub] listening on http://localhost:${port}`);
    });
  });
}
