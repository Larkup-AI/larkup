/**
 * Loads `packages/hub-db/.env` explicitly rather than letting `dotenv`
 * resolve `apps/hub/.env` by default — that file holds the real Neon
 * production connection string (never read its value; TASK 03 rule), and
 * this suite must only ever run against the local Postgres from
 * `docker/hub-db.yml`.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hubDbEnvPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/hub-db/.env',
);
loadEnv({ path: hubDbEnvPath });
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error(
    `Refusing to run Hub tests against a non-local DATABASE_URL. Expected packages/hub-db/.env ` +
      `(local Postgres from docker/hub-db.yml); got: ${hubDbEnvPath}`,
  );
}

import { getHubDb } from '@larkup/hub-db';
import {
  auditEvents,
  extensionVersions,
  extensionWorkspaceGrants,
  extensions,
  publishers,
  workspaceInstallations,
} from '@larkup/hub-db/schema';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import app from './index.js';

/**
 * Contract tests for the byte-compatible `/v1/*` surface — the CLI and both
 * SDKs call these routes directly, so the request/response shapes matter as
 * much as the status codes. Runs against the real local Postgres
 * (`docker/hub-db.yml`), same as `packages/hub-db`'s own tests.
 */

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

afterAll(async () => {
  const db = getHubDb();
  await db.delete(auditEvents).where(inArray(auditEvents.extensionId, [toolId]));
  await db
    .delete(workspaceInstallations)
    .where(inArray(workspaceInstallations.extensionId, [toolId]));
  await db
    .delete(extensionWorkspaceGrants)
    .where(inArray(extensionWorkspaceGrants.extensionId, [toolId]));
  await db.delete(extensionVersions).where(inArray(extensionVersions.extensionId, [toolId]));
  await db.delete(extensions).where(inArray(extensions.id, [toolId]));
  const publisherId = `contract-test-author-${RUN}`;
  await db.delete(publishers).where(inArray(publishers.id, [publisherId]));
});

describe('GET /', () => {
  it('reports service identity', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe('larkup-hub');
  });
});

describe('POST /v1/tools/publish', () => {
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

      const db = getHubDb();
      await db
        .delete(extensionVersions)
        .where(inArray(extensionVersions.extensionId, [`${toolId}-keyed`]));
      await db.delete(extensions).where(inArray(extensions.id, [`${toolId}-keyed`]));
    } finally {
      delete process.env.HUB_PUBLISH_KEY;
    }
  });
});

describe('GET /v1/tools/:id', () => {
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

describe('POST /v1/tools/:id/installed', () => {
  it('accepts no body (pre-migration installer shape) and still counts', async () => {
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

describe('GET /v1/tools/:id/install.sh', () => {
  it('returns a shell script naming the package', async () => {
    const res = await app.request(`/v1/tools/${toolId}/install.sh`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const script = await res.text();
    expect(script).toContain('@acme/contract-test-tool');
  });
});

describe('GET /v1/schema/tool-manifest.v1', () => {
  it('serves the manifest JSON Schema', async () => {
    const res = await app.request('/v1/schema/tool-manifest.v1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Larkup Tool Manifest');
  });
});
