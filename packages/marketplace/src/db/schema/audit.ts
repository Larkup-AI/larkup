import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const AUDIT_ACTIONS = [
  'extension.published',
  'extension.installed',
  'extension.grant_added',
  'extension.grant_removed',
  'extension.deprecated',
  'extension.key_issued',
  'extension.key_redeemed',
  'extension.key_revoked',
] as const;

/** Catalog audit trail. */
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
