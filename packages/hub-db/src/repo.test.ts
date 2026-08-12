import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getHubDb, type HubDb } from './client';
import {
  getExtension,
  grantWorkspaceAccess,
  listExtensions,
  ManifestInvalidError,
  NotOwnerError,
  publishExtension,
  recordInstall,
  VersionExistsError,
} from './repo';
import { auditEvents } from './schema/audit';
import { extensionWorkspaceGrants, extensions } from './schema/extensions';
import { extensionVersions } from './schema/versions';
import { workspaceInstallations } from './schema/installations';
import { publishers } from './schema/publishers';

/**
 * Integration tests against a real local Postgres — see
 * `docker/hub-db.yml`. Every test uses ids namespaced with a per-run random
 * suffix so a run never collides with the seed data (`seed.ts`) or with a
 * previous run's leftovers, and `afterAll` deletes everything this file
 * created.
 */

const RUN = Math.random().toString(36).slice(2, 8);
const extId = (name: string) => `test-${RUN}-${name}`;
const publisherA = `pub-${RUN}-a`;
const publisherB = `pub-${RUN}-b`;

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: extId('widget'),
    name: 'Test Widget',
    description: 'A widget for tests.',
    category: 'utility',
    version: '1.0.0',
    pricing: 'free',
    icon: 'Box',
    packageName: '@acme/test-widget',
    installSize: '~1 MB',
    author: 'Acme',
    capabilities: ['test'],
    ...overrides,
  };
}

let db: HubDb;
const createdExtensionIds = new Set<string>();
const createdPublisherIds = new Set([publisherA, publisherB]);

beforeAll(() => {
  db = getHubDb();
});

afterAll(async () => {
  const ids = Array.from(createdExtensionIds);
  if (ids.length) {
    await db.delete(auditEvents).where(inArray(auditEvents.extensionId, ids));
    await db.delete(workspaceInstallations).where(inArray(workspaceInstallations.extensionId, ids));
    await db
      .delete(extensionWorkspaceGrants)
      .where(inArray(extensionWorkspaceGrants.extensionId, ids));
    await db.delete(extensionVersions).where(inArray(extensionVersions.extensionId, ids));
    await db.delete(extensions).where(inArray(extensions.id, ids));
  }
  await db.delete(publishers).where(inArray(publishers.id, Array.from(createdPublisherIds)));
});

async function publish(overrides: Record<string, unknown> = {}, publisherId = publisherA) {
  const m = manifest(overrides);
  createdExtensionIds.add(m.id as string);
  return publishExtension(db, { manifest: m, publisherId, publisherName: publisherId });
}

describe('publishExtension', () => {
  it('rejects an invalid manifest before writing anything', async () => {
    const id = extId('invalid');
    await expect(
      publishExtension(db, { manifest: { id }, publisherId: publisherA }),
    ).rejects.toBeInstanceOf(ManifestInvalidError);

    const [row] = await db.select().from(extensions).where(eq(extensions.id, id));
    expect(row).toBeUndefined();
  });

  it('publishes a new extension and its first version', async () => {
    const result = await publish();
    expect(result.version).toBe('1.0.0');

    const found = await getExtension(db, result.extensionId);
    expect(found?.entry.name).toBe('Test Widget');
    expect(found?.entry.version).toBe('1.0.0');
    expect(found?.entry.installs).toBe(0);
  });

  it('records an integrity hash and an audit event', async () => {
    const result = await publish({ id: extId('audited') });
    const [version] = await db
      .select()
      .from(extensionVersions)
      .where(eq(extensionVersions.extensionId, result.extensionId));
    expect(version.integrity).toMatch(/^[a-f0-9]{64}$/);

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.extensionId, result.extensionId));
    expect(events.some((e) => e.action === 'extension.published')).toBe(true);
  });

  it('rejects republishing the same version — versions are immutable', async () => {
    const result = await publish({ id: extId('immutable') });
    await expect(
      publishExtension(db, {
        manifest: manifest({ id: result.extensionId }),
        publisherId: publisherA,
      }),
    ).rejects.toBeInstanceOf(VersionExistsError);
  });

  it('accepts a new version from the same publisher and keeps history', async () => {
    const id = extId('versioned');
    await publish({ id, version: '1.0.0' });
    await publish({ id, version: '1.1.0' });

    const found = await getExtension(db, id);
    expect(found?.entry.version).toBe('1.1.0'); // latest wins for the catalog view
    expect(found?.versions.map((v) => v.version).sort()).toEqual(['1.0.0', '1.1.0']);
  });

  it('rejects a publish for an id owned by a different publisher', async () => {
    const id = extId('owned');
    await publish({ id }, publisherA);
    await expect(
      publishExtension(db, {
        manifest: manifest({ id, version: '2.0.0' }),
        publisherId: publisherB,
      }),
    ).rejects.toBeInstanceOf(NotOwnerError);
  });
});

describe('listExtensions / visibility', () => {
  it('lists a public extension for a caller with no workspace', async () => {
    const result = await publish({ id: extId('public-listed'), name: 'Findable Public Widget' });
    const { entries } = await listExtensions(db, { search: 'Findable Public' });
    expect(entries.some((e) => e.id === result.extensionId)).toBe(true);
  });

  it('hides a private extension from a workspace with no grant, shows it to one that has a grant', async () => {
    const id = extId('private-listed');
    await publish({ id, name: 'Secret Widget' });
    await db.update(extensions).set({ distribution: 'private' }).where(eq(extensions.id, id));

    const anonymous = await getExtension(db, id);
    expect(anonymous).toBeNull();

    const ungranted = await getExtension(db, id, { workspaceId: 'ws-no-grant' });
    expect(ungranted).toBeNull();

    await grantWorkspaceAccess(db, id, 'ws-granted');
    const granted = await getExtension(db, id, { workspaceId: 'ws-granted' });
    expect(granted?.entry.id).toBe(id);
  });

  it('filters by category', async () => {
    await publish({ id: extId('media-item'), category: 'media' });
    const { entries } = await listExtensions(db, { category: 'media' });
    expect(entries.every((e) => e.category === 'media')).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('recordInstall', () => {
  it('returns null for an unknown extension rather than throwing', async () => {
    expect(await recordInstall(db, 'does-not-exist', 'ws-1')).toBeNull();
  });

  it('counts distinct workspaces, not raw install calls', async () => {
    const result = await publish({ id: extId('installable') });
    await recordInstall(db, result.extensionId, 'ws-a');
    await recordInstall(db, result.extensionId, 'ws-a'); // reinstall — same workspace
    const after = await recordInstall(db, result.extensionId, 'ws-b');
    expect(after?.installs).toBe(2);
  });
});
