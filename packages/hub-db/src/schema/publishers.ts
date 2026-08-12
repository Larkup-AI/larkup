import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A publisher is an attribution + verification identity attached to
 * extensions, not a user account. The Hub has no login system yet — the
 * MVP publish flow authenticates with the single `HUB_PUBLISH_KEY` env var,
 * same as before this migration. This table exists so the catalog can show
 * "by Larkup" / a verified badge and so a future real auth system has
 * somewhere to attach without a schema migration on that day.
 */
export const publishers = pgTable('publishers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contactEmail: text('contact_email'),
  verification: text('verification', { enum: ['unverified', 'verified'] })
    .notNull()
    .default('unverified'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
