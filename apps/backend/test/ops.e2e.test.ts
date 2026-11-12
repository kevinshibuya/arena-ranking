import { startFakeUpstream, type FakeUpstream } from '@arena/fake-upstream';
import type { HealthResponse, OpsHealth } from '@arena/shared';
import request from 'supertest';
import { QUEUES } from '../src/core/queues';
import { startApp, type TestApp } from './harness';

// What the operator sees: the ops section of health and the queue dashboard.

jest.setTimeout(30_000);

const riotEnv = (fake: FakeUpstream): Record<string, string> => ({
  RIOT_API_BASE_AMERICAS: fake.url,
  RIOT_API_BASE_BR1: fake.url,
  RIOT_API_KEY: 'RGAPI-test',
  RIOT_RATE_PER_SECOND: '1000',
  RIOT_RATE_PER_TWO_MINUTES: '100000',
});

async function ops(app: TestApp): Promise<OpsHealth> {
  const response = await request(app.http).get('/api/health').expect(200);
  return (response.body as HealthResponse).ops;
}

describe('ops health', () => {
  let fake: FakeUpstream;
  let app: TestApp;

  beforeAll(async () => {
    fake = await startFakeUpstream({ port: 0 });
    app = await startApp({ worker: true, env: riotEnv(fake) });
  });

  afterAll(async () => {
    await app.close();
    await fake.close();
  });

  it('starts with an accepted key, no budget seen and empty, running queues', async () => {
    expect(await ops(app)).toEqual({
      riotKey: 'ok',
      appBudget: null,
      queues: { riot: { depth: 0, paused: false }, maintenance: { depth: 0, paused: false } },
    });
  });

  it('reports queue depths as jobs are enqueued and drained', async () => {
    const riot = app.queue(QUEUES.riot);
    await riot.pause();
    for (let i = 0; i < 3; i += 1) await riot.add('account-by-riot-id', { region: 'br', gameName: 'Ninguem', tagLine: '0000' });

    expect((await ops(app)).queues.riot).toEqual({ depth: 3, paused: true });

    await riot.resume();
    await app.drain();

    expect((await ops(app)).queues.riot).toEqual({ depth: 0, paused: false });
  });

  it('reports the app budget left after a response that carries the rate-limit headers', async () => {
    // A Riot ID that does not resolve, so no sync follows and overwrites it.
    await fake.respondNext({
      path: '/riot/account/v1/accounts/by-riot-id/Ninguem/0000',
      response: {
        status: 404,
        headers: { 'x-app-rate-limit': '20:1,100:120', 'x-app-rate-limit-count': '5:1,40:120' },
        body: { status: { message: 'Data not found', status_code: 404 } },
      },
    });
    const before = Date.now();

    await request(app.http).get('/api/profiles/br/Ninguem/0000').expect(404);

    const { appBudget } = await ops(app);
    expect(appBudget?.windows).toEqual([
      { seconds: 1, limit: 20, remaining: 15 },
      { seconds: 120, limit: 100, remaining: 60 },
    ]);
    expect(Date.parse(appBudget!.observedAt)).toBeGreaterThanOrEqual(before);
  });
});

describe('queue dashboard', () => {
  const DASHBOARD = '/api/ops/queues';

  describe('with credentials configured', () => {
    let app: TestApp;

    beforeAll(async () => {
      app = await startApp({ env: { DASHBOARD_USER: 'kevin', DASHBOARD_PASS: 's3cret' } });
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers 401 without credentials or with wrong ones', async () => {
      const bare = await request(app.http).get(DASHBOARD).expect(401);
      expect(bare.headers['www-authenticate']).toMatch(/^Basic /);
      await request(app.http).get(DASHBOARD).auth('kevin', 'wrong').expect(401);
      await request(app.http).get(`${DASHBOARD}/api/queues`).expect(401);
    });

    it('renders the dashboard and lists both queues with them', async () => {
      const page = await request(app.http).get(DASHBOARD).auth('kevin', 's3cret').expect(200);
      expect(page.headers['content-type']).toMatch(/text\/html/);
      expect(page.text).toContain(`${DASHBOARD}/`);

      const queues = await request(app.http).get(`${DASHBOARD}/api/queues`).auth('kevin', 's3cret').expect(200);
      const names = (queues.body as { queues: Array<{ name: string }> }).queues.map((queue) => queue.name).sort();
      expect(names).toEqual([QUEUES.maintenance, QUEUES.riot]);
    });
  });

  it('is not mounted when no credentials are configured', async () => {
    const app = await startApp({ env: { DASHBOARD_USER: '', DASHBOARD_PASS: '' } });
    try {
      await request(app.http).get(DASHBOARD).expect(404);
      await request(app.http).get(DASHBOARD).auth('kevin', 's3cret').expect(404);
    } finally {
      await app.close();
    }
  });
});
