import { setTimeout as sleep } from 'node:timers/promises';
import { buildMatch, DEFAULT_FIXTURES_DIR, readManifest, startFakeUpstream, type FakeUpstream } from '@arena/fake-upstream';
import type { ProfileResponse, SeasonsResponse } from '@arena/shared';
import request from 'supertest';
import { QUEUES } from '../src/core/queues';
import { Clock } from '../src/modules/sync/clock';
import { scratchDatabase, startApp, type ScratchDatabase, type TestApp } from './harness';

// Backfill and the sweep, over the recorded player. "Now" is a clock the test
// sets, so the sweep's look-back lands on the dated fixtures.

const manifest = readManifest(DEFAULT_FIXTURES_DIR);
const [primary] = manifest.players;

/** An hour after the recorded player's newest match ended (2026-10-08T21:38Z). */
const T0 = Date.parse('2026-10-08T23:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const riotEnv = (fake: FakeUpstream): Record<string, string> => ({
  RIOT_API_BASE_AMERICAS: fake.url,
  RIOT_API_BASE_BR1: fake.url,
  RIOT_API_KEY: 'RGAPI-test',
  RIOT_RATE_PER_SECOND: '1000',
  RIOT_RATE_PER_TWO_MINUTES: '100000',
});

jest.setTimeout(120_000);

describe('backfill and sweep', () => {
  let fake: FakeUpstream;
  let db: ScratchDatabase;
  let app: TestApp;
  let now = T0;
  let seasonIds: Record<string, number>;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    db = await scratchDatabase();
    app = await startApp({
      worker: true,
      // Four hours back from the sweep at T0 + 2h reaches only the newest recorded lobbies.
      env: { DATABASE_URL: db.url, ...riotEnv(fake), SWEEP_LOOKBACK_HOURS: '4' },
      overrides: [[Clock, { now: () => new Date(now) }]],
    });
    const seasons = (await request(app.http).get('/api/seasons').expect(200)).body as SeasonsResponse;
    seasonIds = Object.fromEntries(seasons.seasons.map((season) => [season.name, season.id]));

    await request(app.http).get('/api/profiles/br/Player0001/ANON').expect(200);
    await app.drain(60_000);
  });

  afterAll(async () => {
    await app.close();
    await db.drop();
    await fake.close();
  });

  /** A 6x3 lobby: the recorded player and seventeen synthetic ones, placed fourth. */
  function lobbyWithPrimary(id: string, created: number) {
    const teams = Array.from({ length: 6 }, (_, team) =>
      Array.from({ length: 3 }, (_, seat) => (team === 3 && seat === 0 ? primary!.puuid : `${id}-${team}-${seat}`)),
    );
    return buildMatch({ id, created, teams, queue: 1750, version: '16.20.824.8524' });
  }

  /** Runs the sweep now, as its schedule would, and waits for every sync it starts. */
  async function sweep(): Promise<void> {
    await app.queue(QUEUES.maintenance).add('sweep', {});
    await app.drain(60_000);
  }

  /** Listings for the recorded player since the fake's request log was `from` long. */
  async function primaryListings(from: number): Promise<string[]> {
    return (await fake.requests())
      .slice(from)
      .map((seen) => seen.path)
      .filter((path) => path.startsWith(`/lol/match/v5/matches/by-puuid/${primary!.puuid}/ids?`));
  }

  async function profile(query: string): Promise<ProfileResponse> {
    return (await request(app.http).get(`/api/profiles/br/Player0001/ANON?${query}`).expect(200)).body as ProfileResponse;
  }

  describe('after a search', () => {
    it('ends complete, with the earlier seasons counted in their seasons and in all-time', async () => {
      const games = async (format: string, season: string) => (await profile(`format=${format}&season=${season}`)).totals.games;

      expect((await profile('')).syncState).toBe('complete');
      // Recorded: ten 6x3 games each in 1740 and 1750 on 16.16, ten 8x2 in 1700 on 16.9.
      // Derived: the last-patch game (Season 2, listed by the primary sync) and one two weeks into Season 1.
      expect(await games('6x3', String(seasonIds['2026 Season 2']))).toBe(21);
      expect(await games('8x2', String(seasonIds['2026 Season 2']))).toBe(10);
      expect(await games('6x3', String(seasonIds['2026 Season 1']))).toBe(1);
      expect(await games('6x3', String(seasonIds['2026 Season 3']))).toBe(primary!.currentSeasonMatchIds.length);
      expect(await games('6x3', 'all')).toBe(primary!.currentSeasonMatchIds.length + 22);
      // The derived 8x2 lobby of Season 3, and Season 2's ten.
      expect(await games('8x2', 'all')).toBe(11);
    });

    it('lists earlier seasons at priority 3, from the first season up to the current one', async () => {
      const jobs = await app.queue(QUEUES.riot).getJobs(['completed']);
      const backfill = jobs.filter((job) => job.name === 'match-ids-page' && (job.data as { endTime?: number }).endTime !== undefined);
      const firstSeason = Date.parse('2026-01-08T00:00:00Z');
      const currentSeason = Date.parse(manifest.currentSeason.startsAt);

      expect(backfill.map((job) => (job.data as { queueId: number }).queueId).sort()).toEqual([1700, 1710, 1740, 1750]);
      for (const job of backfill) {
        expect(job.opts.priority).toBe(3);
        expect(job.data).toMatchObject({ startTime: firstSeason, endTime: currentSeason - 1000 });
      }
    });
  });

  const current = () => profile(`format=6x3&season=${seasonIds['2026 Season 3']}`);

  describe('the sweep', () => {
    it('is registered to run every hour', async () => {
      const scheduler = await app.queue(QUEUES.maintenance).getJobScheduler('sweep');

      expect(scheduler).toMatchObject({ name: 'sweep', pattern: '0 * * * *' });
    });

    it('leaves a player synced within the sweep interval alone', async () => {
      await fake.addMatch(lobbyWithPrimary('BR1_9300000001', T0 + 10 * MINUTE));
      const from = (await fake.requests()).length;
      now = T0 + 30 * MINUTE;

      await sweep();

      expect(await primaryListings(from)).toEqual([]);
      expect((await current()).totals.games).toBe(primary!.currentSeasonMatchIds.length);
    });

    it('syncs a player with a match inside the look-back from their last sync, at priority 2', async () => {
      const from = (await fake.requests()).length;
      now = T0 + 2 * HOUR;

      await sweep();

      const listings = await primaryListings(from);
      // From the last sync, less an hour for a game in progress then.
      expect(listings).toHaveLength(4);
      for (const path of listings) expect(path).toContain(`startTime=${(T0 - HOUR) / 1000}&`);
      expect((await current()).totals.games).toBe(primary!.currentSeasonMatchIds.length + 1);
      const jobs = await app.queue(QUEUES.riot).getJobs(['completed']);
      const incremental = jobs.filter((job) => {
        const page = job.data as { puuid: string; startTime: number };
        return job.name === 'match-ids-page' && page.puuid === primary!.puuid && page.startTime === T0 - HOUR;
      });
      expect(incremental.map((job) => job.opts.priority)).toEqual([2, 2, 2, 2]);
    });

    it('passes over a player whose newest match is older than the look-back', async () => {
      await fake.addMatch(lobbyWithPrimary('BR1_9300000002', T0 + 3 * HOUR));
      const from = (await fake.requests()).length;
      now = T0 + 3 * 24 * HOUR;

      await sweep();

      expect(await primaryListings(from)).toEqual([]);
    });
  });

  it('leaves to a refresh what the sweep passed over, picked up at once at priority 1', async () => {
    const before = (await current()).totals.games;
    const from = (await fake.requests()).length;

    await request(app.http).post('/api/profiles/br/Player0001/ANON/refresh').expect(202);
    await app.drain();

    // From the sweep's sync at T0 + 2h, less the hour: the lobby at T0 + 3h is in.
    expect(await primaryListings(from)).toHaveLength(4);
    expect((await current()).totals.games).toBe(before + 1);
  });
});

