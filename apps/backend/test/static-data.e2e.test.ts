import { DEFAULT_FIXTURES_DIR, loadFixtures, startFakeUpstream, type FakeUpstream } from '@arena/fake-upstream';
import type { HealthResponse } from '@arena/shared';
import { Pool } from 'pg';
import request from 'supertest';
import { QUEUES } from '../src/core/queues';
import { scratchDatabase, startApp, type ScratchDatabase, type TestApp } from './harness';

// The static data refresh against the fake serving the committed Data Dragon and
// Community Dragon fixtures: run it, read health, run it again.

const fixtures = loadFixtures(DEFAULT_FIXTURES_DIR);
const versions = fixtures.find((fixture) => fixture.path === '/api/versions.json')!.body as string[];
const latest = versions[0]!;
const championData = fixtures.find((fixture) => fixture.path === `/cdn/${latest}/data/en_US/champion.json`)!
  .body as { data: Record<string, unknown> };
const championCount = Object.keys(championData.data).length;
const augmentCount = (fixtures.find((fixture) => fixture.path === '/latest/cdragon/arena/en_us.json')!.body as {
  augments: unknown[];
}).augments.length;

jest.setTimeout(30_000);

describe('static data refresh', () => {
  let fake: FakeUpstream;
  let db: ScratchDatabase;
  let app: TestApp;
  let pg: Pool;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    db = await scratchDatabase();
    app = await startApp({ worker: true, env: { DATABASE_URL: db.url, DDRAGON_BASE: fake.url, CDRAGON_BASE: fake.url } });
    pg = new Pool({ connectionString: db.url });
  });

  afterAll(async () => {
    await pg.end();
    await app.close();
    await db.drop();
    await fake.close();
  });

  async function health(): Promise<HealthResponse> {
    return (await request(app.http).get('/api/health').expect(200)).body as HealthResponse;
  }

  async function refresh(): Promise<void> {
    await app.queue(QUEUES.maintenance).add('static-data-refresh', {});
    await app.drain();
  }

  async function counts(): Promise<{ champions: number; augments: number }> {
    const result = await pg.query<{ champions: number; augments: number }>(
      'select (select count(*)::int from champions) as champions, (select count(*)::int from augments) as augments',
    );
    return result.rows[0]!;
  }

  it('runs daily on the maintenance queue', async () => {
    const schedulers = await app.queue(QUEUES.maintenance).getJobSchedulers();

    expect(schedulers).toContainEqual(expect.objectContaining({ key: 'static-data-refresh', pattern: '0 6 * * *', tz: 'UTC' }));
  });

  it('reports no refresh on health before the first one', async () => {
    expect((await health()).staticData).toEqual({ lastRefreshAt: null, patch: null });
  });

  it('caches the latest patch’s champions and the augment list, and reports the run on health', async () => {
    const before = Date.now();
    await refresh();

    const { staticData } = await health();
    expect(staticData.patch).toBe(latest);
    expect(Date.parse(staticData.lastRefreshAt!)).toBeGreaterThanOrEqual(before - 1000);
    expect(await counts()).toEqual({ champions: championCount, augments: augmentCount });
  });

  it('is idempotent: a second run stores the same rows and moves the last refresh time', async () => {
    const first = (await health()).staticData.lastRefreshAt!;
    await refresh();

    expect(await counts()).toEqual({ champions: championCount, augments: augmentCount });
    const { staticData } = await health();
    expect(staticData.patch).toBe(latest);
    expect(Date.parse(staticData.lastRefreshAt!)).toBeGreaterThan(Date.parse(first));
  });

  it('keeps earlier patches when a new one is released', async () => {
    const next = '99.1.1';
    await fake.respondNext({ path: '/api/versions.json', response: { status: 200, body: [next, ...versions] } });
    await fake.respondNext({
      path: `/cdn/${next}/data/en_US/champion.json`,
      response: { status: 200, body: { ...championData, version: next } },
    });
    await refresh();

    expect((await health()).staticData.patch).toBe(next);
    const patches = await pg.query<{ patch: string; n: number }>(
      'select patch, count(*)::int as n from champions group by patch order by patch',
    );
    expect(patches.rows).toEqual([
      { patch: latest, n: championCount },
      { patch: next, n: championCount },
    ]);
  });

  it('fails the job and leaves the last refresh alone when Data Dragon does not answer', async () => {
    const before = (await health()).staticData;
    await fake.respondNext({ path: '/api/versions.json', response: { status: 503 } });
    await app.queue(QUEUES.maintenance).add('static-data-refresh', {}, { attempts: 1 });
    await app.drain();

    expect((await health()).staticData).toEqual(before);
    const failed = await app.queue(QUEUES.maintenance).getFailed();
    expect(failed.map((job) => job.failedReason)).toEqual([expect.stringContaining('/api/versions.json: 503')]);
  });
});
