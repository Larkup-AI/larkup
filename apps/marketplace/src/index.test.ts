/** Use the local Marketplace database for contract tests. */
import { config as loadEnv } from 'dotenv';
import { connect } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hubDbEnvPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/marketplace/.env',
);
loadEnv({ path: hubDbEnvPath });
const databaseUrl = process.env.DATABASE_URL ?? '';
if (databaseUrl && !/localhost|127\.0\.0\.1/.test(databaseUrl)) {
  throw new Error(
    `Refusing to run Hub tests against a non-local DATABASE_URL. Expected packages/marketplace/.env; got: ${hubDbEnvPath}`,
  );
}

/**
 * These are contract tests against a real Postgres. A contributor who has not
 * started one still gets a green `pnpm test`; CI provisions the database so the
 * suite runs for real there.
 */
async function marketplaceDbIsReachable(): Promise<boolean> {
  if (!databaseUrl) return false;
  const { hostname, port } = new URL(databaseUrl);
  return await new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port || 5432) });
    const settle = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(2_000);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

const hasDb = await marketplaceDbIsReachable();
if (!hasDb) {
  console.warn(
    '[hub] skipping Marketplace contract tests: no database at DATABASE_URL. ' +
      'Start one with `docker compose -f docker/marketplace-db.yml up -d` and ' +
      '`cp packages/marketplace/.env.example packages/marketplace/.env`.',
  );
}

import { getMarketplaceDb } from '@larkup/marketplace/db';
import {
  auditEvents,
  extensionAccessKeys,
  extensionVersions,
  extensionWorkspaceGrants,
  extensions,
  publishers,
  workspaceInstallations,
} from '@larkup/marketplace/db/schema';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import app from './index.js';

/** Marketplace Hub API contract tests. */

const describeDb = hasDb ? describe : describe.skip;

const RUN = Math.random().toString(36).slice(2, 8);
const toolId = `contract-test-${RUN}`;

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: toolId,
    name: 'Contract Test Tool',
    description: 'Exercises the /v1/* routes end to end.',
    category: 'utility',
    version: '1.0.0',
    pricing: 'free',
    icon: 'Box',
    packageName: '@acme/contract-test-tool',
    installSize: '~1 MB',
    author: `Contract Test Author ${RUN}`,
    capabilities: ['test'],
    ...overrides,
  };
}

const privateToolId = `contract-private-${RUN}`;

afterAll(async () => {
  if (!hasDb) return;
  const db = getMarketplaceDb();
  const ids = [toolId, privateToolId];
  await db.delete(auditEvents).where(inArray(auditEvents.extensionId, ids));
  await db.delete(workspaceInstallations).where(inArray(workspaceInstallations.extensionId, ids));
  await db.delete(extensionAccessKeys).where(inArray(extensionAccessKeys.extensionId, ids));
  await db
    .delete(extensionWorkspaceGrants)
    .where(inArray(extensionWorkspaceGrants.extensionId, ids));
  await db.delete(extensionVersions).where(inArray(extensionVersions.extensionId, ids));
  await db.delete(extensions).where(inArray(extensions.id, ids));
  const publisherId = `contract-test-author-${RUN}`;
  await db.delete(publishers).where(inArray(publishers.id, [publisherId]));
});

describeDb('GET /', () => {
  it('reports service identity', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe('larkup-hub');
  });
});

describeDb('POST /v1/tools/publish', () => {
  it('fails closed when production publishing has no configured key', async () => {
    const originalEnvironment = process.env.VERCEL_ENV;
    const originalKey = process.env.HUB_PUBLISH_KEY;
    delete process.env.HUB_PUBLISH_KEY;
    process.env.VERCEL_ENV = 'production';

    const res = await app.request('/v1/tools/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: manifest() }),
    });

    expect(res.status).toBe(503);
    if (originalEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalEnvironment;
    if (originalKey === undefined) delete process.env.HUB_PUBLISH_KEY;
    else process.env.HUB_PUBLISH_KEY = originalKey;
  });

  it('rejects an invalid manifest with the validation errors', async () => {
    const res = await app.request('/v1/tools/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: { id: 'bad' } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('publishes a valid manifest and it appears in the catalog', async () => {
    const res = await app.request('/v1/tools/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: manifest() }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ status: 'published', toolId, version: '1.0.0' });

    const list = await app.request(`/v1/tools?search=${encodeURIComponent('Contract Test Tool')}`);
    const listBody = await list.json();
    expect(listBody.tools.some((t: { id: string }) => t.id === toolId)).toBe(true);
  });

  it('rejects republishing the same version with 409', async () => {
    const res = await app.request('/v1/tools/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: manifest() }),
    });
    expect(res.status).toBe(409);
  });

  it('rejects a publish under a different author for an id already taken, with 403', async () => {
    const res = await app.request('/v1/tools/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: manifest({ version: '2.0.0', author: 'A Different Author' }),
      }),
    });
    expect(res.status).toBe(403);
  });

  it('enforces HUB_PUBLISH_KEY when it is configured', async () => {
    process.env.HUB_PUBLISH_KEY = 'test-secret-key';
    try {
      const wrong = await app.request('/v1/tools/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: manifest({ id: `${toolId}-keyed`, version: '1.0.0' }) }),
      });
      expect(wrong.status).toBe(401);

      const right = await app.request('/v1/tools/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manifest: manifest({ id: `${toolId}-keyed`, version: '1.0.0' }),
          apiKey: 'test-secret-key',
        }),
      });
      expect(right.status).toBe(201);

      const db = getMarketplaceDb();
      await db
        .delete(extensionVersions)
        .where(inArray(extensionVersions.extensionId, [`${toolId}-keyed`]));
      await db.delete(extensions).where(inArray(extensions.id, [`${toolId}-keyed`]));
    } finally {
      delete process.env.HUB_PUBLISH_KEY;
    }
  });
});

