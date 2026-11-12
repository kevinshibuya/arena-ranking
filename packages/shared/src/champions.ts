import type { FormatId } from './formats';
import type { ProfileScope } from './profile';

/** A champion as the site shows it, from the cached Data Dragon patches. */
export interface ChampionRef {
  /** match-v5's championId. */
  id: number;
  /** Null while no cached patch has the champion. */
  name: string | null;
  /** A Data Dragon image URL; null while no cached patch has the champion. */
  iconUrl: string | null;
}

export interface ChampionStats {
  champion: ChampionRef;
  games: number;
  /** Games placed first. */
  wins: number;
  /** Share of games placed 1st to 4th, 0 to 1. */
  top4Rate: number;
  averagePlacement: number;
}

/** `GET /api/profiles/:region/:gameName/:tagLine/champions?format=&season=`, most played first. */
export interface ChampionsResponse {
  format: FormatId;
  scope: ProfileScope;
  champions: ChampionStats[];
}
