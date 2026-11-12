import type { SyncState } from '@arena/shared';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Kept in step by hand with migrations/20261009220000_players_and_matches.sql.
export const players = pgTable('players', {
  puuid: text('puuid').primaryKey(),
  region: text('region').notNull(),
  gameName: text('game_name'),
  tagLine: text('tag_line'),
  riotIdSeenAt: timestamp('riot_id_seen_at', { withTimezone: true, mode: 'date' }),
  syncState: text('sync_state').$type<SyncState>().notNull().default('unknown'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
});
