/**
 * Repository functions for the Hub catalog.
 *
 * `apps/hub` owns no SQL — every query the API needs lives here as a typed
 * function, so a contributor reviews a schema *and* its access patterns in
 * one package, and the route handlers stay a thin HTTP translation layer.
 */

import { and, count, eq, ilike, or, sql } from 'drizzle-orm';
import type { HubDb } from './client';
import { auditEvents } from './schema/audit';
import { extensionWorkspaceGrants, extensions } from './schema/extensions';
import { extensionVersions } from './schema/versions';
import { publishers } from './schema/publishers';
import { workspaceInstallations } from './schema/installations';
import { validateToolManifest } from './validate';

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class ManifestInvalidError extends Error {
  constructor(readonly errors: string[]) {
    super(`Invalid manifest: ${errors.join('; ')}`);
    this.name = 'ManifestInvalidError';
  }
}

/** A different publisher already owns this extension id — like npm's ownership check. */
export class NotOwnerError extends Error {
  constructor(extensionId: string) {
    super(`"${extensionId}" is published by a different publisher.`);
    this.name = 'NotOwnerError';
  }
}

/** Extension versions are immutable once published — republishing the same version is rejected. */
export class VersionExistsError extends Error {
  constructor(extensionId: string, version: string) {
    super(`"${extensionId}@${version}" is already published. Publish a new version instead.`);
    this.name = 'VersionExistsError';
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                                */
/* ------------------------------------------------------------------ */

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
  distribution: string;
  repositoryUrl: string | null;
  license: string | null;
  version: string;
  manifest: unknown;
  installs: number;
  updatedAt: Date;
}

/**
 * Row-level workspace authorization (plan §7.4), enforced here rather than
 * with Postgres RLS: the database is never reachable except through this
 * package's own trusted queries (plan §7.1 — "the database never exposed
 * outside the Hub's HTTP API"), so there is no untrusted principal issuing
 * raw SQL for RLS to defend against. A public extension is visible to
 * everyone; a private one only to a workspace holding a grant.
 */
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

async function latestVersionSubquery(db: HubDb, extensionId: string) {
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
  db: HubDb,
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
  db: HubDb,
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
    distribution: ext.distribution,
    repositoryUrl: ext.repositoryUrl,
    license: ext.license,
    version: latest?.version ?? '0.0.0',
    manifest: latest?.manifest ?? {},
    installs,
    updatedAt: ext.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

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

/**
 * Publish or update an extension's catalog entry and append a new version.
 *
 * Ownership is enforced like a package registry: the first publish claims
 * the id for its publisher; a later publish under a different publisher id
 * is rejected rather than silently taking over someone else's listing.
 * Versions are immutable — republishing an already-published version number
 * is rejected instead of overwriting it.
 */
export async function publishExtension(
  db: HubDb,
  input: PublishInput,
): Promise<{ extensionId: string; version: string }> {
  const validation = validateToolManifest(input.manifest);
  if (!validation.valid) throw new ManifestInvalidError(validation.errors);

  const m = input.manifest as {
    id: string;
    name: string;
    description: string;
    category: string;
    packageName: string;
    version: string;
    repositoryUrl?: string;
    license?: string;
    kind?: string;
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
      repositoryUrl: m.repositoryUrl ?? null,
      license: m.license ?? null,
    });
  }

  const integrity = await sha256Hex(JSON.stringify(input.manifest));
  await db.insert(extensionVersions).values({
    id: crypto.randomUUID(),
    extensionId: m.id,
    version: m.version,
    manifest: input.manifest,
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

/* ------------------------------------------------------------------ */
/* Installs                                                             */
/* ------------------------------------------------------------------ */

export async function recordInstall(
  db: HubDb,
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

/* ------------------------------------------------------------------ */
/* Private-distribution grants                                         */
/* ------------------------------------------------------------------ */

export async function grantWorkspaceAccess(
  db: HubDb,
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
