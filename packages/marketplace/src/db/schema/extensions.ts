import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { publishers } from './publishers.js';

/** Supported Marketplace extension kinds. */
export const EXTENSION_KINDS = ['tool', 'skill', 'channel', 'knowledge-integration'] as const;

/** Remote Marketplace distribution modes. */
export const DISTRIBUTIONS = ['public', 'private'] as const;

/** Marketplace catalog entries. */
export const extensions = pgTable('extensions', {
  /** Stable manifest id. */
  id: text('id').primaryKey(),
  publisherId: text('publisher_id')
    .notNull()
    .references(() => publishers.id),
  kind: text('kind', { enum: EXTENSION_KINDS }).notNull().default('tool'),
  name: text('name').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  packageName: text('package_name').notNull(),
  /** Tools run in a sandbox unless explicitly opted out. */
  requiresSandbox: boolean('requires_sandbox').notNull().default(true),
  distribution: text('distribution', { enum: DISTRIBUTIONS }).notNull().default('public'),
  repositoryUrl: text('repository_url'),
  license: text('license'),
  deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Private extension access grants. */
export const extensionWorkspaceGrants = pgTable('extension_workspace_grants', {
  id: text('id').primaryKey(),
  extensionId: text('extension_id')
    .notNull()
    .references(() => extensions.id),
  workspaceId: text('workspace_id').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Scope a private-tool access key is bound to. */
export const ACCESS_KEY_SCOPES = ['workspace', 'organization', 'user'] as const;

/**
 * Issued entitlement keys for private extensions. A key is never installed
 * against directly — redeeming it (see `redeemAccessKey`) creates/refreshes a
 * row in `extensionWorkspaceGrants`, which is what visibility and install
 * checks actually read. The key itself only controls whether a new grant may
 * be minted: it can expire, be revoked, and cap how many times it redeems.
 */
export const extensionAccessKeys = pgTable(
  'extension_access_keys',
  {
    id: text('id').primaryKey(),
    extensionId: text('extension_id')
      .notNull()
      .references(() => extensions.id),
    keyHash: text('key_hash').notNull().unique(),
    /** First chars of the plaintext key, for admin display/audit only. */
    keyPrefix: text('key_prefix').notNull(),
    scope: text('scope', { enum: ACCESS_KEY_SCOPES }).notNull(),
    /** Organization/user id this key is bound to. Null = redeemable by any workspace that presents it. */
    scopeId: text('scope_id'),
    maxInstalls: integer('max_installs'),
    installCount: integer('install_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('extension_access_keys_extension_id_idx').on(table.extensionId)],
);
