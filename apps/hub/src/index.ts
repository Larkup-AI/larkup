import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getHubDb } from '@larkup/hub-db';
import {
  getExtension,
  listExtensions,
  ManifestInvalidError,
  NotOwnerError,
  publishExtension,
  recordInstall,
  VersionExistsError,
} from '@larkup/hub-db/repo';
import type { CatalogEntry } from '@larkup/hub-db/repo';
import type {
  ToolDescriptor,
  ToolDetailResponse,
  ToolListResponse,
  PublishRequest,
} from './types.js';

/* ------------------------------------------------------------------ */
/* App setup                                                           */
/* ------------------------------------------------------------------ */

const app = new Hono();

// `getHubDb()` is called per-request rather than once at module load: a
// module-level connection would be established (and DATABASE_URL read) the
// moment anything imports this file, including tests that need to load a
// non-default env file first. `getHubDb()` caches internally either way, so
// this costs nothing per request beyond the cache lookup.

// CORS — allow any Larkup client
app.use('*', cors());

/**
 * Reconstruct the pre-migration `ToolDescriptor` response shape from a
 * catalog entry. `entry.manifest` is the exact JSON the publisher submitted
 * (see `packages/hub-db/src/repo.ts`'s `extension_versions.manifest`), so
 * every route that returned a `ToolDescriptor` before this migration keeps
 * returning byte-identical shapes — only `downloads` is computed live now,
 * from real per-workspace installs instead of a static seed number.
 */
function toDescriptor(entry: CatalogEntry): ToolDescriptor {
  return { ...(entry.manifest as ToolDescriptor), downloads: entry.installs };
}

function slugifyPublisherId(author: string): string {
  const slug = author
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unknown-publisher';
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'larkup-hub',
    version: '0.2.0',
    description: 'Larkup Marketplace Hub API — tool catalog, install tracking, and publishing.',
  });
});

/* ------------------------------------------------------------------ */
/* Tool catalog                                                        */
/* ------------------------------------------------------------------ */

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

  const db = getHubDb();
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
  const found = await getExtension(getHubDb(), toolId, { workspaceId });

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
  };

  c.header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return c.json(response);
});

/* ------------------------------------------------------------------ */
/* Install tracking                                                    */
/* ------------------------------------------------------------------ */

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

  const result = await recordInstall(getHubDb(), toolId, workspaceId);
  if (!result) {
    return c.json({ error: 'Tool not found' }, 404);
  }

  return c.json({ toolId, installs: result.installs });
});

/* ------------------------------------------------------------------ */
/* curl install script                                                 */
/* ------------------------------------------------------------------ */

/**
 * GET /v1/tools/:id/install.sh — Returns a shell script that installs the tool.
 *
 * Usage: curl -sL hub.larkup.de/v1/tools/video-audio/install.sh | sh
 */
app.get('/v1/tools/:id/install.sh', async (c) => {
  const toolId = c.req.param('id');
  const found = await getExtension(getHubDb(), toolId);

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

/* ------------------------------------------------------------------ */
/* Publishing (CI webhook)                                             */
/* ------------------------------------------------------------------ */

/**
 * POST /v1/tools/publish — Publish or update a tool.
 *
 * Called by CI after `npm publish`. Protected by API key.
 *
 * Body: { manifest: ToolDescriptor, apiKey?: string }
 *
 * The request/response shape is unchanged from before this migration. What
 * changed underneath: the manifest is now actually validated (previously
 * only `id` and `packageName` were checked), publishing is durable across a
 * restart, and a publish under an id someone else already owns is rejected
 * rather than silently overwriting their listing.
 *
 * Publisher identity: there is no per-publisher key yet (`HUB_PUBLISH_KEY`
 * is one shared secret, unchanged from before) — the publisher id is
 * derived from `manifest.author`. This keeps the request shape stable and
 * gives real ownership/attribution today; a rotatable per-publisher key is
 * `publisher_keys`, deferred to TASK 09 alongside entitlements (see
 * ADR-012).
 */
app.post('/v1/tools/publish', async (c) => {
  let body: PublishRequest;
  try {
    body = (await c.req.json()) as PublishRequest;
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const expectedKey = process.env.HUB_PUBLISH_KEY;
  if (expectedKey && body.apiKey !== expectedKey) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  if (!body.manifest || typeof body.manifest !== 'object') {
    return c.json({ error: 'Invalid manifest: manifest object is required' }, 400);
  }

  const publisherId = slugifyPublisherId(body.manifest.author ?? '');

  try {
    const result = await publishExtension(getHubDb(), {
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

/* ------------------------------------------------------------------ */
/* JSON Schema for tool.manifest.json                                  */
/* ------------------------------------------------------------------ */

app.get('/v1/schema/tool-manifest.v1', (c) => {
  c.header('Cache-Control', 'public, s-maxage=3600');
  return c.json({
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Larkup Tool Manifest',
    description: 'Schema for tool.manifest.json files.',
    type: 'object',
    required: [
      'id',
      'name',
      'description',
      'category',
      'version',
      'pricing',
      'icon',
      'packageName',
      'installSize',
      'author',
      'capabilities',
    ],
    properties: {
      id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$' },
      name: { type: 'string' },
      description: { type: 'string' },
      longDescription: { type: 'string' },
      category: {
        type: 'string',
        enum: [
          'media',
          'search',
          'analytics',
          'integration',
          'embedding',
          'ai',
          'automation',
          'utility',
        ],
      },
      version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' },
      pricing: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
      emoji: { type: 'string' },
      iconUrl: { type: 'string', format: 'uri' },
      icon: { type: 'string' },
      packageName: { type: 'string' },
      installSize: { type: 'string' },
      systemDeps: { type: 'array', items: { type: 'string' } },
      author: { type: 'string' },
      capabilities: { type: 'array', items: { type: 'string' }, minItems: 1 },
      configSchema: { type: 'array' },
      tags: { type: 'array', items: { type: 'string' } },
      downloads: { type: 'number' },
      repositoryUrl: { type: 'string', format: 'uri' },
      license: { type: 'string' },
      updatedAt: { type: 'string' },
      comingSoon: { type: 'boolean' },
    },
  });
});

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

export default app;

/* ------------------------------------------------------------------ */
/* Local dev server (tsx watch)                                        */
/* ------------------------------------------------------------------ */

if (!process.env.VERCEL && !process.env.VITEST) {
  import('@hono/node-server').then(({ serve }) => {
    const port = Number(process.env.PORT || 3456);
    serve({ fetch: app.fetch, port }, () => {
      console.log(`[larkup-hub] listening on http://localhost:${port}`);
    });
  });
}
