import { Queue, QueueEvents } from 'bullmq';
import { loadConfig } from '../../core/config';
import { QUEUES } from '../../core/queues';
import { REPLAY_JOB, type ReplaySummary } from './replay-job';

// `pnpm replay`: enqueues a rating replay on the maintenance queue and waits for
// a worker to finish it. Uses REDIS_URL and REDIS_PREFIX as the worker does.
const TIMEOUT_MS = 30 * 60_000;

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const options = { connection: { url: config.redisUrl }, prefix: config.redisPrefix };
  const queue = new Queue(QUEUES.maintenance, options);
  const events = new QueueEvents(QUEUES.maintenance, options);
  try {
    await events.waitUntilReady();
    const job = await queue.add(REPLAY_JOB, {});
    console.log(`replay: job ${job.id} enqueued; waiting for a worker`);
    const summary = (await job.waitUntilFinished(events, TIMEOUT_MS)) as ReplaySummary;
    console.log(
      `replay: run ${summary.runId} complete: ${summary.matches} matches, ${summary.ratings} ratings, ${summary.historyPoints} history points`,
    );
  } finally {
    await events.close();
    await queue.close();
  }
}

main().catch((error: unknown) => {
  console.error('replay:', error instanceof Error ? error.message : error);
  process.exit(1);
});
