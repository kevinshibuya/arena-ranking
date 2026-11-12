import { index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// Kept in step by hand with migrations/20261010020000_static_data.sql.
export const champions = pgTable(
  'champions',
  {
    patch: text('patch').notNull(),
    championId: integer('champion_id').notNull(),
    name: text('name').notNull(),
    image: text('image').notNull(),
  },
  (table) => [primaryKey({ columns: [table.patch, table.championId] }), index('champions_champion_id').on(table.championId)],
);

export const augments = pgTable('augments', {
  id: integer('id').primaryKey(),
  apiName: text('api_name').notNull(),
  name: text('name').notNull(),
  rarity: integer('rarity').notNull(),
  iconSmall: text('icon_small').notNull(),
  iconLarge: text('icon_large').notNull(),
});

export const staticDataRefreshes = pgTable('static_data_refreshes', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  patch: text('patch').notNull(),
  champions: integer('champions').notNull(),
  augments: integer('augments').notNull(),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
