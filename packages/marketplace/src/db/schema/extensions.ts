import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
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
