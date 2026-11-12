/** A player's rating right after one rated match. */
export interface RatingHistoryPoint {
  matchId: string;
  /** ISO timestamp of the match's end. */
  endedAt: string;
  /** The ordinal after the match. */
  rating: number;
}
