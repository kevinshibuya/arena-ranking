import type { FormatId } from './formats';

/**
 * Where a tracked player's history stands. `unknown` is a discovered player,
 * known only from matches and never synced.
 */
export type SyncState =
  | 'unknown'
  | 'primary-syncing'
  | 'primary-synced'
  | 'backfilling'
  | 'complete'
  | 'no-arena-games';

export interface ProfilePlayer {
  puuid: string;
  region: string;
  gameName: string;
  tagLine: string;
}

/** A season, or every match whatever its season. */
export type ProfileScope = { kind: 'season'; seasonId: number; name: string } | { kind: 'all-time' };

export interface PlacementCount {
  /** 1 is first. */
  placement: number;
  games: number;
}

export interface ProfileTotals {
  games: number;
  /** Games placed first. */
  wins: number;
  /** Share of games placed 1st to 4th, 0 to 1; null with no games. */
  top4Rate: number | null;
  /** Null with no games. */
  averagePlacement: number | null;
  /** Every placement from 1 to the format's team count, 0 games where none. */
  placements: PlacementCount[];
}

/** `GET /api/profiles/:region/:gameName/:tagLine?format=&season=` */
export interface ProfileResponse {
  player: ProfilePlayer;
  syncState: SyncState;
  /** Set when the state needs words, such as a player with no Arena games. */
  message?: string;
  format: FormatId;
  scope: ProfileScope;
  totals: ProfileTotals;
}
