/** A row of the seasons table. */
export interface Season {
  id: number;
  name: string;
  /** Major and minor of the season's first patch in game-version form, e.g. `16.9`. */
  firstPatch: string;
  startsAt: Date;
}

/** Major and minor of a patch or game version (`16.9`, `16.9.772.8292`) as numbers. */
function patchOf(version: string): [major: number, minor: number] | null {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function comparePatches(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

/**
 * The season a match belongs to, from the major and minor of its game version: the
 * season with the latest first patch not after it. A patch before every season,
 * or a version that does not parse, has no season.
 */
export function seasonForGameVersion(gameVersion: string, seasons: readonly Season[]): Season | null {
  const patch = patchOf(gameVersion);
  if (!patch) return null;
  let found: { season: Season; firstPatch: [number, number] } | null = null;
  for (const season of seasons) {
    const firstPatch = patchOf(season.firstPatch);
    if (!firstPatch || comparePatches(firstPatch, patch) > 0) continue;
    if (!found || comparePatches(firstPatch, found.firstPatch) > 0) found = { season, firstPatch };
  }
  return found?.season ?? null;
}

/** The latest season already started at `now`, or none before the first. */
export function currentSeason(seasons: readonly Season[], now: Date): Season | null {
  let found: Season | null = null;
  for (const season of seasons) {
    if (season.startsAt.getTime() > now.getTime()) continue;
    if (!found || season.startsAt.getTime() > found.startsAt.getTime()) found = season;
  }
  return found;
}
