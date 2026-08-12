import { index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { extensions } from './extensions';

/**
 * One workspace's install of one extension. Replaces the pre-migration
 * global `installs` counter with real rows — `installs` was a number that
 * only ever went up, with no way to tell who installed or to uninstall.
 * The public "downloads" count the catalog API returns is `COUNT(*)` grouped
 * by `extensionId`.
 */
export const workspaceInstallations = pgTable(
  'workspace_installations',
  {
    id: text('id').primaryKey(),
    extensionId: text('extension_id')
      .notNull()
      .references(() => extensions.id),
    workspaceId: text('workspace_id').notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('workspace_installations_extension_workspace_unique').on(
      table.extensionId,
      table.workspaceId,
    ),
    index('workspace_installations_extension_id_idx').on(table.extensionId),
  ],
);
