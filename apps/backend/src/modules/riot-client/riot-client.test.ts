import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCanned, matchPath, readManifest, DEFAULT_FIXTURES_DIR, startFakeUpstream, type FakeUpstream } from '@arena/fake-upstream';
import { RiotClient, RiotKeyMissingError, type RiotClientConfig } from './riot-client';

// The client against the fake serving the committed fixture set, recorded from
// Player0001#ANON's history on 2026-10-09.

const [primary, teammate] = readManifest(DEFAULT_FIXTURES_DIR).players.map((player) => player.puuid) as [string, string];

describe('RiotClient against the fake upstream', () => {
  let fake: FakeUpstream;
  let scratch: string;
  let keyFile: string;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'riot-client-'));
    fake = await startFakeUpstream({ port: 0 });
  });

  beforeEach(async () => {
    await fake.reset();
    keyFile = join(scratch, 'riot.key');
    writeFileSync(keyFile, 'RGAPI-first\n');
  });

  afterAll(async () => {
    await fake.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  function client(overrides: Partial<RiotClientConfig> = {}): RiotClient {
    return new RiotClient({
      keyFile,
      apiKey: undefined,
      baseAmericas: fake.url,
      baseBr1: 'http://127.0.0.1:1',
      ...overrides,
    });
  }

  it('fetches an account by Riot ID, with the rate-limit headers Riot sent parsed', async () => {
    const result = await client().accountByRiotId('br', 'Player0001', 'ANON');

    expect(result).toEqual({
      kind: 'ok',
      status: 200,
      data: { puuid: primary, gameName: 'Player0001', tagLine: 'ANON' },
      // Recorded as X-App-Rate-Limit 100:120,20:1 with counts 1:120,1:1, and X-Method-Rate-Limit 1000:60 with 1:60.
      rateLimits: {
        app: [
          { seconds: 120, limit: 100, used: 1 },
          { seconds: 1, limit: 20, used: 1 },
        ],
        method: [{ seconds: 60, limit: 1000, used: 1 }],
      },
    });
  });

  it('fetches an account by Riot ID with spaces in the name', async () => {
    const result = await client().accountByRiotId('br', 'Player0002', 'ANON');

    expect(result).toMatchObject({ kind: 'ok', data: { puuid: teammate } });
  });

  it('reports a Riot ID that does not resolve as not found', async () => {
    const result = await client().accountByRiotId('br', 'Ninguem', '0000');

    expect(result).toMatchObject({ kind: 'not-found', status: 404 });
  });

  it('fetches an account by PUUID', async () => {
    const result = await client().accountByPuuid('br', primary);

    expect(result).toMatchObject({ kind: 'ok', status: 200, data: { gameName: 'Player0001', tagLine: 'ANON' } });
  });

  it('lists match ids by PUUID with queue, time window, start and count', async () => {
    // Player0001's 8x2 games of 2026-05-12, in queue 1700.
    const result = await client().matchIdsByPuuid('br', primary, {
      queue: 1700,
      startTime: new Date(1778603322_000),
      endTime: new Date(1778607661_000),
      start: 1,
      count: 2,
    });

    expect(result).toMatchObject({ kind: 'ok', status: 200, data: ['BR1_1000000007', 'BR1_1000000006'] });
    const [seen] = await fake.requests();
    expect(seen?.path).toBe(`/lol/match/v5/matches/by-puuid/${primary}/ids?queue=1700&startTime=1778603322&endTime=1778607661&start=1&count=2`);
  });

  it('fetches a match by id, typed', async () => {
    const result = await client().matchById('br', 'BR1_1000000001');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.metadata.matchId).toBe('BR1_1000000001');
    expect(result.data.info).toMatchObject({ queueId: 1700, gameMode: 'CHERRY', mapId: 30, gameVersion: expect.stringMatching(/^16\.9\./) });
    expect(result.data.info.participants).toHaveLength(16);
    const together = result.data.info.participants.filter((p) => p.puuid === primary || p.puuid === teammate);
    expect(together.map((p) => [p.playerSubteamId, p.placement])).toEqual([
      [1, 3],
      [1, 3],
    ]);
  });

  it('reports a 429 with its Retry-After seconds and rate-limit counts, without retrying', async () => {
    await fake.respondNext({ path: matchPath('BR1_1000000001'), response: loadCanned('rate-limited') });

    const result = await client().matchById('br', 'BR1_1000000001');

    expect(result).toEqual({
      kind: 'rate-limited',
      status: 429,
      retryAfterSeconds: 7,
      limitType: 'application',
      rateLimits: {
        app: [
          { seconds: 1, limit: 20, used: 3 },
          { seconds: 120, limit: 100, used: 101 },
        ],
        method: [{ seconds: 10, limit: 2000, used: 3 }],
      },
    });
    expect(await fake.requests()).toHaveLength(1);
  });

  it('reports a 403 as a rejected key, and re-reads the key file before the next request', async () => {
    await fake.respondNext({ path: '/riot/account/v1/*', response: loadCanned('key-rejected') });
    const riot = client();

    const rejected = await riot.accountByPuuid('br', primary);
    writeFileSync(keyFile, 'RGAPI-second\n');
    const next = await riot.accountByPuuid('br', primary);

    expect(rejected).toMatchObject({ kind: 'key-rejected', status: 403 });
    expect(next).toMatchObject({ kind: 'ok', status: 200 });
    expect((await fake.requests()).map((request) => request.riotToken)).toEqual(['RGAPI-first', 'RGAPI-second']);
  });

  it('reports a 401 as a rejected key too', async () => {
    await fake.respondNext({ path: '/riot/account/v1/*', response: { status: 401, body: { status: { message: 'Unknown apikey', status_code: 401 } } } });

    expect(await client().accountByPuuid('br', primary)).toMatchObject({ kind: 'key-rejected', status: 401 });
  });

  it('reports any other status as an error carrying the body', async () => {
    await fake.respondNext({ path: matchPath('BR1_1000000001'), response: { status: 503, body: { status: { message: 'Service unavailable', status_code: 503 } } } });

    expect(await client().matchById('br', 'BR1_1000000001')).toMatchObject({
      kind: 'error',
      status: 503,
      body: '{"status":{"message":"Service unavailable","status_code":503}}',
    });
  });

  it('falls back to the key variable when no key file is configured', async () => {
    await client({ keyFile: undefined, apiKey: 'RGAPI-env' }).accountByPuuid('br', primary);

    expect((await fake.requests()).map((request) => request.riotToken)).toEqual(['RGAPI-env']);
  });

  it('falls back to the key variable when the key file is missing or empty', async () => {
    await client({ keyFile: join(scratch, 'absent.key'), apiKey: 'RGAPI-env' }).accountByPuuid('br', primary);
    writeFileSync(keyFile, '  \n');
    await client({ apiKey: 'RGAPI-env' }).accountByPuuid('br', primary);

    expect((await fake.requests()).map((request) => request.riotToken)).toEqual(['RGAPI-env', 'RGAPI-env']);
  });

  it('refuses to send a request without any key', async () => {
    await expect(client({ keyFile: undefined }).accountByPuuid('br', primary)).rejects.toBeInstanceOf(RiotKeyMissingError);
    expect(await fake.requests()).toEqual([]);
  });

  it('sends account and match requests to the regional host of the region', async () => {
    const platformOnly = client({ baseAmericas: 'http://127.0.0.1:1', baseBr1: fake.url });

    await expect(platformOnly.accountByPuuid('br', primary)).rejects.toThrow();
    expect(await fake.requests()).toEqual([]);
  });
});
