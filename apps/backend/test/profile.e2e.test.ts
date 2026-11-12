import { DEFAULT_FIXTURES_DIR, loadFixtures, matchIdOfPath, matchPath, readManifest, startFakeUpstream, type FakeUpstream } from '@arena/fake-upstream';
import type { ProfileResponse, SeasonsResponse } from '@arena/shared';
import { Pool } from 'pg';
import request from 'supertest';
import type { MatchDto } from '../src/modules/riot-client/riot.types';
import { scratchDatabase, startApp, type ScratchDatabase, type TestApp } from './harness';

// The profile endpoint against the fake serving the committed fixture set:
// search a Riot ID, let the queue drain, search again.

const manifest = readManifest(DEFAULT_FIXTURES_DIR);
const [primary, teammate] = manifest.players;

const fixtureMatches = new Map(
  loadFixtures(DEFAULT_FIXTURES_DIR).flatMap((fixture) => {
    const id = matchIdOfPath(fixture.path);
    return id && fixture.status === 200 ? [[id, fixture.body as MatchDto] as const] : [];
  }),
);

/** The placements a player took in the given fixture matches. */
function placementsOf(puuid: string, matchIds: readonly string[]): number[] {
  return matchIds.map((id) => fixtureMatches.get(id)!.info.participants.find((p) => p.puuid === puuid)!.placement);
}

jest.setTimeout(60_000);

