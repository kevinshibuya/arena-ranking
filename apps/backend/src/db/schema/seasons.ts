import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Kept in step by hand with migrations/20261009133000_seasons.sql.
export const seasons = pgTable('seasons', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull().unique(),
  firstPatch: text('first_patch').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
});
