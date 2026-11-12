import { workerHealth } from '../src/worker/worker-health';
import { startApp, type TestApp } from './harness';

// The worker container's healthcheck: healthy while a worker consumes every queue
// under the stack's Redis prefix.
describe('worker health', () => {
  let app: TestApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('is unhealthy while no worker consumes the queues', async () => {
    app = await startApp();

    expect(await workerHealth(app.config)).toEqual({ healthy: false, workers: { riot: 0, maintenance: 0 } });
  });

  it('is healthy once a worker consumes every queue', async () => {
    app = await startApp({ worker: true });

    expect(await workerHealth(app.config)).toEqual({ healthy: true, workers: { riot: 1, maintenance: 1 } });
  });
});
