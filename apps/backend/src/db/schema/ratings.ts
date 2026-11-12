import type { FormatId } from '@arena/shared';
import { doublePrecision, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// Kept in step by hand with migrations/20261009230000_ratings.sql.
export const replayRuns = pgTable('replay_runs', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
});

export const ratings = pgTable(
  'ratings',
  {
    runId: integer('run_id')
      .notNull()
      .references(() => replayRuns.id, { onDelete: 'cascade' }),
    puuid: text('puuid').notNull(),
    format: text('format').$type<FormatId>().notNull(),
    /** `all`, or a season id as text. */
    scope: text('scope').notNull(),
    mu: doublePrecision('mu').notNull(),
    sigma: doublePrecision('sigma').notNull(),
    ordinal: doublePrecision('ordinal').notNull(),
    games: integer('games').notNull(),
    wins: integer('wins').notNull(),
    top4s: integer('top4s').notNull(),
    placementSum: integer('placement_sum').notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.format, table.scope, table.puuid] })],
);

export const ratingHistory = pgTable(
  'rating_history',
  {
    runId: integer('run_id')
      .notNull()
      .references(() => replayRuns.id, { onDelete: 'cascade' }),
    puuid: text('puuid').notNull(),
    format: text('format').$type<FormatId>().notNull(),
    scope: text('scope').notNull(),
    matchId: text('match_id').notNull(),
    ordinalAfter: doublePrecision('ordinal_after').notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.puuid, table.format, table.scope, table.matchId] })],
);
