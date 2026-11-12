export interface SeasonSummary {
  id: number;
  name: string;
  /** Major and minor of the season's first patch in game-version form, e.g. `16.9`. */
  firstPatch: string;
  /** ISO timestamp. */
  startsAt: string;
  /** The latest season already started. At most one season is current. */
  current: boolean;
}

export interface SeasonsResponse {
  /** Oldest first. */
  seasons: SeasonSummary[];
}
