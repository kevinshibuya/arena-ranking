import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Job, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../core/config';
import { DATABASE, type Database } from '../core/database';
import { JobHandler, QUEUES, type QueueJobHandler, type QueueName } from '../core/queues';
import { REDIS } from '../core/redis';
import { RiotKeyGuard } from '../modules/ops/riot-key/riot-key-guard';
import { RiotKeyMissingError } from '../modules/riot-client/riot-client';
import { RiotKeyRejectedError, RiotRateLimitedError } from '../modules/riot-client/riot-refusals';
import { RiotRateLimit } from './riot-rate-limit';

/**
 * A sync job that finds its share of the key spent holds the `riot` queue at most
 * this long, so a lookup that arrives meanwhile is fetched within a second.
 */
const CAPPED_POLL_MS = 1000;

/**
 * One BullMQ worker per queue, dispatching each job by name to the provider
 * marked `@JobHandler` for it. Lives only in the worker process (and in tests
 * that ask for it), so the API never runs a job.
 */
@Injectable()
export class QueueWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueWorkers.name);
  private readonly workers: Worker[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly riotKey: RiotKeyGuard,
  ) {}

  private handlers(): Map<QueueName, Map<string, QueueJobHandler>> {
    const byQueue = new Map<QueueName, Map<string, QueueJobHandler>>();
    for (const wrapper of this.discovery.getProviders({ metadataKey: JobHandler.KEY })) {
      const { queue, name } = this.discovery.getMetadataByDecorator(JobHandler, wrapper)!;
      const forQueue = byQueue.get(queue) ?? new Map<string, QueueJobHandler>();
      if (forQueue.has(name)) throw new Error(`Two handlers for job ${name} on queue ${queue}`);
      forQueue.set(name, wrapper.instance as QueueJobHandler);
      byQueue.set(queue, forQueue);
    }
    return byQueue;
  }

  async onApplicationBootstrap(): Promise<void> {
    const handlers = this.handlers();
    const connection = { url: this.config.redisUrl };
    const prefix = this.config.redisPrefix;

    // Both windows of the Riot key. A job that finds them full goes back to
    // wait, attempts untouched. A tenth of each is kept for the unprioritised
    // lookup a search waits on: a sync job finding its share spent holds the
    // queue for a second at most, a lookup finding the whole window spent until a slot frees.
    const riotRate = new RiotRateLimit(this.redis, [
      { max: this.config.riot.ratePerSecond, durationMs: 1000 },
      { max: this.config.riot.ratePerTwoMinutes, durationMs: 120_000 },
    ]);

    for (const queue of Object.values(QUEUES)) {
      const forQueue = handlers.get(queue) ?? new Map<string, QueueJobHandler>();
      const handlerFor = (job: Job): QueueJobHandler => {
        const handler = forQueue.get(job.name);
        if (!handler) throw new Error(`No handler for job ${job.name} on queue ${queue}`);
        return handler;
      };
      const dispatch = (job: Job): Promise<unknown> => handlerFor(job).handle(job);
      const worker: Worker =
        queue === QUEUES.riot
          ? new Worker(
              queue,
              async (job: Job) => {
                const capped = (job.opts.priority ?? 0) > 0;
                const wait = await riotRate.acquire(capped ? 'capped' : 'full');
                if (wait > 0) {
                  await worker.rateLimit(capped ? Math.min(wait, CAPPED_POLL_MS) : wait);
                  throw Worker.RateLimitError();
                }
                const handler = handlerFor(job);
                try {
                  return await handler.handle(job);
                } catch (error) {
                  // Riot said 429: the whole queue sits out Retry-After, this job included.
                  if (error instanceof RiotRateLimitedError) {
                    this.logger.warn({ job: job.name, jobId: job.id, retryAfterMs: error.retryAfterMs }, error.message);
                    await worker.rateLimit(error.retryAfterMs);
                    throw Worker.RateLimitError();
                  }
                  // Riot rejected the key, or there is none: the queue pauses and this job waits with the rest.
                  if (error instanceof RiotKeyRejectedError || error instanceof RiotKeyMissingError) {
                    this.logger.warn({ job: job.name, jobId: job.id }, error.message);
                    await this.riotKey.reject();
                    throw Worker.RateLimitError();
                  }
                  // The last attempt: the handler settles what it owed before the job fails.
                  if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await handler.failed?.(job, error);
                  throw error;
                }
              },
              { connection, prefix, concurrency: 10, limiter: { max: this.config.riot.ratePerSecond, duration: 1000 } },
            )
          : new Worker(queue, dispatch, { connection, prefix, concurrency: 1 });
      worker.on('failed', (job, error) => {
        this.logger.warn({ queue, job: job?.name, jobId: job?.id, err: error }, 'job failed');
      });
      worker.on('error', (error) => this.logger.error({ queue, err: error }, 'worker error'));
      this.workers.push(worker);
    }

    await Promise.all(this.workers.map((worker) => worker.waitUntilReady()));
    await this.db.execute(sql`select 1`);
    await this.redis.ping();
    this.logger.log('worker ready');
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }
}
