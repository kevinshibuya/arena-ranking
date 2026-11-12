# Workspace and seams

How the repository is laid out and where a feature plugs in. Everything named here exists from the first commit, mostly empty, so features fill files they own instead of editing shared ones. A feature documents itself in its own file under `docs/`.

## Layout

| Path | Package | What it is |
| --- | --- | --- |
| `apps/backend` | `@arena/backend` | NestJS, two entrypoints over the same modules: `src/main.api.ts` (HTTP) and `src/main.worker.ts` (queue consumers) |
| `apps/web` | `@arena/web` | Next.js app router with Tailwind; forwards `/api/*` to the API |
| `apps/fake-upstream` | `@arena/fake-upstream` | Stand-in for every upstream host in tests and smoke; answers 404 to anything not recorded |
| `packages/shared` | `@arena/shared` | API response types, types only |

The backend uses NestJS 11 (CommonJS), because NestJS 12 ships only as ESM and the test runner is Jest. SWC compiles the backend and runs it under Jest, keeping decorator metadata. `tsc` only typechecks.

## Backend modules

`src/app.module.ts` imports every domain module. Neither process's bootstrap changes when a feature lands, and the app module doesn't either.

`src/modules/`: `riot-client`, `sync`, `match-store`, `formats`, `seasons`, `profile`, `rating`, `ladder`, `static-data`, `ops`. Controllers, providers and job handlers go in the feature's own module.

Infrastructure is in `src/core/`, global, injectable anywhere:

- `CONFIG` (`core/config.ts`): every environment variable, typed. A new variable goes here and in the README table.
- `DATABASE` (`core/database.ts`): Drizzle over a `pg` pool, with the schema from `src/db/schema/`. `PG_POOL` is the raw pool.
- `REDIS` (`core/redis.ts`): an ioredis client whose keys are all under `<REDIS_PREFIX>:`.
- Queues (`core/queues.ts`): `QUEUES.riot` for every Riot-bound job, `QUEUES.maintenance` for replay, static data and probes. Inject one with `@InjectQueue(QUEUES.riot)`.

Every HTTP route is under `/api` (`GET /api/health`).

## Jobs

The API only enqueues. The worker process runs one BullMQ worker per queue (`src/worker/queue-workers.ts`). Each worker dispatches a job by name to the provider marked for it:

```ts
@JobHandler({ queue: QUEUES.riot, name: 'match-by-id' })
@Injectable()
export class MatchByIdHandler implements QueueJobHandler<{ matchId: string }, void> {
  async handle(job: Job<{ matchId: string }>): Promise<void> { … }
}
```

Register the handler as a provider of its own module. A job with no handler fails, and its failure reason names it. Two handlers for one queue and name stop the worker at boot. The `riot` worker holds every job to both windows of the key, `RIOT_RATE_PER_SECOND` per second and `RIOT_RATE_PER_TWO_MINUTES` per two minutes, counted in Redis across processes; a job that finds a window full goes back to wait without spending an attempt; a tenth of each window is kept for the unprioritised lookup, so a prioritised job holds the queue for at most a second at a time while a lookup holds it until a slot frees ([docs/ops.md](ops.md)). A `riot` job makes exactly one Riot request, so the limiter limits requests.

A module registers its own repeatable jobs in its `onModuleInit` (`queue.upsertJobScheduler(...)`, which is idempotent), not in a central scheduler. A schedule's next run, delayed until due, counts neither toward a queue's depth in health nor toward the test harness's `drain()`.

## Health

`GET /api/health` returns one section per contributor (`process`, `ops`, `rating` so far). To add a section:

1. In `packages/shared/src/health/<module>.ts`, replace the empty section type with `{ <section>: <Shape> }`. The files for `ops`, `rating` and `static-data` already exist and are already part of `HealthResponse`.
2. In the module, add `<module>.health.ts`: a provider marked `@HealthContributor()` implementing `HealthSectionContributor<'<section>'>`. Register it in the module.

