import { loadConfig } from '../core/config';
import { workerHealth } from './worker-health';

// The worker container's healthcheck: `node dist/worker/worker-health.cli.js`
// exits 0 while a worker consumes every queue, 1 otherwise.
async function main(): Promise<void> {
  const health = await workerHealth(loadConfig(process.env));
  console.log(JSON.stringify(health));
  process.exit(health.healthy ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
