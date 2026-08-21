import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Marketplace publisher identities. */
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
