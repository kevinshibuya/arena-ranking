// `pnpm smoke [-- <spec filter>]`: runs the Playwright specs in apps/web/smoke
// matching the filter against a fresh stack (scripts/smoke/launcher.ts). A spec
// runs `pnpm replay` against the stack with SMOKE_DATABASE_URL and SMOKE_REDIS_PREFIX.

import { launch, run, spawnCheck, web } from './smoke/launcher';

const filters = process.argv.slice(2).filter((arg) => arg !== '--');

launch({
  prepare: () => run('pnpm', ['exec', 'playwright', 'install', 'chromium'], web),
  run: ({ webUrl, env }) =>
    spawnCheck('pnpm', ['exec', 'playwright', 'test', ...filters], web, {
      SMOKE_BASE_URL: webUrl,
      SMOKE_DATABASE_URL: env.DATABASE_URL,
      SMOKE_REDIS_PREFIX: env.REDIS_PREFIX,
    }),
});
