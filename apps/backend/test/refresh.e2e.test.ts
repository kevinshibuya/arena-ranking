import { buildMatch, startFakeUpstream, type FakeUpstream } from '@arena/fake-upstream';
import type { RefreshResponse } from '@arena/shared';
import request from 'supertest';
import { scratchDatabase, startApp, type ScratchDatabase, type TestApp } from './harness';

// The update-now policy: a two-minute cooldown per profile and ten refreshes a
// minute per client, the client's address taken from X-Forwarded-For only when
// the request comes from a trusted proxy.

/** Inside 2026 Season 3. */
const SEASON_3_DAY = Date.parse('2026-09-15T12:00:00Z');

const riotEnv = (fake: FakeUpstream): Record<string, string> => ({
  RIOT_API_BASE_AMERICAS: fake.url,
  RIOT_API_BASE_BR1: fake.url,
  RIOT_API_KEY: 'RGAPI-test',
  RIOT_RATE_PER_SECOND: '1000',
  RIOT_RATE_PER_TWO_MINUTES: '100000',
});

jest.setTimeout(60_000);

describe('refresh', () => {
  let fake: FakeUpstream;
  let db: ScratchDatabase;
  let app: TestApp;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    db = await scratchDatabase();
    // The test's requests come from loopback, the default trusted proxy.
    app = await startApp({ worker: true, env: { DATABASE_URL: db.url, ...riotEnv(fake) } });

    // Searched and synced: refresh-a. Known only from the match: refresh-b to refresh-f.
    await fake.addMatch(
      buildMatch({
        id: 'BR1_9400000001',
        created: SEASON_3_DAY,
        teams: [['refresh-a'], ['refresh-b'], ['refresh-c'], ['refresh-d'], ['refresh-e'], ['refresh-f']],
      }),
    );
    await fake.respondNext({
      path: '/riot/account/v1/accounts/by-riot-id/Player%20refresh-a/BR1',
      times: 10,
      response: { status: 200, body: { puuid: 'refresh-a', gameName: 'Player refresh-a', tagLine: 'BR1' } },
    });
    await request(app.http).get('/api/profiles/br/Player%20refresh-a/BR1').expect(200);
    await app.drain(30_000);
  });

  afterAll(async () => {
    await app.close();
    await db.drop();
    await fake.close();
  });

  const path = (puuid: string) => `/api/profiles/br/Player%20${puuid}/BR1/refresh`;

  function post(puuid: string, forwardedFor?: string) {
    const req = request(app.http).post(path(puuid));
    return forwardedFor ? req.set('X-Forwarded-For', forwardedFor) : req;
  }

  async function listingsFor(puuid: string): Promise<number> {
    return (await fake.requests()).filter((seen) => seen.path.startsWith(`/lol/match/v5/matches/by-puuid/${puuid}/ids?`)).length;
  }

  it('queues a sync and starts the two-minute cooldown', async () => {
    const before = await listingsFor('refresh-a');
    const { lastSyncedAt } = (await request(app.http).get(path('refresh-a')).expect(200)).body as RefreshResponse;

    const response = await post('refresh-a', '198.51.100.1').expect(202);
    await app.drain();

    expect(response.body).toEqual({ queued: true, cooldownSeconds: 120, lastSyncedAt });
    expect(await listingsFor('refresh-a')).toBe(before + 4);
    const state = (await request(app.http).get(path('refresh-a')).expect(200)).body as RefreshResponse;
    expect(state.queued).toBe(false);
    expect(state.cooldownSeconds).toBeGreaterThan(110);
    expect(state.cooldownSeconds).toBeLessThanOrEqual(120);
    expect(Date.parse(state.lastSyncedAt!)).toBeGreaterThan(Date.parse(lastSyncedAt!));
  });

  it('refuses inside the cooldown without queueing, with the time left', async () => {
    const before = await listingsFor('refresh-a');

    const response = await post('refresh-a', '198.51.100.2').expect(429);
    await app.drain();

    const body = response.body as RefreshResponse;
    expect(body).toMatchObject({ queued: false, refused: 'cooldown' });
    expect(body.cooldownSeconds).toBeGreaterThan(100);
    expect(response.headers['retry-after']).toBe(String(body.cooldownSeconds));
    expect(await listingsFor('refresh-a')).toBe(before);
  });

  it('limits a client to ten refreshes a minute, whichever profiles, apart from the cooldown', async () => {
    // Ten from one client: all inside refresh-a's cooldown, all counted.
    for (let i = 0; i < 10; i += 1) await post('refresh-a', '203.0.113.9').expect(429);

    const limited = await post('refresh-b', '203.0.113.9').expect(429);
    const other = await post('refresh-b', '203.0.113.10').expect(202);

    expect(limited.body).toMatchObject({ queued: false, refused: 'rate-limited', cooldownSeconds: 0 });
    expect((limited.body as RefreshResponse).retryAfterSeconds).toBeGreaterThan(0);
    expect(other.body).toMatchObject({ queued: true, cooldownSeconds: 120 });
  });

  it('gives a player never synced a primary sync, then their earlier seasons', async () => {
    expect(((await request(app.http).get(path('refresh-c')).expect(200)).body as RefreshResponse).lastSyncedAt).toBeNull();

    await post('refresh-c', '198.51.100.3').expect(202);
    await app.drain();

    // Four current-season listings, then four earlier-season ones.
    expect(await listingsFor('refresh-c')).toBe(8);
    expect(((await request(app.http).get(path('refresh-c')).expect(200)).body as RefreshResponse).lastSyncedAt).not.toBeNull();
  });

  it('answers 404 for a Riot ID nobody has seen', async () => {
    await post('nobody', '198.51.100.4').expect(404);
    await request(app.http).get(path('nobody')).expect(404);
  });
});

describe('refresh behind an untrusted peer', () => {
  let fake: FakeUpstream;
  let db: ScratchDatabase;
  let app: TestApp;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    db = await scratchDatabase();
    // Loopback is not the proxy here, so its X-Forwarded-For is ignored.
    app = await startApp({ worker: true, env: { DATABASE_URL: db.url, ...riotEnv(fake), TRUSTED_PROXIES: '10.9.9.9' } });
    await fake.addMatch(buildMatch({ id: 'BR1_9400000002', created: SEASON_3_DAY, teams: [['spoof-a'], ['spoof-b']] }));
    await fake.respondNext({
      path: '/riot/account/v1/accounts/by-riot-id/Player%20spoof-a/BR1',
      response: { status: 200, body: { puuid: 'spoof-a', gameName: 'Player spoof-a', tagLine: 'BR1' } },
    });
    await request(app.http).get('/api/profiles/br/Player%20spoof-a/BR1').expect(200);
    await app.drain(30_000);
  });

  afterAll(async () => {
    await app.close();
    await db.drop();
    await fake.close();
  });

  it('counts every request against the peer, whatever it forwards', async () => {
    for (let i = 0; i < 10; i += 1) {
      await request(app.http).post('/api/profiles/br/Player%20spoof-a/BR1/refresh').set('X-Forwarded-For', `192.0.2.${i}`);
    }

    const response = await request(app.http)
      .post('/api/profiles/br/Player%20spoof-b/BR1/refresh')
      .set('X-Forwarded-For', '192.0.2.200')
      .expect(429);

    expect(response.body).toMatchObject({ refused: 'rate-limited' });
  });
});
