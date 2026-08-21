/** Marketplace catalog queries. */

import { and, count, eq, ilike, or, sql } from 'drizzle-orm';
import type { MarketplaceDb } from './client.js';
import { auditEvents } from './schema/audit.js';
import { extensionWorkspaceGrants, extensions } from './schema/extensions.js';
import { extensionVersions } from './schema/versions.js';
import { publishers } from './schema/publishers.js';
import { workspaceInstallations } from './schema/installations.js';
import { validateToolManifest } from './validate.js';

export class ManifestInvalidError extends Error {
  constructor(readonly errors: string[]) {
    super(`Invalid manifest: ${errors.join('; ')}`);
    this.name = 'ManifestInvalidError';
  }
}

/** Thrown when another publisher owns the extension id. */
export class NotOwnerError extends Error {
  constructor(extensionId: string) {
    super(`"${extensionId}" is published by a different publisher.`);
    this.name = 'NotOwnerError';
  }
}

/** Thrown when an extension version already exists. */
export class VersionExistsError extends Error {
  constructor(extensionId: string, version: string) {
    super(`"${extensionId}@${version}" is already published. Publish a new version instead.`);
    this.name = 'VersionExistsError';
  }
}

export interface CatalogEntry {
  id: string;
  publisherId: string;
  publisherName: string;
  publisherVerification: 'unverified' | 'verified';
  kind: string;
  name: string;
  description: string;
  category: string;
  packageName: string;
  requiresSandbox: boolean;
  distribution: string;
  repositoryUrl: string | null;
  license: string | null;
  version: string;
  manifest: unknown;
  installs: number;
  updatedAt: Date;
}

/** Limits private extensions to granted workspaces. */
function visibilityFilter(workspaceId: string | undefined) {
  return workspaceId
    ? or(
        eq(extensions.distribution, 'public'),
        sql`exists (select 1 from ${extensionWorkspaceGrants}
              where ${extensionWorkspaceGrants.extensionId} = ${extensions.id}
                and ${extensionWorkspaceGrants.workspaceId} = ${workspaceId})`,
      )
    : eq(extensions.distribution, 'public');
}

async function latestVersionSubquery(db: MarketplaceDb, extensionId: string) {
  const [latest] = await db
    .select()
    .from(extensionVersions)
    .where(eq(extensionVersions.extensionId, extensionId))
    .orderBy(sql`${extensionVersions.publishedAt} desc`)
    .limit(1);
  return latest;
}

export interface ListExtensionsOptions {
  category?: string;
  search?: string;
  workspaceId?: string;
  limit?: number;
  offset?: number;
}

export async function listExtensions(
  db: MarketplaceDb,
  options: ListExtensionsOptions = {},
): Promise<{ entries: CatalogEntry[]; total: number }> {
  const conditions = [visibilityFilter(options.workspaceId)];
  if (options.category) conditions.push(eq(extensions.category, options.category));
  if (options.search) {
    const q = `%${options.search}%`;
    conditions.push(
      or(
        ilike(extensions.name, q),
        ilike(extensions.description, q),
        ilike(extensions.packageName, q),
      )!,
    );
  }
  const where = and(...conditions);

  const rows = await db
    .select({ ext: extensions, publisher: publishers })
    .from(extensions)
    .innerJoin(publishers, eq(extensions.publisherId, publishers.id))
    .where(where)
    .orderBy(extensions.name)
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);

  const [{ value: total }] = await db.select({ value: count() }).from(extensions).where(where);

  const entries = await Promise.all(
    rows.map(async ({ ext, publisher }) => {
      const latest = await latestVersionSubquery(db, ext.id);
      const [{ value: installs }] = await db
        .select({ value: count() })
        .from(workspaceInstallations)
        .where(eq(workspaceInstallations.extensionId, ext.id));
      return toEntry(ext, publisher, latest, installs);
    }),
  );

  return { entries, total };
}

export async function getExtension(
  db: MarketplaceDb,
  id: string,
  options: { workspaceId?: string } = {},
): Promise<{ entry: CatalogEntry; versions: { version: string; publishedAt: Date }[] } | null> {
  const [row] = await db
    .select({ ext: extensions, publisher: publishers })
    .from(extensions)
    .innerJoin(publishers, eq(extensions.publisherId, publishers.id))
    .where(and(eq(extensions.id, id), visibilityFilter(options.workspaceId)))
    .limit(1);
  if (!row) return null;

  const versionRows = await db
    .select({ version: extensionVersions.version, publishedAt: extensionVersions.publishedAt })
    .from(extensionVersions)
    .where(eq(extensionVersions.extensionId, id))
    .orderBy(sql`${extensionVersions.publishedAt} desc`);

  const latest = await latestVersionSubquery(db, id);
  const [{ value: installs }] = await db
    .select({ value: count() })
    .from(workspaceInstallations)
    .where(eq(workspaceInstallations.extensionId, id));

  return { entry: toEntry(row.ext, row.publisher, latest, installs), versions: versionRows };
}

