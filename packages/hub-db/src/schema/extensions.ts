import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { publishers } from './publishers';

/**
 * Extension kinds, per plan §4.1 / manifest v2. Not imported from
 * `@larkup/agent-contracts` — the Hub is deployed independently of the rest
 * of the monorepo (see `apps/hub/src/types.ts`), and `packages/hub-db` keeps
 * that true rather than pulling in the whole contracts package for one
 * union type.
 */
export const EXTENSION_KINDS = ['tool', 'skill', 'channel', 'knowledge-integration'] as const;

/**
 * Public and private-workspace are stored here. Bring-your-own-local (§7.3)
 * is deliberately absent as a value: it is a local manifest/path the CLI
 * resolves on the user's own machine and never reaches the Hub's catalog by
 * definition, so there is nothing for this table to represent.
 */
export const DISTRIBUTIONS = ['public', 'private'] as const;

/**
 * The catalog entry for one extension. Versioned data (the manifest itself)
 * lives in `extension_versions` — this row is identity plus the fields the
 * catalog list/search view needs without joining every time.
 */
export const extensions = pgTable('extensions', {
  /** Stable id from the manifest, e.g. "video-audio". Matches pre-migration ids 1:1. */
  id: text('id').primaryKey(),
  publisherId: text('publisher_id')
    .notNull()
    .references(() => publishers.id),
  kind: text('kind', { enum: EXTENSION_KINDS }).notNull().default('tool'),
  name: text('name').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  packageName: text('package_name').notNull(),
  distribution: text('distribution', { enum: DISTRIBUTIONS }).notNull().default('public'),
  repositoryUrl: text('repository_url'),
  license: text('license'),
  deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Which workspaces may install a `distribution: "private"` extension.
 * Irrelevant for public extensions — every workspace may install those.
 */
export const extensionWorkspaceGrants = pgTable('extension_workspace_grants', {
  id: text('id').primaryKey(),
  extensionId: text('extension_id')
    .notNull()
    .references(() => extensions.id),
  workspaceId: text('workspace_id').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
});
