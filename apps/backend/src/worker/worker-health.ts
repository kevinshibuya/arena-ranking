import { Queue } from 'bullmq';
import type { Config } from '../core/config';
import { QUEUES, type QueueName } from '../core/queues';

export interface WorkerHealth {
  healthy: boolean;
  /** Workers connected to each queue under the configured Redis prefix. */
  workers: Record<QueueName, number>;
}

/**
 * Whether a worker consumes every queue, from the workers BullMQ sees connected
 * to Redis. The worker process serves no HTTP, so its container healthcheck asks
 * this instead (`worker-health.cli.ts`).
 */
export async function workerHealth(config: Config): Promise<WorkerHealth> {
  const names = Object.values(QUEUES);
  const queues = names.map((name) => new Queue(name, { connection: { url: config.redisUrl }, prefix: config.redisPrefix }));
  try {
    const counts = await Promise.all(queues.map((queue) => queue.getWorkersCount()));
    const workers = Object.fromEntries(names.map((name, i) => [name, counts[i]!])) as Record<QueueName, number>;
    return { healthy: counts.every((count) => count > 0), workers };
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
  }
}