function toEntry(
  ext: typeof extensions.$inferSelect,
  publisher: typeof publishers.$inferSelect,
  latest: typeof extensionVersions.$inferSelect | undefined,
  installs: number,
): CatalogEntry {
  return {
    id: ext.id,
    publisherId: ext.publisherId,
    publisherName: publisher.name,
    publisherVerification: publisher.verification,
    kind: ext.kind,
    name: ext.name,
    description: ext.description,
    category: ext.category,
    packageName: ext.packageName,
    requiresSandbox: ext.requiresSandbox,
    distribution: ext.distribution,
    repositoryUrl: ext.repositoryUrl,
    license: ext.license,
    version: latest?.version ?? '0.0.0',
    manifest: latest?.manifest ?? {},
    installs,
    updatedAt: ext.updatedAt,
  };
}

export interface PublishInput {
  manifest: Record<string, unknown>;
  publisherId: string;
  publisherName?: string;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Publishes an immutable extension version. */
export async function publishExtension(
  db: MarketplaceDb,
  input: PublishInput,
): Promise<{ extensionId: string; version: string }> {
  const manifest = {
    ...input.manifest,
    requiresSandbox: input.manifest.requiresSandbox !== false,
  };
  const validation = validateToolManifest(manifest);
  if (!validation.valid) throw new ManifestInvalidError(validation.errors);

  const m = manifest as {
    id: string;
    name: string;
    description: string;
    category: string;
    packageName: string;
    version: string;
    repositoryUrl?: string;
    license?: string;
    kind?: string;
    requiresSandbox: boolean;
  };

  await db
    .insert(publishers)
    .values({ id: input.publisherId, name: input.publisherName ?? input.publisherId })
    .onConflictDoNothing();

  const [existing] = await db.select().from(extensions).where(eq(extensions.id, m.id)).limit(1);
  if (existing && existing.publisherId !== input.publisherId) {
    throw new NotOwnerError(m.id);
  }

  const [existingVersion] = await db
    .select({ id: extensionVersions.id })
    .from(extensionVersions)
    .where(and(eq(extensionVersions.extensionId, m.id), eq(extensionVersions.version, m.version)))
    .limit(1);
  if (existingVersion) throw new VersionExistsError(m.id, m.version);

  const now = new Date();
  if (existing) {
    await db
      .update(extensions)
      .set({
        name: m.name,
        description: m.description,
        category: m.category,
        packageName: m.packageName,
        requiresSandbox: m.requiresSandbox,
        repositoryUrl: m.repositoryUrl ?? null,
        license: m.license ?? null,
        updatedAt: now,
      })
      .where(eq(extensions.id, m.id));
  } else {
    await db.insert(extensions).values({
      id: m.id,
      publisherId: input.publisherId,
      kind: (m.kind as 'tool' | 'skill' | 'channel' | 'knowledge-integration') ?? 'tool',
      name: m.name,
      description: m.description,
      category: m.category,
      packageName: m.packageName,
      requiresSandbox: m.requiresSandbox,
      repositoryUrl: m.repositoryUrl ?? null,
      license: m.license ?? null,
    });
  }

  const integrity = await sha256Hex(JSON.stringify(manifest));
  await db.insert(extensionVersions).values({
    id: crypto.randomUUID(),
    extensionId: m.id,
    version: m.version,
    manifest,
    integrity,
    publishedBy: input.publisherId,
  });

  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    actor: input.publisherId,
    action: 'extension.published',
    extensionId: m.id,
    metadata: { version: m.version },
  });

  return { extensionId: m.id, version: m.version };
}

export async function recordInstall(
  db: MarketplaceDb,
  extensionId: string,
  workspaceId: string,
): Promise<{ installs: number } | null> {
  const [ext] = await db
    .select({ id: extensions.id })
    .from(extensions)
    .where(eq(extensions.id, extensionId));
  if (!ext) return null;

  await db
    .insert(workspaceInstallations)
    .values({ id: crypto.randomUUID(), extensionId, workspaceId })
    .onConflictDoUpdate({
      target: [workspaceInstallations.extensionId, workspaceInstallations.workspaceId],
      set: { updatedAt: new Date() },
    });

  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    actor: workspaceId,
    action: 'extension.installed',
    extensionId,
    workspaceId,
  });

  const [{ value: installs }] = await db
    .select({ value: count() })
    .from(workspaceInstallations)
    .where(eq(workspaceInstallations.extensionId, extensionId));

  return { installs };
}

export async function grantWorkspaceAccess(
  db: MarketplaceDb,
  extensionId: string,
  workspaceId: string,
): Promise<void> {
  await db
    .insert(extensionWorkspaceGrants)
    .values({ id: crypto.randomUUID(), extensionId, workspaceId })
    .onConflictDoNothing();
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    actor: 'system',
    action: 'extension.grant_added',
    extensionId,
    workspaceId,
  });
}
