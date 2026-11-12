import { Inject, Injectable, Module } from '@nestjs/common';
import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { DATABASE, type Database } from '../src/core/database';
import { JobHandler, QUEUES, type QueueJobHandler } from '../src/core/queues';
import { startApp, type TestApp } from './harness';

@JobHandler({ queue: QUEUES.maintenance, name: 'test-echo' })
@Injectable()
class EchoHandler implements QueueJobHandler<{ word: string }, string> {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async handle(job: Job<{ word: string }>): Promise<string> {
    const result = await this.db.execute<{ n: number }>(sql`select 1 as n`);
    return `${job.data.word}:${result.rows[0]?.n}`;
  }
}

@Module({ providers: [EchoHandler] })
class EchoModule {}

describe('bootstrap', () => {
  describe('API', () => {
    let app: TestApp;

    beforeAll(async () => {
      app = await startApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers health through the aggregator', async () => {
      const response = await request(app.http).get('/api/health').expect(200);

      expect(response.body).toEqual({
        process: { status: 'ok', uptimeSeconds: expect.any(Number) },
        ops: expect.objectContaining({ riotKey: 'ok' }),
        rating: { lastReplayAt: null, nextReplayAt: expect.any(String) },
        staticData: { lastRefreshAt: null, patch: null },
      });
    });

    it('logs one JSON object per line, with the request id on request lines', async () => {
      const response = await request(app.http).get('/api/health').set('x-request-id', 'req-abc').expect(200);

      expect(response.headers['x-request-id']).toBe('req-abc');
      const lines = app.logLines();
      expect(lines.length).toBeGreaterThan(0);
      const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(parsed.some((entry) => entry.requestId === 'req-abc')).toBe(true);
    });

    it('gives a request without an id a fresh one', async () => {
      const response = await request(app.http).get('/api/health').expect(200);

      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('worker in-process', () => {
    let app: TestApp;

    beforeAll(async () => {
      app = await startApp({ worker: true, imports: [EchoModule] });
    });

    afterAll(async () => {
      await app.close();
    });

    it('runs a job handler against Postgres and Redis', async () => {
      const job = await app.queue(QUEUES.maintenance).add('test-echo', { word: 'hello' });
      await app.drain();

      expect(await job.getState()).toBe('completed');
      expect((await app.queue(QUEUES.maintenance).getJob(job.id!))?.returnvalue).toBe('hello:1');
    });

    it('fails a job no handler claims, naming it', async () => {
      const job = await app.queue(QUEUES.riot).add('nobody-handles-this', {});
      await app.drain();

      const failed = await app.queue(QUEUES.riot).getJob(job.id!);
      expect(failed?.failedReason).toContain('nobody-handles-this');
    });

    it('logs that the worker is ready', () => {
      const parsed = app.logLines().map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(parsed.some((entry) => entry.msg === 'worker ready')).toBe(true);
    });
  });
});