describe('priority', () => {
  let fake: FakeUpstream;
  let db: ScratchDatabase;
  let app: TestApp;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    db = await scratchDatabase();
    // One request a second, so jobs run one at a time in the order the queue hands them out.
    app = await startApp({
      worker: true,
      env: { DATABASE_URL: db.url, ...riotEnv(fake), RIOT_RATE_PER_SECOND: '1', ARENA_QUEUE_IDS: '1700,1710' },
    });
  });

  afterAll(async () => {
    await app.close();
    await db.drop();
    await fake.close();
  });

  it('serves a priority-1 job enqueued behind waiting backfill jobs before them', async () => {
    const season2 = Date.parse('2026-06-01T12:00:00Z');
    await fake.addMatch(buildMatch({ id: 'BR1_9500000001', created: Date.parse('2026-09-15T12:00:00Z'), teams: [['prio'], ['prio-rival']] }));
    for (let i = 0; i < 3; i += 1) {
      await fake.addMatch(buildMatch({ id: `BR1_950000001${i}`, created: season2 + i * HOUR, teams: [['prio'], ['prio-rival']], version: '16.10.1.1' }));
    }
    await fake.respondNext({
      path: '/riot/account/v1/accounts/by-riot-id/Player%20prio/BR1',
      response: { status: 200, body: { puuid: 'prio', gameName: 'Player prio', tagLine: 'BR1' } },
    });
    const riot = app.queue(QUEUES.riot);
    await request(app.http).get('/api/profiles/br/Player%20prio/BR1').expect(200);

    // Hold the queue once the backfill is enqueued, and note what waits.
    const deadline = Date.now() + 30_000;
    while (!(await riot.getJobs(['prioritized'])).some((job) => job.opts.priority === 3)) {
      if (Date.now() > deadline) throw new Error('no backfill job waited');
      await sleep(25);
    }
    await riot.pause();
    while ((await riot.getActiveCount()) > 0) await sleep(25);
    const waiting = (await riot.getJobs(['prioritized'])).filter((job) => job.opts.priority === 3).map((job) => job.id!);
    expect(waiting.length).toBeGreaterThan(0);

    const enqueuedAt = Date.now();
    await request(app.http).post('/api/profiles/br/Player%20prio/BR1/refresh').expect(202);
    await riot.resume();
    await app.drain(60_000);

    const done = await riot.getJobs(['completed']);
    const refresh = done.filter((job) => job.opts.priority === 1 && job.timestamp >= enqueuedAt);
    const backfill = done.filter((job) => waiting.includes(job.id!));
    expect(refresh).toHaveLength(2);
    expect(backfill).toHaveLength(waiting.length);
    expect(Math.max(...refresh.map((job) => job.finishedOn!))).toBeLessThan(Math.min(...backfill.map((job) => job.finishedOn!)));
  });
});
