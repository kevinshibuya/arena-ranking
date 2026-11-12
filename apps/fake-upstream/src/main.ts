import { startFakeUpstream } from './server';

// Standalone entrypoint: `PORT=9000 pnpm --filter @arena/fake-upstream start`.
// HOST=0.0.0.0 in a container (deploy/stack/test/compose.smoke.yml).
async function main(): Promise<void> {
  const fake = await startFakeUpstream({ port: Number(process.env.PORT ?? 0), host: process.env.HOST });
  console.log(JSON.stringify({ level: 30, time: Date.now(), msg: 'fake upstream listening', url: fake.url }));
  const stop = (): void => void fake.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

void main();
