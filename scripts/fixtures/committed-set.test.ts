import { checkFixtures, DEFAULT_FIXTURES_DIR, fixtureFile, lobbyShape, matchPath, readFixture, readManifest, type MatchLike } from '../../apps/fake-upstream/src';
import { SEASON_SEED } from '../../apps/backend/src/modules/seasons/season-seed';

// The committed fixture set, recorded from Player0001#ANON's history on 2026-10-09.

const manifest = readManifest(DEFAULT_FIXTURES_DIR);
const match = (id: string): MatchLike => readFixture(fixtureFile(DEFAULT_FIXTURES_DIR, 'riot-regional', matchPath(id))).body as MatchLike;

describe('the committed fixture set', () => {
  it('passes fixtures:check', () => {
    expect(checkFixtures(DEFAULT_FIXTURES_DIR, { seasons: SEASON_SEED })).toEqual([]);
  });

  it("holds Player0001's current season under the unpublished queues 1740 and 1750, as 6x3", () => {
    const [primary] = manifest.players;
    const queues = new Set(primary!.currentSeasonMatchIds.map((id) => match(id).info.queueId));

    expect([...queues].sort()).toEqual([1740, 1750]);
    expect(new Set(primary!.currentSeasonMatchIds.map((id) => lobbyShape(match(id))))).toEqual(new Set(['6x3']));
  });

  it('holds the Season 2 8x2 matches under queue 1700', () => {
    const season2Under1700 = manifest.players[0]!.earlierMatchIds.filter((id) => match(id).info.queueId === 1700);

    expect(season2Under1700).toHaveLength(10);
    for (const id of season2Under1700) {
      expect(lobbyShape(match(id))).toBe('8x2');
      expect(match(id).info.gameVersion).toMatch(/^16\.9\./);
    }
  });

  it('lists the formats seen with their queue ids, and the full listed count per player', () => {
    expect(manifest.formats.map(({ format, queueIds }) => ({ format, queueIds }))).toEqual([
      { format: '6x3', queueIds: [1740, 1750] },
      { format: '8x2', queueIds: [1700] },
    ]);
    expect(manifest.players.map((player) => player.currentSeasonListed)).toEqual([
      { total: 304, byQueue: { '1700': 0, '1710': 0, '1740': 68, '1750': 236 } },
      { total: 96, byQueue: { '1700': 0, '1710': 0, '1740': 12, '1750': 84 } },
    ]);
  });
});
