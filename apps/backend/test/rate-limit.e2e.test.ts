import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadCanned, startFakeUpstream, type FakeUpstream } from '@arena/fake-upstream';
import type { HealthResponse, OpsHealth, ProfileResponse } from '@arena/shared';
import request from 'supertest';
import { QUEUES } from '../src/core/queues';
import { startApp, type TestApp } from './harness';

// How the worker reacts when Riot says stop: a 429 holds the whole `riot` queue
// for its Retry-After, then the job runs again by itself; a rejected key pauses
// it until the key file holds a key Riot accepts.

jest.setTimeout(60_000);

const RETRY_AFTER_SECONDS = 2;

describe('a 429 from Riot', () => {
  let fake: FakeUpstream;
  let app: TestApp;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    app = await startApp({
      worker: true,
      env: {
        RIOT_API_BASE_AMERICAS: fake.url,
        RIOT_API_BASE_BR1: fake.url,
        RIOT_API_KEY: 'RGAPI-test',
        RIOT_RATE_PER_SECOND: '1000',
        RIOT_RATE_PER_TWO_MINUTES: '100000',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await fake.close();
  });

  it('holds every request for Retry-After, then completes the job without help', async () => {
    const canned = loadCanned('rate-limited');
    await fake.respondNext({
      path: '/riot/account/v1/accounts/by-riot-id/*',
      response: { ...canned, headers: { ...canned.headers, 'retry-after': String(RETRY_AFTER_SECONDS) } },
    });

    // The search waits on the lookup, which meets the 429 first.
    const search = await request(app.http).get('/api/profiles/br/Sem%20Arena/BR1').expect(200);
    await app.drain(30_000);

    const [limited, ...after] = await fake.requests();
    expect(after.length).toBeGreaterThan(0);
    for (const seen of after) expect(seen.at - limited!.at).toBeGreaterThanOrEqual(RETRY_AFTER_SECONDS * 1000);
    expect((search.body as ProfileResponse).player.gameName).toBe('Sem Arena');
    const counts = await app.queue(QUEUES.riot).getJobCounts('completed', 'failed');
    expect(counts).toEqual({ completed: after.length, failed: 0 });
  });
});

describe('a rejected key', () => {
  const PROBE_INTERVAL_MS = 200;
  let fake: FakeUpstream;
  let app: TestApp;
  let keyDir: string;
  let keyFile: string;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    keyDir = mkdtempSync(join(tmpdir(), 'arena-key-'));
    keyFile = join(keyDir, 'riot.key');
    writeFileSync(keyFile, 'RGAPI-expired\n');
    app = await startApp({
      worker: true,
      env: {
        RIOT_API_BASE_AMERICAS: fake.url,
        RIOT_API_BASE_BR1: fake.url,
        RIOT_KEY_FILE: keyFile,
        RIOT_KEY_PROBE_INTERVAL_MS: String(PROBE_INTERVAL_MS),
        RIOT_RATE_PER_SECOND: '1000',
        RIOT_RATE_PER_TWO_MINUTES: '100000',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await fake.close();
    rmSync(keyDir, { recursive: true, force: true });
  });

  async function ops(): Promise<OpsHealth> {
    return ((await request(app.http).get('/api/health').expect(200)).body as HealthResponse).ops;
  }

  const listings = (paths: Array<{ path: string; riotToken: string | null }>, token: string): number =>
    paths.filter((seen) => seen.path.includes('/ids?') && seen.riotToken === token).length;

  it('pauses the riot queue, then resumes it once the key file holds a working key', async () => {
    // A player no other test has synced. The expired key still resolves the Riot ID,
    // so the search starts a sync; every match-v5 and status request refuses it.
    await fake.respondNext({
      path: '/riot/account/v1/accounts/by-riot-id/Chave/BR1',
      times: 1,
      response: { status: 200, body: { puuid: 'rejected-key-player', gameName: 'Chave', tagLine: 'BR1' } },
    });
    await fake.respondNext({ path: '/lol/*', riotToken: 'RGAPI-expired', times: 10_000, response: loadCanned('key-rejected') });
    await request(app.http).get('/api/profiles/br/Chave/BR1').expect(200);

    const deadline = Date.now() + 10_000;
    while ((await ops()).riotKey !== 'rejected' && Date.now() < deadline) await sleep(25);
    await sleep(PROBE_INTERVAL_MS * 4);

    const rejected = await ops();
    expect(rejected.riotKey).toBe('rejected');
    expect(rejected.queues.riot.paused).toBe(true);
    expect(rejected.queues.riot.depth).toBeGreaterThan(0);
    const whileRejected = await fake.requests();
    // Each listing tried once, none retried; the probe kept asking with the key file's contents.
    expect(listings(whileRejected, 'RGAPI-expired')).toBeLessThanOrEqual(4);
    const probes = whileRejected.filter((seen) => seen.path === '/lol/status/v4/platform-data');
    expect(probes.length).toBeGreaterThanOrEqual(2);
    expect(probes.every((seen) => seen.riotToken === 'RGAPI-expired')).toBe(true);

    writeFileSync(keyFile, 'RGAPI-fresh\n');
    await app.drain(20_000);

    const restored = await ops();
    expect(restored.riotKey).toBe('ok');
    expect(restored.queues.riot).toEqual({ depth: 0, paused: false });
    // The current season, then the earlier ones the backfill lists after an empty primary.
    expect(listings(await fake.requests(), 'RGAPI-fresh')).toBe(8);
    const profile = (await request(app.http).get('/api/profiles/br/Chave/BR1').expect(200)).body as ProfileResponse;
    expect(profile.syncState).toBe('no-arena-games');
    expect(await app.queue(QUEUES.riot).getJobCounts('failed')).toEqual({ failed: 0 });
  });
});

describe('a missing key', () => {
  const PROBE_INTERVAL_MS = 200;
  let fake: FakeUpstream;
  let app: TestApp;
  let keyDir: string;
  let keyFile: string;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    keyDir = mkdtempSync(join(tmpdir(), 'arena-key-'));
    keyFile = join(keyDir, 'riot.key');
    // Emptied mid-paste, say: no key in the file and none in the environment.
    writeFileSync(keyFile, '');
    app = await startApp({
      worker: true,
      env: {
        RIOT_API_BASE_AMERICAS: fake.url,
        RIOT_API_BASE_BR1: fake.url,
        RIOT_KEY_FILE: keyFile,
        RIOT_KEY_PROBE_INTERVAL_MS: String(PROBE_INTERVAL_MS),
        RIOT_RATE_PER_SECOND: '1000',
        RIOT_RATE_PER_TWO_MINUTES: '100000',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await fake.close();
    rmSync(keyDir, { recursive: true, force: true });
  });

  async function ops(): Promise<OpsHealth> {
    return ((await request(app.http).get('/api/health').expect(200)).body as HealthResponse).ops;
  }

  it('pauses the riot queue like a rejected key, spends no attempt, and resumes once the file holds a key', async () => {
    await fake.respondNext({
      path: '/riot/account/v1/accounts/by-riot-id/Vazia/BR1',
      response: { status: 200, body: { puuid: 'missing-key-player', gameName: 'Vazia', tagLine: 'BR1' } },
    });
    // The page view waits on its lookup while the key is missing.
    const view = request(app.http).get('/api/profiles/br/Vazia/BR1');
    const viewed = view.then((response) => response);

    const deadline = Date.now() + 5_000;
    while ((await ops()).riotKey !== 'rejected' && Date.now() < deadline) await sleep(25);
    const rejected = await ops();
    expect(rejected.riotKey).toBe('rejected');
    expect(rejected.queues.riot.paused).toBe(true);
    expect(await fake.requests()).toEqual([]);

    writeFileSync(keyFile, 'RGAPI-fresh\n');

    expect((await viewed).status).toBe(200);
    await app.drain(20_000);
    expect((await ops()).riotKey).toBe('ok');
    expect(await app.queue(QUEUES.riot).getJobCounts('failed')).toEqual({ failed: 0 });
    const profile = (await request(app.http).get('/api/profiles/br/Vazia/BR1').expect(200)).body as ProfileResponse;
    expect(profile.syncState).toBe('no-arena-games');
  });
});
