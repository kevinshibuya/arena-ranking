import type { FormatId } from '@arena/shared';
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { seasons } from './seasons';

// Kept in step by hand with migrations/20261009220000_players_and_matches.sql
// and 20261010120000_matches_ended_at_id.sql.
export const matches = pgTable(
  'matches',
  {
    id: text('id').primaryKey(),
    region: text('region').notNull(),
    queueId: integer('queue_id').notNull(),
    gameVersion: text('game_version').notNull(),
    seasonId: integer('season_id').references(() => seasons.id),
    format: text('format').$type<FormatId>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }).notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    raw: jsonb('raw').notNull(),
  },
  (table) => [index('matches_ended_at_id').on(table.endedAt, table.id)],
);

export const participants = pgTable(
  'participants',
  {
      matchId: text('match_id')
        .notNull()
        .references(() => matches.id, { onDelete: 'cascade' }),
      puuid: text('puuid').notNull(),
      subteamId: integer('subteam_id'),
      placement: integer('placement').notNull(),
      championId: integer('champion_id').notNull(),
      kills: integer('kills').notNull(),
      deaths: integer('deaths').notNull(),
      assists: integer('assists').notNull(),
      damage: integer('damage').notNull(),
      gold: integer('gold').notNull(),
      items: integer('items').array().notNull(),
      augmentIds: integer('augment_ids').array().notNull(),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.puuid] })],
);
