import type { FormatId } from './formats';
import type { LadderPlayer } from './ladder';
import type { ProfileScope } from './profile';

/** Where a player stands on one ladder. */
export type LadderPosition =
  | { ranked: true; rank: number; rating: number; games: number }
  | { ranked: false; games: number; gamesRemaining: number };

/** `GET /api/ladders/:region/players/:gameName/:tagLine?format=&season=` */
export type LadderPositionResponse = {
  player: LadderPlayer;
  format: FormatId;
  scope: ProfileScope;
  minGames: number;
} & LadderPosition;
