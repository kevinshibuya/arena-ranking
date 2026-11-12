import type { FormatId } from './formats';
import type { ProfileScope } from './profile';

/** A player as the ladder names them: the Riot ID last seen, null if never seen. */
export interface LadderPlayer {
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
}

/** When the ratings were last computed and when they will be next. */
export interface ReplayTimes {
  /** ISO timestamp of the latest complete replay run; null before the first. */
  lastReplayAt: string | null;
  /** ISO timestamp of the next scheduled replay; null when none is scheduled. */
  nextReplayAt: string | null;
}

export interface LadderEntry {
  /** 1 is the top; by position, so equal ratings still get distinct ranks. */
  rank: number;
  player: LadderPlayer;
  /** The ordinal: mu minus three sigma. */
  rating: number;
  games: number;
  /** Share of games placed first, 0 to 1. */
  winRate: number;
  /** Share of games placed 1st to 4th, 0 to 1. */
  top4Rate: number;
  averagePlacement: number;
}

/** `GET /api/ladders/:region?format=&season=&limit=&cursor=` */
export interface LadderResponse extends ReplayTimes {
  region: string;
  format: FormatId;
  scope: ProfileScope;
  /** Games in this format and scope before a player is listed. */
  minGames: number;
  /** Highest rating first. */
  entries: LadderEntry[];
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}
