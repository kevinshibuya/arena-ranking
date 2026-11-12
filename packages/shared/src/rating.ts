import type { FormatId } from './formats';
import type { ReplayTimes } from './ladder';
import type { ProfilePlayer, ProfileScope } from './profile';
import type { RatingHistoryPoint } from './rating-history';

/** `GET /api/profiles/:region/:gameName/:tagLine/rating?format=&season=` */
export interface RatingResponse extends ReplayTimes {
  player: ProfilePlayer;
  format: FormatId;
  scope: ProfileScope;
  /** The ordinal from the latest complete replay; null with no rated game. */
  rating: number | null;
  /** Rated games in this format and scope. */
  games: number;
  /** Whether the player has the games to be listed on the ladder. */
  ranked: boolean;
  /** Games still needed to be listed; 0 when ranked. */
  gamesRemaining: number;
  /** One point per rated match, oldest first. */
  history: RatingHistoryPoint[];
}
