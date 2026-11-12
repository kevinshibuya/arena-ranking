import { buildMatch, DEFAULT_FIXTURES_DIR, matchPath, readManifest, startFakeUpstream, type FakeUpstream } from '@arena/fake-upstream';
import type { ProfileResponse, SeasonsResponse } from '@arena/shared';
import { Pool } from 'pg';
import request from 'supertest';
import { QUEUES } from '../src/core/queues';
import { scratchDatabase, startApp, type ScratchDatabase, type TestApp } from './harness';

// How a search's primary sync reaches Riot: one job per request, one listing
// per Arena queue id and page, every participant tracked under its newest name.

const manifest = readManifest(DEFAULT_FIXTURES_DIR);
const [primary] = manifest.players;

/** Inside 2026 Season 3, on a Season 3 patch. */
const SEASON_3_DAY = Date.parse('2026-09-15T12:00:00Z');
const HOUR = 3600_000;

const riotEnv = (fake: FakeUpstream): Record<string, string> => ({
  RIOT_API_BASE_AMERICAS: fake.url,
  RIOT_API_BASE_BR1: fake.url,
  RIOT_API_KEY: 'RGAPI-test',
  // High, so the limiter never holds a sync up; the limiter's own tests set them low.
  RIOT_RATE_PER_SECOND: '1000',
  RIOT_RATE_PER_TWO_MINUTES: '100000',
});

jest.setTimeout(60_000);

function listingsOf(paths: readonly string[], puuid: string): string[] {
  return paths.filter((path) => path.startsWith(`/lol/match/v5/matches/by-puuid/${puuid}/ids?`));
}

