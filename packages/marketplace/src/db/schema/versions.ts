import { index, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { extensions } from './extensions.js';

/** Immutable published extension versions. */
export const extensionVersions = pgTable(
  'extension_versions',
  {
    id: text('id').primaryKey(),
    extensionId: text('extension_id')
      .notNull()
      .references(() => extensions.id),
    version: text('version').notNull(),
    manifest: jsonb('manifest').notNull(),
    integrity: text('integrity').notNull(),
    publishedBy: text('published_by').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('extension_versions_extension_version_unique').on(table.extensionId, table.version),
    index('extension_versions_extension_id_idx').on(table.extensionId),
  ],
);
