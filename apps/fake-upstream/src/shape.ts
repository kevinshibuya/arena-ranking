import type { MatchLike } from './fixtures';

// A match's lobby shape, teams by team size, for the manifest. The format
// detector in the backend is the authority; this is the same rule, kept small.
export function lobbyShape(match: MatchLike): string {
  const sizes = new Map<number, number>();
  for (const participant of match.info.participants) {
    sizes.set(participant.playerSubteamId, (sizes.get(participant.playerSubteamId) ?? 0) + 1);
  }
  const distinct = new Set(sizes.values());
  if (distinct.size !== 1) return 'irregular';
  return `${sizes.size}x${[...distinct][0]}`;
}

export interface SeasonLike {
  name: string;
  /** Game-version form, e.g. `16.9`. */
  firstPatch: string;
  /** ISO 8601, as in SEASON_SEED. */
  startsAt: string;
}

export function seasonStart(season: SeasonLike): number {
  return Date.parse(season.startsAt);
}

/** Oldest first. */
export function sortSeasons(seasons: readonly SeasonLike[]): SeasonLike[] {
  return [...seasons].sort((a, b) => seasonStart(a) - seasonStart(b));
}

function patchNumber(major: number, minor: number): number {
  return major * 100 + minor;
}

export function parsePatch(patch: string): { major: number; minor: number } {
  const [major, minor] = patch.split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) throw new Error(`not a patch: ${patch}`);
  return { major: major!, minor: minor! };
}

/** The season a game version belongs to, by its major and minor; null before the first season. */
export function seasonOfVersion(version: string, seasons: readonly SeasonLike[]): SeasonLike | null {
  const { major, minor } = parsePatch(version);
  const sorted = sortSeasons(seasons);
  let found: SeasonLike | null = null;
  for (const season of sorted) {
    const first = parsePatch(season.firstPatch);
    if (patchNumber(first.major, first.minor) <= patchNumber(major, minor)) found = season;
  }
  return found;
}