describe('primary sync', () => {
  let fake: FakeUpstream;
  let db: ScratchDatabase;
  let app: TestApp;
  let pg: Pool;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    db = await scratchDatabase();
    app = await startApp({ worker: true, env: { DATABASE_URL: db.url, ...riotEnv(fake) } });
    pg = new Pool({ connectionString: db.url });
  });

  afterAll(async () => {
    await pg.end();
    await app.close();
    await db.drop();
    await fake.close();
  });

  /** Registers an account at the fake for the next lookup of its Riot ID; later searches find the tracked player. */
  async function account(puuid: string, gameName: string, times = 1, tagLine = 'BR1'): Promise<void> {
    await fake.respondNext({
      path: `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${tagLine}`,
      times,
      response: { status: 200, body: { puuid, gameName, tagLine } },
    });
  }

  async function searchAndDrain(gameName: string, tagLine: string): Promise<ProfileResponse> {
    await request(app.http).get(`/api/profiles/br/${encodeURIComponent(gameName)}/${tagLine}`).expect(200);
    await app.drain(60_000);
    const response = await request(app.http).get(`/api/profiles/br/${encodeURIComponent(gameName)}/${tagLine}`).expect(200);
    return response.body as ProfileResponse;
  }

  describe('of the recorded player', () => {
    const outsideQueue = buildMatch({
      id: 'BR1_9100000001',
      created: SEASON_3_DAY,
      queue: 1800,
      teams: [[primary!.puuid, 'synthetic-outside-1'], ['synthetic-outside-2', 'synthetic-outside-3']],
    });

    beforeAll(async () => {
      await fake.addMatch(outsideQueue);
      await searchAndDrain('Player0001', 'ANON');
    });

    it('runs one job per Riot request', async () => {
      const seen = await fake.requests();
      // Two account lookups (one per search), four listings, one fetch per match.
      const counts = await app.queue(QUEUES.riot).getJobCounts('completed', 'failed');

      expect(counts.failed).toBe(0);
      expect(counts.completed).toBe(seen.length);
    });

    it('lists the current season once per configured Arena queue id', async () => {
      // The backfill's listings carry an end time; backfill-sweep.e2e covers them.
      const listings = listingsOf((await fake.requests()).map((seen) => seen.path), primary!.puuid).filter(
        (path) => !path.includes('endTime='),
      );
      const start = Date.parse(manifest.currentSeason.startsAt) / 1000;

      // Under 100 matches per id, so one page each.
      expect(listings.sort()).toEqual(
        [1700, 1710, 1740, 1750].map(
          (queue) => `/lol/match/v5/matches/by-puuid/${primary!.puuid}/ids?queue=${queue}&startTime=${start}&start=0&count=100`,
        ),
      );
    });

    it('never fetches a match held under a queue id outside the list', async () => {
      const paths = (await fake.requests()).map((seen) => seen.path);

      expect(paths).not.toContain(matchPath(outsideQueue.metadata.matchId));
    });

    it('tracks every participant of every stored match under a Riot ID', async () => {
      const untracked = await pg.query(`
        select distinct p.puuid from participants p
        left join players pl on pl.puuid = p.puuid
        where pl.puuid is null or pl.game_name is null or pl.tag_line is null`);
      const stored = await pg.query<{ n: number }>('select count(*)::int as n from matches');

      expect(untracked.rows).toEqual([]);
      // Player0001's recorded current-season matches and the three derived ones dated after Season 3 began,
      // then the backfill's: the recorded earlier-season matches and the derived Season 1 one.
      expect(stored.rows[0]?.n).toBe(primary!.currentSeasonMatchIds.length + 3 + primary!.earlierMatchIds.length + 1);
    });
  });

  it('keeps the newest Riot ID a match carries, whatever order the matches arrive in', async () => {
    // Two lobbies with the same players two days apart; a renamed player in each.
    const older = buildMatch({ id: 'BR1_9100000011', created: SEASON_3_DAY, teams: [['x-old'], ['renamed-a'], ['renamed-b']] });
    const newer = buildMatch({ id: 'BR1_9100000012', created: SEASON_3_DAY + 48 * HOUR, teams: [['x-new'], ['renamed-a'], ['renamed-b']] });
    for (const [match, era] of [[older, 'Old'], [newer, 'New']] as const) {
      for (const participant of match.info.participants) participant.riotIdGameName = `${participant.puuid} ${era}`;
      await fake.addMatch(match);
    }

    // renamed-a: newer match first, then older. renamed-b would be the same; flip it with a third lobby.
    await account('x-new', 'x-new New');
    await searchAndDrain('x-new New', 'BR1');
    await account('x-old', 'x-old Old');
    await searchAndDrain('x-old Old', 'BR1');
    const newest = buildMatch({ id: 'BR1_9100000013', created: SEASON_3_DAY + 96 * HOUR, teams: [['x-last'], ['renamed-b']] });
    newest.info.participants[1]!.riotIdGameName = 'renamed-b Newest';
    await fake.addMatch(newest);
    await account('x-last', 'Player x-last');
    await searchAndDrain('Player x-last', 'BR1');

    const names = await pg.query("select puuid, game_name from players where puuid like 'renamed-%' order by puuid");
    expect(names.rows).toEqual([
      { puuid: 'renamed-a', game_name: 'renamed-a New' },
      { puuid: 'renamed-b', game_name: 'renamed-b Newest' },
    ]);
  });

  it('pages a queue id with more than 100 matches until the listing runs out', async () => {
    const matches = Array.from({ length: 101 }, (_, index) =>
      buildMatch({ id: `BR1_92000${String(index).padStart(5, '0')}`, created: SEASON_3_DAY + index * HOUR, teams: [['pager'], ['pager-rival']] }),
    );
    for (const match of matches) await fake.addMatch(match);
    await account('pager', 'Pager');

    const profile = await searchAndDrain('Pager', 'BR1');

    // The current season's listings; the backfill's, one per queue id, carry an end time.
    const all = listingsOf((await fake.requests()).map((seen) => seen.path), 'pager');
    const listings = all.filter((path) => !path.includes('endTime='));
    expect(all).toHaveLength(listings.length + 4);
    expect(listings.filter((path) => path.includes('queue=1700'))).toEqual([
      expect.stringContaining('start=0&count=100'),
      expect.stringContaining('start=100&count=100'),
    ]);
    expect(listings).toHaveLength(5);
    // Two teams of one: nothing under the default 6x3, all of it under 2x1.
    expect(profile).toMatchObject({ syncState: 'complete', format: '6x3', totals: { games: 0 } });
    const games = await request(app.http).get('/api/profiles/br/Pager/BR1?format=2x1').expect(200);
    expect((games.body as ProfileResponse).totals.games).toBe(101);
  });

  const serverError = { status: 500, body: { status: { status_code: 500 } } };

  async function games(gameName: string, query = ''): Promise<number> {
    const path = `/api/profiles/br/${encodeURIComponent(gameName)}/BR1?format=2x1${query}`;
    return ((await request(app.http).get(path).expect(200)).body as ProfileResponse).totals.games;
  }

  it('retries a Riot error and finishes the run', async () => {
    const match = buildMatch({ id: 'BR1_9300000001', created: SEASON_3_DAY, teams: [['retry-a'], ['retry-a-rival']] });
    await fake.addMatch(match);
    await fake.respondNext({ path: matchPath(match.metadata.matchId), times: 2, response: serverError });
    await account('retry-a', 'Player retry-a');

    const profile = await searchAndDrain('Player retry-a', 'BR1');

    expect(profile.syncState).toBe('complete');
    expect(await games('Player retry-a')).toBe(1);
    const fetches = (await fake.requests()).filter((seen) => seen.path === matchPath(match.metadata.matchId));
    expect(fetches).toHaveLength(3);
    expect(await app.queue(QUEUES.riot).getJobCounts('failed')).toEqual({ failed: 0 });
  });

  it('finishes a run whose job fails for good and leaves the player to be synced again', async () => {
    const match = buildMatch({ id: 'BR1_9300000002', created: SEASON_3_DAY, teams: [['retry-b'], ['retry-b-rival']] });
    await fake.addMatch(match);
    await fake.respondNext({ path: matchPath(match.metadata.matchId), times: 5, response: serverError });
    await account('retry-b', 'Player retry-b');

    await request(app.http).get('/api/profiles/br/Player%20retry-b/BR1').expect(200);
    await app.drain(60_000);

    const row = await pg.query("select sync_state, last_synced_at from players where puuid = 'retry-b'");
    expect(row.rows).toEqual([{ sync_state: 'unknown', last_synced_at: null }]);
    expect(await app.queue(QUEUES.riot).getJobCounts('failed')).toEqual({ failed: 1 });

    // The next view starts the primary sync again, from the tracked player, and it completes.
    const again = await request(app.http).get('/api/profiles/br/Player%20retry-b/BR1').expect(200);
    expect((again.body as ProfileResponse).syncState).toBe('primary-syncing');
    await app.drain(60_000);
    const synced = await request(app.http).get('/api/profiles/br/Player%20retry-b/BR1').expect(200);
    expect((synced.body as ProfileResponse).syncState).toBe('complete');
    expect(await games('Player retry-b')).toBe(1);
    const fetches = (await fake.requests()).filter((seen) => seen.path === matchPath(match.metadata.matchId));
    expect(fetches).toHaveLength(6);
  });

  it('gives a player with no current-season games their earlier seasons', async () => {
    const match = buildMatch({
      id: 'BR1_9300000003',
      created: Date.parse('2026-06-01T12:00:00Z'),
      version: '16.10.1.1',
      teams: [['s2only'], ['s2only-rival']],
    });
    await fake.addMatch(match);
    await account('s2only', 'Player s2only');

    const profile = await searchAndDrain('Player s2only', 'BR1');

    expect(profile.syncState).toBe('complete');
    expect(profile.message).toBeUndefined();
    const seasons = ((await request(app.http).get('/api/seasons').expect(200)).body as SeasonsResponse).seasons;
    const season2 = seasons.find((season) => season.name === '2026 Season 2')!;
    expect(await games('Player s2only', `&season=${season2.id}`)).toBe(1);
    expect(await games('Player s2only')).toBe(0);
  });
});

