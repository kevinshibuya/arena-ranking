import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DEFAULT_FIXTURES_DIR, loadFixtures, matchIdOfPath, readManifest, startFakeUpstream, type FakeUpstream } from '@arena/fake-upstream';
import type {
  HealthResponse,
  LadderPositionResponse,
  LadderResponse,
  ProfileResponse,
  RatingResponse,
  SeasonsResponse,
} from '@arena/shared';
import { Pool } from 'pg';
import request from 'supertest';
import { QUEUES } from '../src/core/queues';
import type { MatchDto } from '../src/modules/riot-client/riot.types';
import { scratchDatabase, startApp, type ScratchDatabase, type TestApp } from './harness';

// The ladder, a player's position on it and their rating, over the committed
// fixtures: both recorded players synced, then the replay run.

const manifest = readManifest(DEFAULT_FIXTURES_DIR);
const [primary, teammate] = manifest.players;

const currentSeasonMatches = new Set([...primary!.currentSeasonMatchIds, ...teammate!.currentSeasonMatchIds]);
const fixtureMatches = loadFixtures(DEFAULT_FIXTURES_DIR).flatMap((fixture) => {
  const id = matchIdOfPath(fixture.path);
  return id && fixture.status === 200 && currentSeasonMatches.has(id) ? [fixture.body as MatchDto] : [];
});

/** Recorded current-season games of a Riot ID, counted from the fixture files. */
function recordedGames(gameName: string, tagLine: string): number {
  return fixtureMatches.filter((match) =>
    match.info.participants.some((p) => p.riotIdGameName === gameName && p.riotIdTagline === tagLine),
  ).length;
}

const ROOT = join(__dirname, '..', '..', '..');

jest.setTimeout(120_000);

