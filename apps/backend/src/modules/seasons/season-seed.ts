/**
 * The 2026 seasons as first seeded, shared by the seasons migration and the
 * fixtures derived for a season boundary. The migration holds the same rows as
 * literal SQL; the seasons e2e test fails if the two drift. Later seasons are
 * inserts into the table, not entries here.
 *
 * First patches are in game-version form, as match-v5 reports `gameVersion`:
 * the major is the year minus 10, so Riot's patch 26.09 is `16.9`.
 */
export const SEASON_SEED = [
  { name: '2026 Season 1', firstPatch: '16.1', startsAt: '2026-01-08T00:00:00Z' },
  { name: '2026 Season 2', firstPatch: '16.9', startsAt: '2026-04-29T00:00:00Z' },
  { name: '2026 Season 3', firstPatch: '16.17', startsAt: '2026-08-26T00:00:00Z' },
] as const;