describe('profile endpoint', () => {
  let fake: FakeUpstream;
  let db: ScratchDatabase;
  let app: TestApp;
  let pg: Pool;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    db = await scratchDatabase();
    app = await startApp({
      worker: true,
      env: {
        DATABASE_URL: db.url,
        RIOT_API_BASE_AMERICAS: fake.url,
        RIOT_API_BASE_BR1: fake.url,
        RIOT_API_KEY: 'RGAPI-test',
        RIOT_RATE_PER_SECOND: '1000',
        RIOT_RATE_PER_TWO_MINUTES: '100000',
      },
    });
    pg = new Pool({ connectionString: db.url });
  });

  afterAll(async () => {
    await pg.end();
    await app.close();
    await db.drop();
    await fake.close();
  });

  it('answers 404 naming a Riot ID that does not resolve', async () => {
    const response = await request(app.http).get('/api/profiles/br/Ninguem/0000').expect(404);

    expect(response.body).toMatchObject({ message: 'No such Riot ID: Ninguem#0000' });
  });

  it('starts a primary sync for a Riot ID seen for the first time', async () => {
    const response = await request(app.http).get('/api/profiles/br/Player0001/ANON').expect(200);
    const body = response.body as ProfileResponse;

    expect(body.player).toMatchObject({ gameName: 'Player0001', tagLine: 'ANON', region: 'br' });
    expect(body.syncState).toBe('primary-syncing');
  });

  it('answers with current-season 6x3 totals once the queue drains', async () => {
    await app.drain(60_000);
    const response = await request(app.http).get('/api/profiles/br/Player0001/ANON').expect(200);
    const body = response.body as ProfileResponse;

    // Every recorded current-season match of Player0001 is a 6x3 lobby.
    const placements = placementsOf(primary!.puuid, primary!.currentSeasonMatchIds);
    expect(body.syncState).toBe('complete');
    expect(body.format).toBe('6x3');
    expect(body.scope).toMatchObject({ kind: 'season', name: '2026 Season 3' });
    expect(body.totals.games).toBe(primary!.currentSeasonMatchIds.length);
    expect(body.totals.wins).toBe(placements.filter((p) => p === 1).length);
    expect(body.totals.top4Rate).toBeCloseTo(placements.filter((p) => p <= 4).length / placements.length, 6);
    expect(body.totals.averagePlacement).toBeCloseTo(placements.reduce((a, b) => a + b, 0) / placements.length, 6);
    expect(body.totals.placements).toEqual(
      [1, 2, 3, 4, 5, 6].map((placement) => ({ placement, games: placements.filter((p) => p === placement).length })),
    );
  });

  async function gamesOf(path: string): Promise<number> {
    const response = await request(app.http).get(path).expect(200);
    return (response.body as ProfileResponse).totals.games;
  }

  it('reports the derived 8x2 lobby under 8x2 and keeps the irregular one out of every format total', async () => {
    // Season 3 holds the recorded 6x3 games, one derived 8x2 lobby and one derived irregular lobby.
    expect(await gamesOf('/api/profiles/br/Player0001/ANON?format=8x2')).toBe(1);
    expect(await gamesOf('/api/profiles/br/Player0001/ANON?format=6x3')).toBe(primary!.currentSeasonMatchIds.length);
    expect(await gamesOf('/api/profiles/br/Player0001/ANON?format=irregular')).toBe(1);
  });

  it('counts the game played on the last patch of Season 2, after Season 3 started, under Season 2', async () => {
    const seasons = ((await request(app.http).get('/api/seasons').expect(200)).body as SeasonsResponse).seasons;
    const season2 = seasons.find((season) => season.name === '2026 Season 2')!;

    const response = await request(app.http).get(`/api/profiles/br/Player0001/ANON?season=${season2.id}`).expect(200);
    const body = response.body as ProfileResponse;

    // The backfill's twenty recorded 6x3 games of Season 2, and the last-patch fixture the primary sync finds.
    expect(body.scope).toEqual({ kind: 'season', seasonId: season2.id, name: '2026 Season 2' });
    expect(body.totals.games).toBe(21);
  });

  it('counts the 6x3 games of every season all-time', async () => {
    // Season 3's recorded games, Season 2's twenty and its last-patch game, and the derived Season 1 game.
    expect(await gamesOf('/api/profiles/br/Player0001/ANON?season=all')).toBe(primary!.currentSeasonMatchIds.length + 22);
  });

  it('starts a primary sync for a player known only from matches, and counts shared matches for both', async () => {
    // Discovered through Player0001's matches, never synced.
    const before = await pg.query('select game_name, sync_state from players where puuid = $1', [teammate!.puuid]);
    expect(before.rows).toEqual([{ game_name: 'Player0002', sync_state: 'unknown' }]);

    const searched = await request(app.http).get('/api/profiles/br/Player0002/ANON').expect(200);
    expect((searched.body as ProfileResponse).syncState).toBe('primary-syncing');
    await app.drain(60_000);

    const response = await request(app.http).get('/api/profiles/br/Player0002/ANON').expect(200);
    const body = response.body as ProfileResponse;
    expect(body.syncState).toBe('complete');
    expect(body.totals.games).toBe(teammate!.currentSeasonMatchIds.length);
    expect(await gamesOf('/api/profiles/br/Player0001/ANON')).toBe(primary!.currentSeasonMatchIds.length);

    // Each match both played was fetched once, by the first sync, and stored once.
    const fetched = (await fake.requests()).map((seen) => seen.path);
    for (const id of manifest.sharedCurrentSeasonMatchIds) {
      expect(fetched.filter((path) => path === matchPath(id))).toHaveLength(1);
    }
    const stored = await pg.query<{ n: number }>('select count(*)::int as n from matches where id = any($1)', [
      manifest.sharedCurrentSeasonMatchIds,
    ]);
    expect(stored.rows[0]?.n).toBe(manifest.sharedCurrentSeasonMatchIds.length);
  });

  it('answers 200 with no-arena-games for an account without Arena matches', async () => {
    expect((await request(app.http).get('/api/profiles/br/Sem%20Arena/BR1').expect(200)).body).toMatchObject({
      syncState: 'primary-syncing',
    });
    await app.drain();

    const response = await request(app.http).get('/api/profiles/br/Sem%20Arena/BR1').expect(200);
    expect(response.body).toMatchObject({
      syncState: 'no-arena-games',
      message: 'Sem Arena#BR1 has no Arena games in any season',
      totals: { games: 0, wins: 0, top4Rate: null, averagePlacement: null },
    });
  });

  it('answers 503 when the Riot ID lookup fails', async () => {
    // A Riot ID never seen, so the API asks Riot. A 429 is waited out instead
    // (rate-limit.e2e); an error status on every attempt fails the job.
    await fake.respondNext({
      path: '/riot/account/v1/accounts/by-riot-id/Falha/BR1',
      times: 5,
      response: { status: 500, body: { status: { status_code: 500 } } },
    });

    const response = await request(app.http).get('/api/profiles/br/Falha/BR1').expect(503);

    expect(response.body).toMatchObject({ message: expect.stringContaining('Riot did not answer') });
    // The lookup keeps retrying after the API gave up; let it end before the next test.
    await app.drain(60_000);
  });

  it('answers a tracked player without asking Riot', async () => {
    const before = (await fake.requests()).length;

    await request(app.http).get('/api/profiles/br/Player0001/ANON').expect(200);

    expect((await fake.requests()).length).toBe(before);
  });

  it('follows a renamed account to its existing row', async () => {
    await fake.respondNext({
      path: '/riot/account/v1/accounts/by-riot-id/Player0001%20Novo/ANON',
      response: { status: 200, body: { puuid: primary!.puuid, gameName: 'Player0001 Novo', tagLine: 'ANON' } },
    });

    const response = await request(app.http).get('/api/profiles/br/Player0001%20Novo/ANON').expect(200);
    const body = response.body as ProfileResponse;

    expect(body.player).toEqual({ puuid: primary!.puuid, region: 'br', gameName: 'Player0001 Novo', tagLine: 'ANON' });
    expect(body.syncState).toBe('complete');
    expect(body.totals.games).toBe(primary!.currentSeasonMatchIds.length);
    const rows = await pg.query('select game_name, tag_line from players where puuid = $1 or game_name like $2', [
      primary!.puuid,
      'Player0001%',
    ]);
    expect(rows.rows).toEqual([{ game_name: 'Player0001 Novo', tag_line: 'ANON' }]);
  });
});
