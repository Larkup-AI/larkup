import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMarketplaceDb, type MarketplaceDb } from './client';
import {
  getExtension,
  grantWorkspaceAccess,
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
} from './repo';
import { auditEvents } from './schema/audit';
import { extensionAccessKeys, extensionWorkspaceGrants, extensions } from './schema/extensions';
import { extensionVersions } from './schema/versions';
import { workspaceInstallations } from './schema/installations';
import { publishers } from './schema/publishers';

/** Integration tests use local Postgres. */

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

let db: MarketplaceDb;
const createdExtensionIds = new Set<string>();
const createdPublisherIds = new Set([publisherA, publisherB]);

beforeAll(() => {
  db = getMarketplaceDb();
});

afterAll(async () => {
  const ids = Array.from(createdExtensionIds);
  if (ids.length) {
    await db.delete(auditEvents).where(inArray(auditEvents.extensionId, ids));
    await db.delete(workspaceInstallations).where(inArray(workspaceInstallations.extensionId, ids));
    await db.delete(extensionAccessKeys).where(inArray(extensionAccessKeys.extensionId, ids));
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
    expect(found?.entry.requiresSandbox).toBe(true);
  });

  it('preserves an explicit sandbox opt-out in the catalog', async () => {
    const result = await publish({ id: extId('host-safe'), requiresSandbox: false });
    const found = await getExtension(db, result.extensionId);
    expect(found?.entry.requiresSandbox).toBe(false);
    expect((found?.entry.manifest as { requiresSandbox?: boolean }).requiresSandbox).toBe(false);
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
    expect(found?.entry.version).toBe('1.1.0');
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

  it('hides a private extension from browse/search for a workspace with no grant', async () => {
    const id = extId('private-search');
    await publish({ id, name: 'Unlisted Widget', distribution: 'private' });

    const anonymous = await listExtensions(db, { search: 'Unlisted Widget' });
    expect(anonymous.entries.some((e) => e.id === id)).toBe(false);

    const ungranted = await listExtensions(db, {
      search: 'Unlisted Widget',
      workspaceId: 'ws-ungranted-search',
    });
    expect(ungranted.entries.some((e) => e.id === id)).toBe(false);

    await grantWorkspaceAccess(db, id, 'ws-granted-search');
    const granted = await listExtensions(db, {
      search: 'Unlisted Widget',
      workspaceId: 'ws-granted-search',
    });
    expect(granted.entries.some((e) => e.id === id)).toBe(true);
  });

  it('reveals a private extension by exact id even with no grant, but marks it unauthorized', async () => {
    const id = extId('private-listed');
    await publish({ id, name: 'Secret Widget', distribution: 'private' });

    const anonymous = await getExtension(db, id);
    expect(anonymous?.entry.id).toBe(id);
    expect(anonymous?.authorized).toBe(false);

    const ungranted = await getExtension(db, id, { workspaceId: 'ws-no-grant' });
    expect(ungranted?.authorized).toBe(false);

    await grantWorkspaceAccess(db, id, 'ws-granted');
    const granted = await getExtension(db, id, { workspaceId: 'ws-granted' });
    expect(granted?.entry.id).toBe(id);
    expect(granted?.authorized).toBe(true);
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
    await recordInstall(db, result.extensionId, 'ws-a');
    const after = await recordInstall(db, result.extensionId, 'ws-b');
    expect(after?.installs).toBe(2);
  });

  it('rejects installing a private extension without a grant', async () => {
    const id = extId('private-install');
    await publish({ id, distribution: 'private' });
    await expect(recordInstall(db, id, 'ws-ungranted')).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('allows installing a private extension once granted', async () => {
    const id = extId('private-install-granted');
    await publish({ id, distribution: 'private' });
    await grantWorkspaceAccess(db, id, 'ws-authorized');
    const result = await recordInstall(db, id, 'ws-authorized');
    expect(result?.installs).toBe(1);
  });
});

describe('access keys', () => {
  it('issues a key and redeems it into a usable grant', async () => {
    const id = extId('key-flow');
    await publish({ id, distribution: 'private' });

    const { accessKey } = await issueAccessKey(db, {
      extensionId: id,
      scope: 'organization',
      scopeId: 'org-1',
      createdBy: 'test-admin',
    });

    await expect(recordInstall(db, id, 'ws-redeemer')).rejects.toBeInstanceOf(NotAuthorizedError);

    await redeemAccessKey(db, id, accessKey, 'ws-redeemer');
    const result = await recordInstall(db, id, 'ws-redeemer');
    expect(result?.installs).toBe(1);

    const keys = await listAccessKeys(db, id);
    expect(keys[0].installCount).toBe(1);
  });

  it('rejects an unknown or garbage key', async () => {
    const id = extId('key-garbage');
    await publish({ id, distribution: 'private' });
    await expect(redeemAccessKey(db, id, 'lk_key_not-a-real-key', 'ws-1')).rejects.toBeInstanceOf(
      InvalidAccessKeyError,
    );
  });

  it('rejects an expired key', async () => {
    const id = extId('key-expired');
    await publish({ id, distribution: 'private' });
    const { accessKey } = await issueAccessKey(db, {
      extensionId: id,
      scope: 'workspace',
      expiresAt: new Date(Date.now() - 1000),
      createdBy: 'test-admin',
    });
    await expect(redeemAccessKey(db, id, accessKey, 'ws-1')).rejects.toBeInstanceOf(
      InvalidAccessKeyError,
    );
  });

  it('enforces a maxInstalls cap across redemptions', async () => {
    const id = extId('key-capped');
    await publish({ id, distribution: 'private' });
    const { accessKey } = await issueAccessKey(db, {
      extensionId: id,
      scope: 'workspace',
      maxInstalls: 1,
      createdBy: 'test-admin',
    });
    await redeemAccessKey(db, id, accessKey, 'ws-first');
    await expect(redeemAccessKey(db, id, accessKey, 'ws-second')).rejects.toBeInstanceOf(
      InvalidAccessKeyError,
    );
  });

  it('rejects redemption once a key is revoked', async () => {
    const id = extId('key-revoked');
    await publish({ id, distribution: 'private' });
    const { id: keyId, accessKey } = await issueAccessKey(db, {
      extensionId: id,
      scope: 'workspace',
      createdBy: 'test-admin',
    });
    await revokeAccessKey(db, id, keyId, 'test-admin');
    await expect(redeemAccessKey(db, id, accessKey, 'ws-1')).rejects.toBeInstanceOf(
      InvalidAccessKeyError,
    );
  });
});
