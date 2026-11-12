import { DEFAULT_FIXTURES_DIR, loadFixtures, matchIdOfPath, readManifest, startFakeUpstream, type FakeUpstream } from '@arena/fake-upstream';
import type { ChampionsResponse, MatchesResponse, MatchSummary, ProfileResponse, TeammatesResponse } from '@arena/shared';
import request from 'supertest';
import { QUEUES } from '../src/core/queues';
import type { MatchDto } from '../src/modules/riot-client/riot.types';
import { scratchDatabase, startApp, type ScratchDatabase, type TestApp } from './harness';

// The champions, teammates and matches endpoints over the committed fixture set,
// after one primary sync of the recorded player and one static data refresh.
// Every expected number is counted from the fixture match JSON.

const manifest = readManifest(DEFAULT_FIXTURES_DIR);
const [primary, teammate] = manifest.players;
const fixtures = loadFixtures(DEFAULT_FIXTURES_DIR);
const fixtureMatches = new Map(
  fixtures.flatMap((fixture) => {
    const id = matchIdOfPath(fixture.path);
    return id && fixture.status === 200 ? [[id, fixture.body as MatchDto] as const] : [];
  }),
);
const latestPatch = (fixtures.find((fixture) => fixture.path === '/api/versions.json')!.body as string[])[0]!;
const championData = fixtures.find((fixture) => fixture.path === `/cdn/${latestPatch}/data/en_US/champion.json`)!.body as {
  data: Record<string, { key: string; name: string; image: { full: string } }>;
};
const championsByKey = new Map(Object.values(championData.data).map((champion) => [Number(champion.key), champion]));

