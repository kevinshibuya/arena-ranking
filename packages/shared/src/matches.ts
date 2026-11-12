import type { ChampionRef } from './champions';
import type { FormatId } from './formats';
import type { ProfileScope } from './profile';

export interface MatchTeammate {
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  champion: ChampionRef;
}

/** One game of the player's. */
export interface MatchSummary {
  /** Riot's match id, e.g. `BR1_1000000129`. */
  matchId: string;
  /** The player's subteam's placement; 1 is first. */
  placement: number;
  champion: ChampionRef;
  /** The rest of the player's subteam. */
  teammates: MatchTeammate[];
  durationSeconds: number;
  /** ISO timestamp of the game's start. */
  startedAt: string;
}

/**
 * `GET /api/profiles/:region/:gameName/:tagLine/matches?format=&season=&cursor=&limit=`,
 * newest first. `limit` is 1 to 100, 20 by default.
 */
export interface MatchesResponse {
  format: FormatId;
  scope: ProfileScope;
  matches: MatchSummary[];
  /** Pass as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}
