import { Queue, QueueEvents } from 'bullmq';
import { QUEUES } from '../../core/queues';

export const STATIC_DATA_REFRESH_JOB = 'static-data-refresh';

/**
 * Adds one static data refresh to the maintenance queue of the stack on
 * `redisUrl` and `prefix` and waits until its worker has run it. For the smoke
 * launcher, whose run ends long before the daily one.
 */
export async function refreshStaticDataNow(redisUrl: string, prefix: string, timeoutMs = 30_000): Promise<void> {
  const connection = { url: redisUrl };
  const queue = new Queue(QUEUES.maintenance, { connection, prefix });
  const events = new QueueEvents(QUEUES.maintenance, { connection, prefix });
  try {
    await events.waitUntilReady();
    const job = await queue.add(STATIC_DATA_REFRESH_JOB, {}, { removeOnComplete: true });
    await job.waitUntilFinished(events, timeoutMs);
  } finally {
    await Promise.all([queue.close(), events.close()]);
  }
}
