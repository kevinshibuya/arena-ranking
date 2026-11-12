import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppModule } from '../../src/app.module';
import { configureApi } from '../../src/bootstrap/configure';
import { CONFIG, loadConfig, type Config } from '../../src/core/config';
import { LOG_STREAM } from '../../src/core/logging';
import { QUEUES, queueDepth, type QueueName } from '../../src/core/queues';
import { deleteKeysWithPrefix } from '../../src/core/redis-keys';
import { createDatabase, dropDatabase, scratchDatabaseName, withDatabase } from '../../src/db/databases';
import { migrate } from '../../src/db/migrator';
import { WorkerModule } from '../../src/worker/worker.module';

// The e2e harness. global-setup gives the whole run a fresh, migrated database
// (DATABASE_URL); each app started here gets its own Redis key prefix, so runs
// in several worktrees never share a queue or a counter.

export interface ScratchDatabase {
  url: string;
  drop(): Promise<void>;
}

/**
 * A migrated database of its own, for a test file whose assertions would clash
 * with another file's writes to the run's shared one. Pass `url` as DATABASE_URL.
 */
export async function scratchDatabase(): Promise<ScratchDatabase> {
  const serverUrl = process.env.ARENA_TEST_SERVER_URL ?? loadConfig(process.env).databaseUrl;
  const name = scratchDatabaseName('test');
  await createDatabase(serverUrl, name);
  const url = withDatabase(serverUrl, name);
  await migrate(url);
  return { url, drop: () => dropDatabase(serverUrl, name) };
}

export interface TestAppOptions {
  /** Also run the worker's job handlers in this process. */
  worker?: boolean;
  /** Extra modules, for test-only providers. */
  imports?: ModuleMetadata['imports'];
  /** Environment overrides on top of process.env, e.g. upstream base URLs. */
  env?: Record<string, string>;
  /** Providers replaced by value, e.g. the sync clock: `[[Clock, { now: () => at }]]`. */
  overrides?: Array<[token: unknown, value: unknown]>;
}

export interface TestApp {
  app: INestApplication;
  /** Pass to supertest: `request(app.http).get('/api/health')`. */
  http: Server;
  config: Config;
  queue(name: QueueName): Queue;
  /** Resolves when no queue has a job waiting, delayed, prioritised or active; a schedule's next run not yet due does not count. */
  drain(timeoutMs?: number): Promise<void>;
  /** Every log line written since this app started, raw. */
  logLines(): string[];
  close(): Promise<void>;
}

class LineCapture extends Writable {
  readonly lines: string[] = [];
  private partial = '';

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
    const parts = (this.partial + chunk.toString('utf8')).split('\n');
    this.partial = parts.pop() ?? '';
    this.lines.push(...parts.filter((line) => line !== ''));
    done();
  }
}

// nestjs-pino builds its pino instance once per module registry, which Jest
// makes once per test file: every app a file starts logs to the stream the first
// one passed. So all apps share this one capture and each reads from where it
// started. For the same reason LOG_LEVEL is fixed by the file's first app.
const capture = new LineCapture();

export async function startApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config: Config = {
    ...loadConfig({ ...process.env, ...options.env }),
    redisPrefix: `arena-test-${randomBytes(4).toString('hex')}`,
  };
  const firstLine = capture.lines.length;
  let builder = Test.createTestingModule({
    imports: [AppModule, ...(options.worker ? [WorkerModule] : []), ...(options.imports ?? [])],
  })
    .overrideProvider(CONFIG)
    .useValue(config)
    .overrideProvider(LOG_STREAM)
    .useValue(capture);
  for (const [token, value] of options.overrides ?? []) builder = builder.overrideProvider(token).useValue(value);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApi(app);
  await app.init();

  const queue = (name: QueueName): Queue => app.get<Queue>(getQueueToken(name));

  return {
    app,
    http: app.getHttpServer() as Server,
    config,
    queue,
    async drain(timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const depths = await Promise.all(Object.values(QUEUES).map((name) => queueDepth(queue(name))));
        if (depths.every((depth) => depth === 0)) return;
        if (Date.now() > deadline) {
          throw new Error(`Queues did not drain: ${JSON.stringify(Object.fromEntries(Object.values(QUEUES).map((name, i) => [name, depths[i]])))}`);
        }
        await sleep(25);
      }
    },
    logLines: () => capture.lines.slice(firstLine),
    async close() {
      await app.close();
      await deleteKeysWithPrefix(config.redisUrl, config.redisPrefix);
    },
  };
}
