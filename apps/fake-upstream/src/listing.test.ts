import { DEFAULT_FIXTURES_DIR, readFixture, fixtureFile, matchPath, type MatchLike } from './fixtures';
import { readManifest } from './manifest';
import { startFakeUpstream, type FakeUpstream } from './server';

// The fake builds match-id listings from the matches it holds rather than
// replaying recorded listings, so windowed and incremental queries work. Run on
// the committed set, recorded from Player0001#ANON's history on 2026-10-09.

const [primary, teammate] = readManifest(DEFAULT_FIXTURES_DIR).players.map((player) => player.puuid) as [string, string];

// Player0001's ten 8x2 games of 2026-05-12 in queue 1700, newest first. Player0002 played
// the first three and the last.
const may12 = [
  'BR1_1000000010',
  'BR1_1000000009',
  'BR1_1000000008',
  'BR1_1000000007',
  'BR1_1000000006',
  'BR1_1000000005',
  'BR1_1000000004',
  'BR1_1000000003',
  'BR1_1000000002',
  'BR1_1000000001',
];
// 2026 Season 2 began on 2026-04-29 and Season 3 on 2026-08-26.
const season2 = Date.UTC(2026, 3, 29) / 1000;
const season3 = Date.UTC(2026, 7, 26) / 1000;

describe('fake upstream match listing', () => {
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

  async function list(puuid: string, query = ''): Promise<string[]> {
    const response = await fetch(`${fake.url}/lol/match/v5/matches/by-puuid/${puuid}/ids${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as string[];
  }

  it("lists the player's matches newest first, 20 by default like Riot, ties by id", async () => {
    const ids = await list(primary);

    expect(ids).toHaveLength(20);
    // The derived 8x2 and irregular variants keep the time of the match they come from.
    expect(ids.slice(0, 4)).toEqual(['BR1_9000000002', 'BR1_9000000001', 'BR1_1000000129', 'BR1_1000000128']);
  });

  it('filters by participant PUUID', async () => {
    expect(await list(teammate, '?queue=1700')).toEqual(['BR1_1000000010', 'BR1_1000000009', 'BR1_1000000008', 'BR1_1000000001']);
  });

  it('filters by queue', async () => {
    expect(await list(primary, '?queue=1700')).toEqual(may12);
    expect(await list(primary, '?queue=1710')).toEqual([]);
  });

  it('filters by start and end time in epoch seconds, both inclusive, on gameCreation', async () => {
    // BR1_1000000005 was created at 1778603322.052 and BR1_1000000008 at 1778607660.321.
    expect(await list(primary, '?startTime=1778603322&endTime=1778607661')).toEqual(may12.slice(2, 6));
    expect(await list(primary, '?startTime=1778603322&endTime=1778607660')).toEqual(may12.slice(3, 6));
    expect(await list(primary, '?startTime=1778603323&endTime=1778607661')).toEqual(may12.slice(2, 5));
  });

  it('pages with start and count', async () => {
    expect(await list(primary, '?queue=1700&start=0&count=3')).toEqual(may12.slice(0, 3));
    expect(await list(primary, '?queue=1700&start=3&count=3')).toEqual(may12.slice(3, 6));
    expect(await list(primary, '?queue=1700&start=9&count=3')).toEqual(may12.slice(9));
    expect(await list(primary, '?queue=1700&start=10&count=3')).toEqual([]);
  });

  it('combines every filter over one season', async () => {
    // Player0001's 1740 games of Season 2, on its last patch, 16.16.
    const ids = await list(primary, `?queue=1740&startTime=${season2}&endTime=${season3 - 1}&start=0&count=100`);

    expect(ids).toEqual([
      'BR1_1000000020',
      'BR1_1000000019',
      'BR1_1000000018',
      'BR1_1000000017',
      'BR1_1000000016',
      'BR1_1000000015',
      'BR1_1000000014',
      'BR1_1000000013',
      'BR1_1000000012',
      'BR1_1000000011',
    ]);
    expect(await list(primary, `?queue=1740&startTime=${season2}&endTime=${season3 - 1}&start=8&count=5`)).toEqual(ids.slice(8));
  });

  it('lists a match added through the admin endpoint in later listings', async () => {
    const recorded = readFixture(fixtureFile(DEFAULT_FIXTURES_DIR, 'riot-regional', matchPath('BR1_1000000129'))).body as MatchLike;
    const added = structuredClone(recorded);
    added.metadata.matchId = 'BR1_1000000200';
    added.info.gameCreation += 3_600_000;

    expect(await list(primary, '?queue=1750&count=2')).toEqual(['BR1_9000000002', 'BR1_9000000001']);
    await fake.addMatch(added);

    expect(await list(primary, '?queue=1750&count=2')).toEqual(['BR1_1000000200', 'BR1_9000000002']);
    expect(await list(primary, `?startTime=${Math.floor(added.info.gameCreation / 1000)}`)).toEqual(['BR1_1000000200']);
  });

  it('refuses a count above 100 with 400, like Riot', async () => {
    const response = await fetch(`${fake.url}/lol/match/v5/matches/by-puuid/${primary}/ids?count=101`);
    expect(response.status).toBe(400);
  });

  it('answers an empty list for a player with no matches', async () => {
    expect(await list('nobody')).toEqual([]);
  });

  it('carries rate-limit headers like a Riot response', async () => {
    const response = await fetch(`${fake.url}/lol/match/v5/matches/by-puuid/${primary}/ids`);
    expect(response.headers.get('x-app-rate-limit')).toBe('20:1,100:120');
    expect(response.headers.get('x-method-rate-limit')).toBe('2000:10');
  });
});
