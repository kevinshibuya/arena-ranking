import type { FormatsResponse, SeasonsResponse } from '@arena/shared';
import request from 'supertest';
import { SEASON_SEED } from '../src/modules/seasons/season-seed';
import { startApp, type TestApp } from './harness';

describe('seasons and formats endpoints', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the seeded 2026 seasons in order, the current one marked', async () => {
    const response = await request(app.http).get('/api/seasons').expect(200);
    const body = response.body as SeasonsResponse;

    expect(body.seasons).toEqual([
      { id: expect.any(Number), name: '2026 Season 1', firstPatch: '16.1', startsAt: '2026-01-08T00:00:00.000Z', current: false },
      { id: expect.any(Number), name: '2026 Season 2', firstPatch: '16.9', startsAt: '2026-04-29T00:00:00.000Z', current: false },
      // Season 3 began on 2026-08-26, and the seed holds no later season.
      { id: expect.any(Number), name: '2026 Season 3', firstPatch: '16.17', startsAt: '2026-08-26T00:00:00.000Z', current: true },
    ]);
  });

  it('seeds the table from the shared seed constant', async () => {
    const response = await request(app.http).get('/api/seasons').expect(200);
    const body = response.body as SeasonsResponse;

    expect(body.seasons.map(({ name, firstPatch, startsAt }) => ({ name, firstPatch, startsAt }))).toEqual(
      SEASON_SEED.map(({ name, firstPatch, startsAt }) => ({ name, firstPatch, startsAt: new Date(startsAt).toISOString() })),
    );
  });

  it('lists the known formats with 6x3 the labelled default', async () => {
    const response = await request(app.http).get('/api/formats').expect(200);
    const body = response.body as FormatsResponse;

    expect(body.formats).toEqual([
      { id: '6x3', label: '6 teams of 3', ladder: true, default: true },
      { id: '8x2', label: '8 teams of 2', ladder: true, default: false },
      { id: 'irregular', label: 'Irregular lobbies', ladder: false, default: false },
    ]);
  });
});
