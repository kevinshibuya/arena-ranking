import { DEFAULT_FIXTURES_DIR, fixtureFile, loadCanned, matchPath, readFixture, type MatchLike } from './fixtures';
import { readManifest } from './manifest';
import { startFakeUpstream, type FakeUpstream } from './server';

// The admin endpoint, on the committed set.

const [primary] = readManifest(DEFAULT_FIXTURES_DIR).players.map((player) => player.puuid) as [string];
const accountPath = `/riot/account/v1/accounts/by-puuid/${primary}`;
const newest = readFixture(fixtureFile(DEFAULT_FIXTURES_DIR, 'riot-regional', matchPath('BR1_1000000129'))).body as MatchLike;

/** A recorded match moved `hours` later under a new id. */
function laterCopy(id: string, hours: number): MatchLike {
  const match = structuredClone(newest);
  match.metadata.matchId = id;
  match.info.gameCreation += hours * 3_600_000;
  return match;
}

describe('fake upstream admin endpoint', () => {
  let fake: FakeUpstream;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
  });

  afterEach(async () => {
    await fake.reset();
  });

  afterAll(async () => {
    await fake.close();
  });

  const get = (path: string): Promise<Response> => fetch(`${fake.url}${path}`);
  const newestTwo = async (): Promise<unknown> => (await get(`/lol/match/v5/matches/by-puuid/${primary}/ids?count=2`)).json();

  it('adds a match at runtime, served by id and in later listings', async () => {
    const added = laterCopy('BR1_1000000201', 1);

    const response = await fetch(`${fake.url}/__admin/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(added),
    });

    expect(response.status).toBe(201);
    expect(await (await get(matchPath('BR1_1000000201'))).json()).toEqual(added);
    expect(await newestTwo()).toEqual(['BR1_1000000201', 'BR1_9000000002']);
  });

  it('answers the next N requests to a path with a canned response, then the recorded one', async () => {
    const response = await fetch(`${fake.url}/__admin/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: accountPath, times: 2, response: loadCanned('rate-limited') }),
    });
    expect(response.status).toBe(201);

    for (let i = 0; i < 2; i++) {
      const canned = await get(accountPath);
      expect(canned.status).toBe(429);
      expect(canned.headers.get('retry-after')).toBe('7');
    }
    expect((await get(accountPath)).status).toBe(200);
  });

  it('matches a path prefix ending in *', async () => {
    await fake.respondNext({ path: '/lol/match/v5/*', response: loadCanned('key-rejected') });

    expect((await get(matchPath('BR1_1000000129'))).status).toBe(403);
    expect((await get(matchPath('BR1_1000000129'))).status).toBe(200);
  });

  it('answers only requests carrying a given Riot token when the rule names one', async () => {
    await fake.respondNext({ path: '/*', riotToken: 'RGAPI-expired', times: 2, response: loadCanned('key-rejected') });
    const withToken = (token: string): Promise<Response> => fetch(`${fake.url}${accountPath}`, { headers: { 'x-riot-token': token } });

    expect((await withToken('RGAPI-fresh')).status).toBe(200);
    expect((await withToken('RGAPI-expired')).status).toBe(403);
    expect((await withToken('RGAPI-fresh')).status).toBe(200);
    expect((await withToken('RGAPI-expired')).status).toBe(403);
    expect((await withToken('RGAPI-expired')).status).toBe(200);
  });

  it('logs every upstream request with the Riot token it carried', async () => {
    await fetch(`${fake.url}${accountPath}`, { headers: { 'x-riot-token': 'RGAPI-one' } });
    await get('/nowhere?x=1');

    expect(await fake.requests()).toEqual([
      { method: 'GET', path: accountPath, riotToken: 'RGAPI-one', at: expect.any(Number) },
      { method: 'GET', path: '/nowhere?x=1', riotToken: null, at: expect.any(Number) },
    ]);
  });

  it('resets runtime matches, canned responses and the request log', async () => {
    await fake.addMatch(laterCopy('BR1_1000000202', 2));
    await fake.respondNext({ path: accountPath, response: loadCanned('key-rejected') });

    await fake.reset();

    expect(await newestTwo()).toEqual(['BR1_9000000002', 'BR1_9000000001']);
    expect((await get(matchPath('BR1_1000000202'))).status).toBe(404);
    expect((await get(accountPath)).status).toBe(200);
    expect(await fake.requests()).toHaveLength(3);
  });

  it('refuses a malformed admin request', async () => {
    const response = await fetch(`${fake.url}/__admin/responses`, { method: 'POST', body: '{"times":1}' });

    expect(response.status).toBe(400);
  });
});