describeDb('GET /v1/tools/:id', () => {
  it('returns the tool with a version history', async () => {
    const res = await app.request(`/v1/tools/${toolId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tool.id).toBe(toolId);
    expect(body.tool.name).toBe('Contract Test Tool');
    expect(body.versions.length).toBeGreaterThanOrEqual(1);
  });

  it('404s an unknown tool', async () => {
    const res = await app.request('/v1/tools/does-not-exist-xyz');
    expect(res.status).toBe(404);
  });
});

describeDb('POST /v1/tools/:id/installed', () => {
  it('accepts an empty install request', async () => {
    const res = await app.request(`/v1/tools/${toolId}/installed`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installs).toBeGreaterThanOrEqual(1);
  });

  it('counts a distinct workspaceId separately from the anonymous bucket', async () => {
    const before = await (
      await app.request(`/v1/tools/${toolId}/installed`, { method: 'POST' })
    ).json();
    const after = await (
      await app.request(`/v1/tools/${toolId}/installed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: `ws-${RUN}` }),
      })
    ).json();
    expect(after.installs).toBe(before.installs + 1);
  });

  it('404s an unknown tool', async () => {
    const res = await app.request('/v1/tools/does-not-exist-xyz/installed', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describeDb('GET /v1/tools/:id/install.sh', () => {
  it('returns a shell script naming the package', async () => {
    const res = await app.request(`/v1/tools/${toolId}/install.sh`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const script = await res.text();
    expect(script).toContain('@acme/contract-test-tool');
  });
});

describeDb('GET /v1/schema/tool-manifest.v1', () => {
  it('serves the manifest JSON Schema', async () => {
    const res = await app.request('/v1/schema/tool-manifest.v1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Larkup Tool Manifest');
  });
});

describeDb('private tools: discovery, keys, and install', () => {
  it('publishes a private tool', async () => {
    const publish = await app.request('/v1/tools/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: manifest({
          id: privateToolId,
          name: 'Private Contract Tool',
          distribution: 'private',
        }),
      }),
    });
    expect(publish.status).toBe(201);
  });

  it('is discoverable by exact id but marked unauthorized, and absent from search', async () => {
    const detail = await app.request(`/v1/tools/${privateToolId}`);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.tool.id).toBe(privateToolId);
    expect(detailBody.authorized).toBe(false);

    const search = await app.request(
      `/v1/tools?search=${encodeURIComponent('Private Contract Tool')}`,
    );
    const searchBody = await search.json();
    expect(searchBody.tools.some((t: { id: string }) => t.id === privateToolId)).toBe(false);
  });

  it('rejects install without a grant, then allows it after a key is redeemed', async () => {
    const blocked = await app.request(`/v1/tools/${privateToolId}/installed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: `ws-${RUN}` }),
    });
    expect(blocked.status).toBe(403);

    const issue = await app.request(`/v1/tools/${privateToolId}/access-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'workspace', createdBy: 'test-admin' }),
    });
    expect(issue.status).toBe(201);
    const { accessKey } = await issue.json();

    const badRedeem = await app.request(`/v1/tools/${privateToolId}/redeem-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: 'lk_key_wrong', workspaceId: `ws-${RUN}` }),
    });
    expect(badRedeem.status).toBe(403);

    const redeem = await app.request(`/v1/tools/${privateToolId}/redeem-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey, workspaceId: `ws-${RUN}` }),
    });
    expect(redeem.status).toBe(200);

    const allowed = await app.request(`/v1/tools/${privateToolId}/installed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: `ws-${RUN}` }),
    });
    expect(allowed.status).toBe(200);

    const detail = await app.request(`/v1/tools/${privateToolId}?workspaceId=ws-${RUN}`);
    const detailBody = await detail.json();
    expect(detailBody.authorized).toBe(true);
  });

  it('enforces HUB_PUBLISH_KEY on key management routes when configured', async () => {
    process.env.HUB_PUBLISH_KEY = 'test-secret-key';
    try {
      const res = await app.request(`/v1/tools/${privateToolId}/access-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'workspace', createdBy: 'test-admin' }),
      });
      expect(res.status).toBe(401);
    } finally {
      delete process.env.HUB_PUBLISH_KEY;
    }
  });

  it('revokes a key so it can no longer be redeemed', async () => {
    const issue = await app.request(`/v1/tools/${privateToolId}/access-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'workspace', createdBy: 'test-admin' }),
    });
    const { id: keyId, accessKey } = await issue.json();

    const revoke = await app.request(`/v1/tools/${privateToolId}/access-keys/${keyId}/revoke`, {
      method: 'POST',
    });
    expect(revoke.status).toBe(200);

    const redeem = await app.request(`/v1/tools/${privateToolId}/redeem-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey, workspaceId: `ws-revoked-${RUN}` }),
    });
    expect(redeem.status).toBe(403);
  });
});
