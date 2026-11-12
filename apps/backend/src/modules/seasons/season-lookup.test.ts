import { DEFAULT_FIXTURES_DIR, fixtureFile, matchPath, readFixture, readManifest, type MatchLike } from '@arena/fake-upstream';
import { currentSeason, seasonForGameVersion, type Season } from './season-lookup';
import { SEASON_SEED } from './season-seed';

// Listed out of order on purpose: the lookup may not rely on the caller sorting.
const seasons: Season[] = [
  { id: 12, name: 'Two', firstPatch: '16.9', startsAt: new Date('2026-04-29T00:00:00Z') },
  { id: 11, name: 'One', firstPatch: '16.1', startsAt: new Date('2026-01-08T00:00:00Z') },
  { id: 13, name: 'Three', firstPatch: '16.17', startsAt: new Date('2026-08-26T00:00:00Z') },
];

function nameFor(gameVersion: string): string | undefined {
  return seasonForGameVersion(gameVersion, seasons)?.name;
}

describe('season lookup', () => {
  it("maps a game version on a season's first patch to that season", () => {
    expect(nameFor('16.1.735.4120')).toBe('One');
    expect(nameFor('16.9.741.2209')).toBe('Two');
    expect(nameFor('16.17.750.1004')).toBe('Three');
  });

  it('maps the last patch before the next season to the earlier season', () => {
    expect(nameFor('16.8.740.9981')).toBe('One');
    expect(nameFor('16.16.749.3310')).toBe('Two');
  });

  it('compares minors as numbers, not text', () => {
    expect(nameFor('16.10.742.15')).toBe('Two');
    expect(nameFor('16.2.736.1')).toBe('One');
  });

  it('keeps the latest season for every patch after its start', () => {
    expect(nameFor('16.24.757.1')).toBe('Three');
    expect(nameFor('17.1.760.1')).toBe('Three');
  });

  it('gives no season to a patch before the first season', () => {
    expect(seasonForGameVersion('15.24.733.8000', seasons)).toBeNull();
  });

  it('gives no season to a version it cannot read', () => {
    expect(seasonForGameVersion('', seasons)).toBeNull();
    expect(seasonForGameVersion('latest', seasons)).toBeNull();
  });

  it('gives no season when there are no seasons', () => {
    expect(seasonForGameVersion('16.9.741.2209', [])).toBeNull();
  });
});

describe('the seeded seasons', () => {
  const seeded: Season[] = SEASON_SEED.map((season, index) => ({ id: index + 1, ...season, startsAt: new Date(season.startsAt) }));

  it('are keyed by game version, as match-v5 reports it', () => {
    expect(SEASON_SEED.map((season) => season.firstPatch)).toEqual(['16.1', '16.9', '16.17']);
    // Riot's patch 26.20 is game version 16.20, October 2026.
    expect(seasonForGameVersion('16.20.824.8524', seeded)?.name).toBe('2026 Season 3');
    expect(seasonForGameVersion('16.9.772.8292', seeded)?.name).toBe('2026 Season 2');
  });

  it('put a recorded current-season match in 2026 Season 3 and a recorded Season 2 match in Season 2', () => {
    const versionOf = (id: string): string =>
      (readFixture(fixtureFile(DEFAULT_FIXTURES_DIR, 'riot-regional', matchPath(id))).body as MatchLike).info.gameVersion;
    const [primary] = readManifest(DEFAULT_FIXTURES_DIR).players;

    expect(seasonForGameVersion(versionOf(primary!.currentSeasonMatchIds[0]!), seeded)?.name).toBe('2026 Season 3');
    // An 8x2 game of 2026-05-12, and one of 2026-08-25 on Season 2's last patch.
    expect(seasonForGameVersion(versionOf('BR1_1000000001'), seeded)?.name).toBe('2026 Season 2');
    expect(seasonForGameVersion(versionOf('BR1_1000000030'), seeded)?.name).toBe('2026 Season 2');
  });
});

describe('current season', () => {
  it('is the latest season already started', () => {
    expect(currentSeason(seasons, new Date('2026-06-01T12:00:00Z'))?.name).toBe('Two');
    expect(currentSeason(seasons, new Date('2026-08-26T00:00:00Z'))?.name).toBe('Three');
    expect(currentSeason(seasons, new Date('2026-08-25T23:59:59Z'))?.name).toBe('Two');
  });

  it('is none before the first season starts', () => {
    expect(currentSeason(seasons, new Date('2025-12-31T00:00:00Z'))).toBeNull();
  });
});
