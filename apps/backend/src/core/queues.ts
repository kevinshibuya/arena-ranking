import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Job, Queue } from 'bullmq';
import { CONFIG, type Config } from './config';

/**
 * The two queues. `riot` carries every Riot-bound job and is rate limited to the
 * key; `maintenance` carries replay, static data and probes so Riot traffic
 * never starves them. Inject one with `@InjectQueue(QUEUES.riot)`.
 */
export const QUEUES = {
  riot: 'riot',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobHandlerOptions {
  queue: QueueName;
  /** The BullMQ job name this handler runs. One handler per queue and name. */
  name: string;
}

/**
 * Marks a provider as the handler for one job name on one queue. Register the
 * provider in its own domain module; the worker process discovers it and runs
 * it. The API process never runs handlers, it only enqueues.
 */
export const JobHandler = DiscoveryService.createDecorator<JobHandlerOptions>();

export interface QueueJobHandler<Data = unknown, Result = unknown> {
  handle(job: Job<Data, Result>): Promise<Result>;
  /**
   * Called by the `riot` worker when the job's last attempt failed with something
   * it does not wait out, before the job is marked failed.
   */
  failed?(job: Job<Data, Result>, error: unknown): Promise<void>;
}

/**
 * Jobs on a queue not finished yet: waiting, prioritised, delayed, active or
 * waiting on children. The next run of a repeatable job is a delayed job that
 * stands for a schedule, not work, so it counts only once it is due.
 */
export async function queueDepth(queue: Queue): Promise<number> {
  const counts = await queue.getJobCounts('wait', 'prioritized', 'delayed', 'active', 'waiting-children');
  const scheduled = counts.delayed ? (await queue.getDelayed()).filter((job) => job.repeatJobKey).length : 0;
  return Object.values(counts).reduce((sum, n) => sum + n, 0) - scheduled;
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: Config) => ({
        connection: { url: config.redisUrl },
        prefix: config.redisPrefix,
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.riot }, { name: QUEUES.maintenance }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