The ops module's `HealthService` discovers contributors; nothing else changes. This ticket ships `process` (`{ status: 'ok', uptimeSeconds }`).

## Database

- Drizzle schema: one file per domain in `apps/backend/src/db/schema/` (`players`, `matches`, `seasons`, `ratings`, `static-data`), already exported from its index.
- Migrations: plain SQL in `apps/backend/migrations/`, named `<yyyymmddhhmmss>_<name>.sql`, applied in name order by `pnpm migrate`. Applied names are recorded in `schema_migrations`. See that directory's README.

## Logging

Both processes log through pino, one JSON object per line on stdout. Lines written while serving a request carry `requestId`, taken from an incoming `x-request-id` header or minted, and echoed on the response. `authorization` and `cookie` headers are redacted. In a service, use Nest's `Logger`: `private readonly logger = new Logger(MyService.name)`.

## Tests

`pnpm test` runs Jest over every package. For the backend, `test/harness/global-setup.ts` creates a database with a random name, migrates it and points `DATABASE_URL` at it; global teardown drops it. E2E tests start the app through the harness:

```ts
import { startApp } from './harness';

const app = await startApp({ worker: true, env: { RIOT_API_BASE_AMERICAS: fake.url } });
await request(app.http).get('/api/health').expect(200);
await app.queue(QUEUES.riot).add('match-by-id', { matchId });
await app.drain();          // until no queue has work left; a schedule's next run does not count
app.logLines();             // log lines since this app started
await app.close();          // also deletes the app's Redis keys
```

Each app gets its own Redis prefix, so runs in several worktrees at once never share a queue. `worker: true` runs the job handlers in the test process. A file whose assertions would clash with another file's writes takes a database of its own: `const db = await scratchDatabase()`, then `env: { DATABASE_URL: db.url }` and `db.drop()` after. Name e2e files `<name>.e2e.test.ts` and unit tests `<name>.test.ts`, so `pnpm test -- <name>` selects them. The filter matches the absolute path, so in a worktree whose path holds `<name>` it selects every file; the 30 s default test timeout in `jest.config.js` keeps that full run from timing out under load.

## Smoke

`pnpm smoke [-- <filter>]` (`scripts/smoke.ts`) and `pnpm smoke:og` (`scripts/smoke-og.ts`) are two checks on one launcher, `scripts/smoke/launcher.ts`:

1. Installs Chromium if missing (`smoke` only) and builds the backend.
2. Creates a fresh database and Redis prefix.
3. Starts the fake upstream, API, worker and `next dev` on free ports, with every upstream base URL pointed at the fake, a dummy Riot key, a rate limit the fake never needs and `LADDER_MIN_GAMES` lowered to 5, so the fixtures fill a ladder that pages.
4. Runs the check: the Playwright specs in `apps/web/smoke/` matching the filter, or the OpenGraph check.
5. Stops every process group it started and drops the database, whether the check passes or fails, and on Ctrl-C.

A new check is a script calling `launch({ prepare?, run })` with a `run` that takes the stack (`{ webUrl, apiUrl, env }`) and resolves to an exit code. `replay(stack)` runs `pnpm replay` against it; `env` holds its `DATABASE_URL` and `REDIS_PREFIX`.

The Playwright specs get the stack as `SMOKE_BASE_URL`, `SMOKE_DATABASE_URL` and `SMOKE_REDIS_PREFIX`. `smoke/stack.ts` turns them into helpers for a spec's `beforeAll`: `syncPlayer` waits for a profile's primary sync, `replay` runs `pnpm replay`, `apiJson` reads the API through the web app.

The filter matches the spec's absolute path, as Jest's does, so in a worktree whose path holds the filter's word it selects every spec: `pnpm smoke -- ladder.spec` selects the one file anywhere.

Process logs stay in a temp directory, printed on failure. Write one spec file per page, and import `test` and `expect` from `./fixtures`. The fixtures abort requests to any non-local host and fail the test on any console error; `expectFitsPhoneWidth(page)` checks a page has no horizontal scroll at phone width.