describe('ladder', () => {
  let fake: FakeUpstream;
  let db: ScratchDatabase;
  let app: TestApp;
  let pg: Pool;
  let season3: number;
  let season2: number;
  let season1: number;

  const env = (): Record<string, string> => ({
    DATABASE_URL: db.url,
    RIOT_API_BASE_AMERICAS: fake.url,
    RIOT_API_BASE_BR1: fake.url,
    RIOT_API_KEY: 'RGAPI-test',
    RIOT_RATE_PER_SECOND: '1000',
    RIOT_RATE_PER_TWO_MINUTES: '100000',
  });

  async function ladder(app: TestApp, query: string): Promise<LadderResponse> {
    return (await request(app.http).get(`/api/ladders/br?${query}`).expect(200)).body as LadderResponse;
  }

  async function replayJob(): Promise<void> {
    await app.queue(QUEUES.maintenance).add('rating-replay', {});
    await app.drain(60_000);
  }

  /** `pnpm replay` against this app's database and queues, with the app's worker in this process. */
  function pnpmReplay(): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['replay'], {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: db.url, REDIS_URL: app.config.redisUrl, REDIS_PREFIX: app.config.redisPrefix },
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, output }));
    });
  }

  async function storedLadder(scope: string, minGames: number): Promise<Array<{ puuid: string; ordinal: number }>> {
    const result = await pg.query<{ puuid: string; ordinal: number }>(
      `select puuid, ordinal from ratings
       where run_id = (select max(id) from replay_runs where completed_at is not null)
         and format = '6x3' and scope = $1 and games >= $2
       order by ordinal desc`,
      [scope, minGames],
    );
    return result.rows;
  }

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    db = await scratchDatabase();
    app = await startApp({ worker: true, env: env() });
    pg = new Pool({ connectionString: db.url });

    await request(app.http).get('/api/profiles/br/Player0001/ANON').expect(200);
    await app.drain(60_000);
    await request(app.http).get('/api/profiles/br/Player0002/ANON').expect(200);
    await app.drain(60_000);

    const seasons = ((await request(app.http).get('/api/seasons').expect(200)).body as SeasonsResponse).seasons;
    season3 = seasons.find((season) => season.name === '2026 Season 3')!.id;
    season2 = seasons.find((season) => season.name === '2026 Season 2')!.id;
    season1 = seasons.find((season) => season.name === '2026 Season 1')!.id;
  });

  afterAll(async () => {
    await pg.end();
    await app.close();
    await db.drop();
    await fake.close();
  });

  it('is empty, with no last replay and the next one scheduled, before the first replay', async () => {
    const body = await ladder(app, 'format=6x3');

    expect(body).toMatchObject({ format: '6x3', minGames: 10, entries: [], nextCursor: null, lastReplayAt: null });
    expect(body.scope).toEqual({ kind: 'season', seasonId: season3, name: '2026 Season 3' });
    const health = (await request(app.http).get('/api/health').expect(200)).body as HealthResponse;
    expect(health.rating.lastReplayAt).toBeNull();
    expect(Date.parse(health.rating.nextReplayAt!)).toBeGreaterThan(Date.now());
  });

  it('pnpm replay enqueues a replay, waits for it, and health shows the last and next replay', async () => {
    const before = Date.now();
    const run = await pnpmReplay();

    expect(run).toMatchObject({ code: 0 });
    const health = (await request(app.http).get('/api/health').expect(200)).body as HealthResponse;
    const last = Date.parse(health.rating.lastReplayAt!);
    const next = Date.parse(health.rating.nextReplayAt!);
    expect(last).toBeGreaterThanOrEqual(before - 1000);
    expect(last).toBeLessThanOrEqual(Date.now());
    // Every two hours, on the hour.
    expect(next).toBeGreaterThan(Date.now());
    expect(next - Date.now()).toBeLessThanOrEqual(2 * 3600_000);
    expect(next % 3600_000).toBe(0);
  });

  it('lists current-season 6x3 players with 10 games or more by stored rating, highest first', async () => {
    const body = await ladder(app, 'format=6x3&limit=100');
    const stored = await storedLadder(String(season3), 10);

    expect(body.entries.map((entry) => entry.player.puuid)).toEqual(stored.map((row) => row.puuid));
    expect(body.entries.map((entry) => entry.rating)).toEqual(stored.map((row) => row.ordinal));
    expect(body.entries.map((entry) => entry.rank)).toEqual(stored.map((_, index) => index + 1));
    expect(body.nextCursor).toBeNull();
    // Player0001 74, Player0002 60, Player0152 40, Player0045 15, Player0457 10; Player0919's 7 are not enough.
    expect(body.entries.map((entry) => `${entry.player.gameName}#${entry.player.tagLine}`).sort()).toEqual(
      ['Player0002#ANON', 'Player0152#ANON', 'Player0001#ANON', 'Player0045#ANON', 'Player0457#ANON'].sort(),
    );
    expect(body.entries.every((entry) => entry.games >= 10)).toBe(true);
    expect(body.lastReplayAt).not.toBeNull();
  });

  it("gives each row the player's games, win rate, top-4 rate and average placement", async () => {
    const body = await ladder(app, 'format=6x3&limit=100');
    const row = body.entries.find((entry) => entry.player.gameName === 'Player0001')!;
    const profile = (await request(app.http).get('/api/profiles/br/Player0001/ANON').expect(200)).body as ProfileResponse;

    expect(row.games).toBe(primary!.currentSeasonMatchIds.length);
    expect(row.winRate).toBeCloseTo(profile.totals.wins / profile.totals.games, 10);
    expect(row.top4Rate).toBeCloseTo(profile.totals.top4Rate!, 10);
    expect(row.averagePlacement).toBeCloseTo(profile.totals.averagePlacement!, 10);
  });

  it('pages by cursor, ranks continuing across pages', async () => {
    const first = await ladder(app, 'format=6x3&limit=2');
    const second = await ladder(app, `format=6x3&limit=2&cursor=${first.nextCursor}`);
    const third = await ladder(app, `format=6x3&limit=2&cursor=${second.nextCursor}`);
    const all = await ladder(app, 'format=6x3&limit=100');

    expect([...first.entries, ...second.entries, ...third.entries]).toEqual(all.entries);
    expect(third.entries.map((entry) => entry.rank)).toEqual([5]);
    expect(third.nextCursor).toBeNull();
  });

  it('with LADDER_MIN_GAMES lowered, lists more players, two pages at limit=1', async () => {
    const lowered = await startApp({ env: { ...env(), LADDER_MIN_GAMES: '5' } });
    try {
      const first = await ladder(lowered, 'format=6x3&limit=1');
      const second = await ladder(lowered, `format=6x3&limit=1&cursor=${first.nextCursor}`);
      const all = await ladder(lowered, 'format=6x3&limit=100');

      expect(first.minGames).toBe(5);
      expect(first.entries).toHaveLength(1);
      expect(second.entries).toHaveLength(1);
      expect([...first.entries, ...second.entries]).toEqual(all.entries.slice(0, 2));
      expect(second.entries[0]!.rank).toBe(2);
      // Player0919's 7 games and the two players on 5 now count.
      expect(all.entries.map((entry) => entry.player.puuid)).toEqual(
        (await storedLadder(String(season3), 5)).map((row) => row.puuid),
      );
      expect(all.entries.length).toBeGreaterThan(5);
    } finally {
      await lowered.close();
    }
  });

  it('keeps a game on the last patch of Season 2 on the Season 2 ladder and all-time', async () => {
    const lowered = await startApp({ env: { ...env(), LADDER_MIN_GAMES: '1' } });
    try {
      const s2 = await ladder(lowered, `format=6x3&season=${season2}&limit=100`);
      const all = await ladder(lowered, 'format=6x3&season=all&limit=100');

      expect(s2.scope).toEqual({ kind: 'season', seasonId: season2, name: '2026 Season 2' });
      // The backfill's twenty recorded 6x3 games of Season 2, and the last-patch game.
      expect(s2.entries.find((entry) => entry.player.gameName === 'Player0001')?.games).toBe(21);
      expect(all.scope).toEqual({ kind: 'all-time' });
      // Season 3's, Season 2's and the derived Season 1 game.
      expect(all.entries.find((entry) => entry.player.gameName === 'Player0001')?.games).toBe(
        primary!.currentSeasonMatchIds.length + 22,
      );
    } finally {
      await lowered.close();
    }
  });

  it('keeps 8x2 games on their own ladder and has none for irregular lobbies', async () => {
    const lowered = await startApp({ env: { ...env(), LADDER_MIN_GAMES: '1' } });
    try {
      const eight = await ladder(lowered, 'format=8x2&limit=100');

      expect(eight.entries.length).toBe(16);
      expect(eight.entries.every((entry) => entry.games === 1)).toBe(true);
      await request(lowered.http).get('/api/ladders/br?format=irregular').expect(400);
    } finally {
      await lowered.close();
    }
  });

  it('answers 400 for a bad limit, cursor or season, and 404 for an unknown region', async () => {
    await request(app.http).get('/api/ladders/br?limit=0').expect(400);
    await request(app.http).get('/api/ladders/br?limit=101').expect(400);
    await request(app.http).get('/api/ladders/br?cursor=nonsense').expect(400);
    await request(app.http).get('/api/ladders/br?season=999').expect(400);
    await request(app.http).get('/api/ladders/xx').expect(404);
  });

  describe('position', () => {
    it('gives the rank of a ranked player', async () => {
      const all = await ladder(app, 'format=6x3&limit=100');
      const response = await request(app.http).get('/api/ladders/br/players/Player0002/ANON').expect(200);
      const body = response.body as LadderPositionResponse;
      const row = all.entries.find((entry) => entry.player.puuid === teammate!.puuid)!;

      expect(body).toMatchObject({
        player: { puuid: teammate!.puuid, gameName: 'Player0002', tagLine: 'ANON' },
        format: '6x3',
        minGames: 10,
        ranked: true,
        rank: row.rank,
        rating: row.rating,
        games: teammate!.currentSeasonMatchIds.length,
      });
    });

    it('gives unranked with the games remaining for a player short of the minimum, matching the Riot ID in any case', async () => {
      const games = recordedGames('Player0919', 'ANON');
      const response = await request(app.http).get('/api/ladders/br/players/PLAYER0919/anon').expect(200);

      expect(games).toBe(7);
      expect(response.body).toMatchObject({ ranked: false, games, gamesRemaining: 10 - games });
    });

    it('gives unranked with every game remaining for a player with no game in the scope', async () => {
      const response = await request(app.http).get(`/api/ladders/br/players/Player0919/ANON?season=${season2}`).expect(200);

      expect(response.body).toMatchObject({ ranked: false, games: 0, gamesRemaining: 10 });
    });

    it('answers 404 for a Riot ID nobody has seen', async () => {
      await request(app.http).get('/api/ladders/br/players/Ninguem/0000').expect(404);
    });
  });

  describe('rating', () => {
    it("gives a ranked player's rating and one history point per rated match, oldest first", async () => {
      const all = await ladder(app, 'format=6x3&limit=100');
      const row = all.entries.find((entry) => entry.player.puuid === primary!.puuid)!;
      const body = (await request(app.http).get('/api/profiles/br/Player0001/ANON/rating').expect(200)).body as RatingResponse;

      expect(body).toMatchObject({
        player: { puuid: primary!.puuid, gameName: 'Player0001', tagLine: 'ANON', region: 'br' },
        format: '6x3',
        scope: { kind: 'season', seasonId: season3 },
        rating: row.rating,
        games: primary!.currentSeasonMatchIds.length,
        ranked: true,
        gamesRemaining: 0,
      });
      expect(body.history).toHaveLength(primary!.currentSeasonMatchIds.length);
      expect(new Set(body.history.map((point) => point.matchId))).toEqual(new Set(primary!.currentSeasonMatchIds));
      const ends = body.history.map((point) => Date.parse(point.endedAt));
      expect(ends).toEqual([...ends].sort((a, b) => a - b));
      expect(body.history.at(-1)!.rating).toBe(row.rating);
    });

    it('gives an unranked player their rating and the games remaining', async () => {
      // Season 1 holds one game of Player0001's: the derived one the backfill brings in.
      const body = (await request(app.http).get(`/api/profiles/br/Player0001/ANON/rating?season=${season1}`).expect(200))
        .body as RatingResponse;

      expect(body).toMatchObject({ games: 1, ranked: false, gamesRemaining: 9 });
      expect(body.history).toHaveLength(1);
      expect(body.rating).toBe(body.history[0]!.rating);
    });

    it('answers 404 for a Riot ID nobody has seen', async () => {
      await request(app.http).get('/api/profiles/br/Ninguem/0000/rating').expect(404);
    });

    it('leaves the profile response as it was', async () => {
      const body = (await request(app.http).get('/api/profiles/br/Player0001/ANON').expect(200)).body as ProfileResponse;

      expect(Object.keys(body).sort()).toEqual(['format', 'player', 'scope', 'syncState', 'totals']);
    });
  });

  describe('replay runs', () => {
    it('serves the previous complete run while a run is in progress', async () => {
      const before = await ladder(app, 'format=6x3&limit=100');
      const belowCut = (await pg.query<{ puuid: string }>(`select puuid from players where game_name = 'Player0919'`)).rows[0]!;
      // A run that has started and written a rating, but not completed.
      const started = await pg.query<{ id: number }>('insert into replay_runs default values returning id');
      await pg.query(
        `insert into ratings (run_id, puuid, format, scope, mu, sigma, ordinal, games, wins, top4s, placement_sum)
         values ($1, $2, '6x3', $3, 99, 1, 96, 50, 50, 50, 50)`,
        [started.rows[0]!.id, belowCut.puuid, String(season3)],
      );

      const during = await ladder(app, 'format=6x3&limit=100');
      const position = (await request(app.http).get('/api/ladders/br/players/Player0919/ANON').expect(200)).body as LadderPositionResponse;

      expect(during).toEqual(before);
      expect(position.ranked).toBe(false);
    });

    it('keeps only the latest two runs after two further runs, and rates the same matches the same', async () => {
      const before = await ladder(app, 'format=6x3&limit=100');

      await replayJob();
      await replayJob();

      const runs = await pg.query<{ id: number; complete: boolean }>(
        'select id, completed_at is not null as complete from replay_runs order by id',
      );
      expect(runs.rows).toHaveLength(2);
      expect(runs.rows.every((run) => run.complete)).toBe(true);
      const after = await ladder(app, 'format=6x3&limit=100');
      expect(after.entries).toEqual(before.entries);
      expect(Date.parse(after.lastReplayAt!)).toBeGreaterThan(Date.parse(before.lastReplayAt!));
    });

    it('finishes a page from the run it started on, and refuses a cursor whose run is gone', async () => {
      const first = await ladder(app, 'format=6x3&limit=2');
      await replayJob();
      const second = await ladder(app, `format=6x3&limit=2&cursor=${first.nextCursor}`);
      expect(second.entries.map((entry) => entry.rank)).toEqual([3, 4]);

      await replayJob();
      await request(app.http).get(`/api/ladders/br?format=6x3&limit=2&cursor=${first.nextCursor}`).expect(400);
    });
  });
});
