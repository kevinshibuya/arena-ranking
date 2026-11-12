// What the static data refresh reads from Data Dragon and Community Dragon: the
// request paths under DDRAGON_BASE and CDRAGON_BASE, and the fields it uses of
// each answer. The fixture recorder records the same paths.

export const DDRAGON_VERSIONS_PATH = '/api/versions.json';

/** Champion data for one Data Dragon version, e.g. `16.20.1`. */
export function ddragonChampionsPath(version: string): string {
  return `/cdn/${version}/data/en_US/champion.json`;
}

/** The Arena augment list of the newest game build. */
export const CDRAGON_ARENA_PATH = '/latest/cdragon/arena/en_us.json';

/**
 * Where browsers load champion icons from. Always the public Data Dragon, not
 * DDRAGON_BASE: that one is where the refresh fetches data, and in tests and
 * smoke it is the fake upstream, which serves no images.
 */
export const DDRAGON_PUBLIC_BASE = 'https://ddragon.leagueoflegends.com';

export function championIconUrl(version: string, image: string): string {
  return `${DDRAGON_PUBLIC_BASE}/cdn/${version}/img/champion/${image}`;
}

/** `GET /api/versions.json`: every version, newest first, with a few legacy names at the end. */
export type DdragonVersions = string[];

/** `GET /cdn/<version>/data/en_US/champion.json`, the fields read. */
export interface DdragonChampions {
  version: string;
  data: Record<string, { key: string; name: string; image: { full: string } }>;
}

/** `GET /latest/cdragon/arena/en_us.json`, the fields read. */
export interface CdragonArena {
  augments: Array<{
    id: number;
    apiName: string;
    name: string;
    rarity: number;
    iconSmall: string;
    iconLarge: string;
  }>;
}
