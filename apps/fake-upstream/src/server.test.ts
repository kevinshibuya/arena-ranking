import { mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_FIXTURES_DIR, fixtureFile, matchPath, readFixture, writeFixture } from './fixtures';
import { readManifest } from './manifest';
import { startFakeUpstream, type FakeUpstream } from './server';

const [primary] = readManifest(DEFAULT_FIXTURES_DIR).players.map((player) => player.puuid) as [string];

describe('fake upstream on the committed fixture set', () => {
  let fake: FakeUpstream;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
  });

  afterAll(async () => {
    await fake.close();
  });

  it('listens on a local port', () => {
    expect(fake.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('serves a recorded response with its status, headers and body', async () => {
    const response = await fetch(`${fake.url}/riot/account/v1/accounts/by-riot-id/Player0001/ANON`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-app-rate-limit')).toBe('100:120,20:1');
    expect(await response.json()).toEqual({ puuid: primary, gameName: 'Player0001', tagLine: 'ANON' });
  });

  it('matches a Riot ID regardless of case and encoding, as Riot does', async () => {
    expect((await fetch(`${fake.url}/riot/account/v1/accounts/by-riot-id/pLAYER0001/%41non`)).status).toBe(200);
    expect((await fetch(`${fake.url}/riot/account/v1/accounts/by-riot-id/player0002/anon`)).status).toBe(200);
  });

  it('serves a recorded match by id', async () => {
    const recorded = readFixture(fixtureFile(DEFAULT_FIXTURES_DIR, 'riot-regional', matchPath('BR1_1000000001')));

    const response = await fetch(`${fake.url}/lol/match/v5/matches/BR1_1000000001`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(recorded.body);
  });

  it('answers an unrecorded request with 404 naming the path', async () => {
    const response = await fetch(`${fake.url}/riot/account/v1/accounts/by-riot-id/Nobody/0000?x=1`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'unrecorded request',
      path: '/riot/account/v1/accounts/by-riot-id/Nobody/0000?x=1',
    });
  });

  it('answers 404 for the Riot ID that does not resolve', async () => {
    const response = await fetch(`${fake.url}/riot/account/v1/accounts/by-riot-id/Ninguem/0000`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      status: { message: 'Data not found - No results found for player with riot id Ninguem#0000', status_code: 404 },
    });
  });

  it('resolves the account with no Arena match, whose listing is empty', async () => {
    const account = (await (await fetch(`${fake.url}/riot/account/v1/accounts/by-riot-id/Sem%20Arena/BR1`)).json()) as {
      puuid: string;
    };
    const listing = await fetch(`${fake.url}/lol/match/v5/matches/by-puuid/${account.puuid}/ids`);

    expect(await listing.json()).toEqual([]);
  });
});

// The host-agnostic check runs on a scratch set, so it does not depend on what
// the committed Data Dragon fixtures hold.
describe('fake upstream in a container', () => {
  // A non-loopback address of this machine, standing in for the compose network.
  const external = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === 'IPv4' && !address.internal)?.address;

  it('listens on every interface when given host 0.0.0.0', async () => {
    const fake = await startFakeUpstream({ port: 0, host: '0.0.0.0' });
    try {
      const port = new URL(fake.url).port;
      const response = await fetch(`http://${external ?? '127.0.0.1'}:${port}/riot/account/v1/accounts/by-riot-id/Player0001/ANON`);
      expect(response.status).toBe(200);
    } finally {
      await fake.close();
    }
  });
});

describe('fake upstream across hosts', () => {
  let fake: FakeUpstream;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fake-upstream-'));
    writeFixture(dir, 'ddragon', '/api/versions.json', { status: 200, headers: {}, body: ['16.20.1'] });
    writeFixture(dir, 'riot-regional', '/riot/account/v1/accounts/by-puuid/p', { status: 200, headers: {}, body: { puuid: 'p' } });
    fake = await startFakeUpstream({ port: 0, fixturesDir: dir });
  });

  afterAll(async () => {
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves every host from one base URL', async () => {
    expect(await (await fetch(`${fake.url}/api/versions.json`)).json()).toEqual(['16.20.1']);
    expect(await (await fetch(`${fake.url}/riot/account/v1/accounts/by-puuid/p`)).json()).toEqual({ puuid: 'p' });
  });
});