function iconUrl(patch: string, championId: number): string {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/champion/${championsByKey.get(championId)!.image.full}`;
}

type FixtureParticipant = MatchDto['info']['participants'][number];

function me(matchId: string, puuid: string): FixtureParticipant {
  return fixtureMatches.get(matchId)!.info.participants.find((p) => p.puuid === puuid)!;
}

function subteamOf(matchId: string, puuid: string): FixtureParticipant[] {
  const mine = me(matchId, puuid);
  return fixtureMatches
    .get(matchId)!
    .info.participants.filter((p) => p.puuid !== puuid && p.playerSubteamId === mine.playerSubteamId);
}

// Player0001's current-season 6x3 games: the recorded ones (the derived 8x2 and
// irregular lobbies are other formats).
const games = primary!.currentSeasonMatchIds;

jest.setTimeout(60_000);

describe('breakdown endpoints', () => {
  let fake: FakeUpstream;
  let db: ScratchDatabase;
  let app: TestApp;
  let base: string;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    db = await scratchDatabase();
    app = await startApp({
      worker: true,
      env: {
        DATABASE_URL: db.url,
        RIOT_API_BASE_AMERICAS: fake.url,
        RIOT_API_BASE_BR1: fake.url,
        DDRAGON_BASE: fake.url,
        CDRAGON_BASE: fake.url,
        RIOT_API_KEY: 'RGAPI-test',
        RIOT_RATE_PER_SECOND: '1000',
        RIOT_RATE_PER_TWO_MINUTES: '100000',
      },
    });
    await app.queue(QUEUES.maintenance).add('static-data-refresh', {});
    await request(app.http).get('/api/profiles/br/Player0001/ANON').expect(200);
    await app.drain(60_000);
    base = '/api/profiles/br/Player0001/ANON';
  });

  afterAll(async () => {
    await app.close();
    await db.drop();
    await fake.close();
  });

  async function get<T>(path: string): Promise<T> {
    return (await request(app.http).get(path).expect(200)).body as T;
  }

  async function profileGames(query: string): Promise<number> {
    return (await get<ProfileResponse>(`/api/profiles/br/Player0001/ANON${query}`)).totals.games;
  }

  describe('champions', () => {
    it('sum to the profile’s game count in every format and scope', async () => {
      for (const query of ['', '?season=all', '?format=8x2', '?format=8x2&season=all', '?format=irregular']) {
        const body = await get<ChampionsResponse>(`${base}/champions${query}`);
        const total = body.champions.reduce((sum, row) => sum + row.games, 0);
        expect({ query, total }).toEqual({ query, total: await profileGames(query) });
      }
    });

    it('carry games, wins, top-4 rate and average placement per champion, most played first, named from Data Dragon', async () => {
      const byChampion = new Map<number, number[]>();
      for (const id of games) {
        const { championId, placement } = me(id, primary!.puuid);
        byChampion.set(championId, [...(byChampion.get(championId) ?? []), placement]);
      }
      const expected = [...byChampion].map(([id, placements]) => ({
        champion: { id, name: championsByKey.get(id)!.name, iconUrl: iconUrl(latestPatch, id) },
        games: placements.length,
        wins: placements.filter((p) => p === 1).length,
        top4Rate: placements.filter((p) => p <= 4).length / placements.length,
        averagePlacement: placements.reduce((a, b) => a + b, 0) / placements.length,
      }));

      const body = await get<ChampionsResponse>(`${base}/champions`);

      expect(body).toMatchObject({ format: '6x3', scope: { kind: 'season', name: '2026 Season 3' } });
      const gamesInOrder = body.champions.map((row) => row.games);
      expect(gamesInOrder).toEqual([...gamesInOrder].sort((a, b) => b - a));
      const byId = (a: { champion: { id: number } }, b: { champion: { id: number } }) => a.champion.id - b.champion.id;
      expect([...body.champions].sort(byId)).toEqual(
        expected.sort(byId).map((row) => ({ ...row, top4Rate: expect.closeTo(row.top4Rate, 9), averagePlacement: expect.closeTo(row.averagePlacement, 9) })),
      );
    });
  });

  describe('teammates', () => {
    it('list the other members of the player’s subteam only, with games, wins and top-4 rate together', async () => {
      const together = new Map<string, { gameName: string; tagLine: string; placements: number[] }>();
      for (const id of games) {
        const placement = me(id, primary!.puuid).placement;
        for (const mate of subteamOf(id, primary!.puuid)) {
          const entry = together.get(mate.puuid) ?? { gameName: mate.riotIdGameName, tagLine: mate.riotIdTagline, placements: [] };
          entry.placements.push(placement);
          together.set(mate.puuid, entry);
        }
      }

      const body = await get<TeammatesResponse>(`${base}/teammates`);

      expect(body.teammates.map((row) => row.puuid)).not.toContain(primary!.puuid);
      const gamesInOrder = body.teammates.map((row) => row.games);
      expect(gamesInOrder).toEqual([...gamesInOrder].sort((a, b) => b - a));
      expect(new Map(body.teammates.map((row) => [row.puuid, row]))).toEqual(
        new Map(
          [...together].map(([puuid, entry]) => [
            puuid,
            {
              puuid,
              gameName: expect.any(String),
              tagLine: expect.any(String),
              games: entry.placements.length,
              wins: entry.placements.filter((p) => p === 1).length,
              top4Rate: expect.closeTo(entry.placements.filter((p) => p <= 4).length / entry.placements.length, 9),
            },
          ]),
        ),
      );
    });

    it('count the recorded teammate’s shared games, under their Riot ID', async () => {
      const shared = games.filter((id) => subteamOf(id, primary!.puuid).some((mate) => mate.puuid === teammate!.puuid));

      const body = await get<TeammatesResponse>(`${base}/teammates`);

      expect(shared.length).toBeGreaterThan(0);
      expect(body.teammates[0]).toMatchObject({
        puuid: teammate!.puuid,
        gameName: teammate!.gameName,
        tagLine: teammate!.tagLine,
        games: shared.length,
      });
    });
  });

  describe('matches', () => {
    async function allPages(query: string): Promise<MatchSummary[]> {
      const rows: MatchSummary[] = [];
      let cursor: string | null = null;
      do {
        const page: MatchesResponse = await get<MatchesResponse>(
          `${base}/matches?limit=7${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        expect(page.matches.length).toBeLessThanOrEqual(7);
        rows.push(...page.matches);
        cursor = page.nextCursor;
      } while (cursor);
      return rows;
    }

    it('page by cursor through every game, newest first, each once', async () => {
      const expected = [...games].sort(
        (a, b) => fixtureMatches.get(b)!.info.gameStartTimestamp - fixtureMatches.get(a)!.info.gameStartTimestamp,
      );

      const rows = await allPages('');

      expect(rows.map((row) => row.matchId)).toEqual(expected);
    });

    it('carry placement, champion, subteam mates, duration and date per game, a game on an older patch included', async () => {
      const rows = await allPages('&season=all');
      const olderPatch = rows.filter((row) => !fixtureMatches.get(row.matchId)!.info.gameVersion.startsWith('16.20.'));
      expect(olderPatch.length).toBeGreaterThan(0);

      for (const row of rows) {
        const match = fixtureMatches.get(row.matchId)!;
        const mine = me(row.matchId, primary!.puuid);
        expect(row).toEqual({
          matchId: row.matchId,
          placement: mine.placement,
          champion: { id: mine.championId, name: championsByKey.get(mine.championId)!.name, iconUrl: iconUrl(latestPatch, mine.championId) },
          teammates: expect.any(Array),
          durationSeconds: match.info.gameDuration,
          startedAt: new Date(match.info.gameStartTimestamp).toISOString(),
        });
        expect(new Set(row.teammates.map((mate) => mate.puuid))).toEqual(
          new Set(subteamOf(row.matchId, primary!.puuid).map((mate) => mate.puuid)),
        );
        for (const mate of row.teammates) {
          expect(mate.champion.name).toBe(championsByKey.get(mate.champion.id)!.name);
        }
      }
    });

    it('answers 400 for a cursor it did not issue', async () => {
      await request(app.http).get(`${base}/matches?cursor=nonsense`).expect(400);
    });
  });

  it('answers 404 for a Riot ID not tracked in the region, without asking Riot', async () => {
    const before = (await fake.requests()).length;
    await request(app.http).get('/api/profiles/br/Ninguem/0000/champions').expect(404);
    await request(app.http).get('/api/profiles/xx/Player0001/ANON/matches').expect(404);
    expect(await fake.requests()).toHaveLength(before);
  });

  it('finds the player by Riot ID case-insensitively', async () => {
    const body = await get<TeammatesResponse>('/api/profiles/br/player0001/anon/teammates');
    expect(body.teammates[0]).toMatchObject({ puuid: teammate!.puuid });
  });

  it('resolves a champion the newest cached patch lacks against the most recent patch that has it', async () => {
    const top = (await get<ChampionsResponse>(`${base}/champions`)).champions[0]!.champion;
    const next = '99.1.1';
    const without = Object.fromEntries(Object.entries(championData.data).filter(([, c]) => Number(c.key) !== top.id));
    await fake.respondNext({ path: '/api/versions.json', response: { status: 200, body: [next, latestPatch] } });
    await fake.respondNext({
      path: `/cdn/${next}/data/en_US/champion.json`,
      response: { status: 200, body: { ...championData, version: next, data: without } },
    });
    await app.queue(QUEUES.maintenance).add('static-data-refresh', {});
    await app.drain();

    const rows = (await get<ChampionsResponse>(`${base}/champions`)).champions;

    for (const { champion } of rows) {
      expect(champion.iconUrl).toBe(iconUrl(champion.id === top.id ? latestPatch : next, champion.id));
    }
  });
});
