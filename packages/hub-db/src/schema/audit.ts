import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const AUDIT_ACTIONS = [
  'extension.published',
  'extension.installed',
  'extension.grant_added',
  'extension.grant_removed',
  'extension.deprecated',
] as const;

/**
 * Append-only log of catalog-changing actions. Every table in this schema
 * also carries its own `created_at`/`updated_at` for row-level history; this
 * table is the cross-entity trail an operator reads to answer "who published
 * what, when" without reconstructing it from version timestamps.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actor: text('actor').notNull(),
    action: text('action', { enum: AUDIT_ACTIONS }).notNull(),
    extensionId: text('extension_id'),
    workspaceId: text('workspace_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_events_extension_id_idx').on(table.extensionId)],
);