describe('the riot queue limiter', () => {
  let fake: FakeUpstream;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
  });

  afterAll(async () => {
    await fake.close();
  });

  beforeEach(async () => {
    await fake.reset();
  });

  /** The most requests the fake saw inside any `windowMs`. */
  function busiest(times: readonly number[], windowMs: number): number {
    const sorted = [...times].sort((a, b) => a - b);
    return Math.max(...sorted.map((at, i) => sorted.filter((other, j) => j >= i && other < at + windowMs).length));
  }

  it('holds requests to the per-second limit', async () => {
    const app = await startApp({ worker: true, env: { ...riotEnv(fake), RIOT_RATE_PER_SECOND: '2', RIOT_RATE_PER_TWO_MINUTES: '100' } });
    try {
      await Promise.all(
        Array.from({ length: 6 }, () => request(app.http).get('/api/profiles/br/Ninguem/0000').expect(404)),
      );
      const times = (await fake.requests()).map((seen) => seen.at);

      expect(times).toHaveLength(6);
      // A little under a second, for the time between acquiring a slot and the request arriving.
      expect(busiest(times, 900)).toBeLessThanOrEqual(2);
    } finally {
      await app.close();
    }
  });

  it('holds requests to the two-minute limit', async () => {
    const app = await startApp({ worker: true, env: { ...riotEnv(fake), RIOT_RATE_PER_SECOND: '50', RIOT_RATE_PER_TWO_MINUTES: '3' } });
    try {
      const queue = app.queue(QUEUES.riot);
      for (let i = 0; i < 4; i += 1) await queue.add('account-by-riot-id', { region: 'br', gameName: 'Ninguem', tagLine: '0000' });
      const deadline = Date.now() + 5000;
      while ((await fake.requests()).length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 1000));

      expect(await fake.requests()).toHaveLength(3);
      const { completed, ...unfinished } = await queue.getJobCounts('completed', 'wait', 'prioritized', 'delayed', 'active');
      expect(completed).toBe(3);
      expect(Object.values(unfinished).reduce((sum, n) => sum + n, 0)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('keeps a tenth of each window for the lookup a search waits on, counted in the same windows', async () => {
    // Ten per two minutes: syncs may take nine, the tenth is the lookup's.
    const app = await startApp({ worker: true, env: { ...riotEnv(fake), RIOT_RATE_PER_SECOND: '1000', RIOT_RATE_PER_TWO_MINUTES: '10' } });
    try {
      const queue = app.queue(QUEUES.riot);
      // Prioritised jobs standing in for a sync that saturates the key.
      for (let i = 0; i < 30; i += 1) {
        await queue.add('account-by-riot-id', { region: 'br', gameName: 'Player0001', tagLine: 'ANON' }, { priority: 2 });
      }
      const deadline = Date.now() + 5000;
      while ((await fake.requests()).length < 9 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 1500));
      expect(await fake.requests()).toHaveLength(9);

      // A Riot ID never seen still gets its answer, a 404, instead of a 503 after ten seconds.
      await request(app.http).get('/api/profiles/br/Ninguem/0000').expect(404);
      const seen = await fake.requests();
      expect(seen).toHaveLength(10);
      expect(seen[9]!.path).toContain('Ninguem');

      // The lookup took the window's last slot: the next one waits it out.
      await request(app.http).get('/api/profiles/br/Ninguem/0000').expect(503);
      expect(await fake.requests()).toHaveLength(10);
    } finally {
      await app.close();
    }
  });
});
