import { index, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { extensions } from './extensions';

/**
 * One published version of an extension. Append-only: publishing again
 * inserts a new row rather than mutating the last one, so `GET
 * /v1/tools/:id`'s version history is real instead of reconstructed.
 *
 * `manifest` stores the full publisher-submitted manifest (today's
 * `ToolDescriptor` shape, or a v2 `ExtensionManifestV2` once publishers
 * migrate — the Hub does not need to know the difference to store it).
 * `integrity` is a server-computed SHA-256 of the canonicalized manifest —
 * basic tamper-evidence for "did this change between two fetches," not a
 * publisher-signed provenance chain. Real provenance (publisher-held signing
 * keys, SBOM verification) needs a publisher-key infrastructure that does
 * not exist yet; deferred, not silently skipped — see ADR-012.
 */
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
