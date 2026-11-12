// The smoke launcher: starts the fake upstream, the API, the worker and the web
// app on free ports against a fresh database and Redis prefix, hands the URLs to
// a check, then stops everything it started and drops what it created, on
// success, failure or Ctrl-C. `pnpm smoke` and `pnpm smoke:og` are its checks.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, openSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../../apps/backend/src/core/config';
import { deleteKeysWithPrefix } from '../../apps/backend/src/core/redis-keys';
import { createDatabase, dropDatabase, scratchDatabaseName, withDatabase } from '../../apps/backend/src/db/databases';
import { migrate } from '../../apps/backend/src/db/migrator';
import { refreshStaticDataNow } from '../../apps/backend/src/modules/static-data/refresh-now';

const root = join(__dirname, '../..');
const backend = join(root, 'apps/backend');
export const web = join(root, 'apps/web');
const fakeUpstream = join(root, 'apps/fake-upstream');
const logDir = mkdtempSync(join(tmpdir(), 'arena-smoke-'));

interface Started {
  name: string;
  child: ChildProcess;
  log: string;
}

const started: Started[] = [];
let check: ChildProcess | undefined;
const cleanups: Array<() => Promise<void>> = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

export function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
}

// Each process leads its own process group, so stopping it also stops whatever
// it spawned (next dev forks workers).
function start(name: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Started {
  const log = join(logDir, `${name}.log`);
  const out = openSync(log, 'a');
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', out, out], detached: true });
  const entry = { name, child, log };
  started.push(entry);
  return entry;
}

async function waitFor(entry: Started, ready: () => Promise<boolean>, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (entry.child.exitCode !== null) throw new Error(`${entry.name} exited early; log: ${entry.log}`);
    if (await ready().catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`${entry.name} not ready after ${timeoutMs / 1000}s; log: ${entry.log}`);
}

const answers = (url: string) => async () => (await fetch(url)).status < 500;
const logged = (entry: Started, text: string) => async () => readFileSync(entry.log, 'utf8').includes(text);

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

async function stopAll(): Promise<void> {
  check?.kill('SIGTERM');
  const running = started.filter((entry) => entry.child.exitCode === null && entry.child.signalCode === null);
  for (const entry of running) signalGroup(entry.child, 'SIGTERM');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && running.some((entry) => entry.child.exitCode === null && entry.child.signalCode === null)) {
    await sleep(100);
  }
  // A group can outlive its leader, so the second round is unconditional.
  for (const entry of started) signalGroup(entry.child, 'SIGKILL');
  for (const cleanup of cleanups.reverse()) await cleanup().catch((error: unknown) => console.error(error));
}

export interface Stack {
  /** The web app, which forwards /api/* to the API. */
  webUrl: string;
  apiUrl: string;
  /** The database and Redis prefix the stack runs on, for a CLI such as `pnpm replay`. */
  env: { DATABASE_URL: string; REDIS_PREFIX: string };
}

/**
 * `pnpm replay` against the stack: enqueues a rating replay and waits for the
 * stack's worker to finish it. Asynchronous, so the check's open connections
 * keep being served while it runs.
 */
export function replay(stack: Stack): Promise<void> {
  const child = spawn('pnpm', ['replay'], { cwd: root, stdio: 'inherit', env: { ...process.env, ...stack.env } });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pnpm replay exited ${code}`))));
  });
}

export interface Check {
  /** Runs before anything starts, e.g. installing a browser. */
  prepare?: () => void;
  /** Runs once the stack answers; resolves to the exit code. */
  run: (stack: Stack) => Promise<number>;
}

/** Runs `command` until it exits, stopped with the stack on Ctrl-C; resolves to its exit code. */
export function spawnCheck(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  check = child;
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
}

async function main(target: Check): Promise<number> {
  target.prepare?.();
  run('pnpm', ['build'], backend);

  const base = loadConfig(process.env);
  const database = scratchDatabaseName('smoke');
  await createDatabase(base.databaseUrl, database);
  cleanups.push(() => dropDatabase(base.databaseUrl, database));
  const databaseUrl = withDatabase(base.databaseUrl, database);
  await migrate(databaseUrl);
  const redisPrefix = `arena-smoke-${randomBytes(4).toString('hex')}`;
  cleanups.push(() => deleteKeysWithPrefix(base.redisUrl, redisPrefix));

  const [fakePort, apiPort, webPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const fakeUrl = `http://127.0.0.1:${fakePort}`;
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const backendEnv = {
    DATABASE_URL: databaseUrl,
    REDIS_PREFIX: redisPrefix,
    RIOT_API_BASE_AMERICAS: fakeUrl,
    RIOT_API_BASE_BR1: fakeUrl,
    DDRAGON_BASE: fakeUrl,
    CDRAGON_BASE: fakeUrl,
    // The fake accepts any key and has no rate limit; the real limits would
    // only slow a run that syncs a whole player and polls the profile.
    RIOT_API_KEY: 'RGAPI-smoke',
    RIOT_RATE_PER_SECOND: '1000',
    RIOT_RATE_PER_TWO_MINUTES: '100000',
    // The fixtures hold few players with the default 10 games in one scope;
    // 5 lists enough of them for the ladder to page at a small limit.
    LADDER_MIN_GAMES: '5',
  };

  const fake = start('fake-upstream', 'pnpm', ['exec', 'tsx', 'src/main.ts'], fakeUpstream, { PORT: String(fakePort) });
  const api = start('api', 'node', ['dist/main.api.js'], backend, { ...backendEnv, PORT: String(apiPort) });
  const worker = start('worker', 'node', ['dist/main.worker.js'], backend, backendEnv);
  const site = start('web', 'pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)], web, {
    API_INTERNAL_URL: apiUrl,
    NEXT_DIST_DIR: '.next-smoke',
  });

  await Promise.all([
    waitFor(fake, answers(fakeUrl)),
    waitFor(api, answers(`${apiUrl}/api/health`)),
    waitFor(worker, logged(worker, '"msg":"worker ready"')),
    waitFor(site, answers(webUrl)),
  ]);
  // The daily static data refresh would not run before the check ends.
  await refreshStaticDataNow(base.redisUrl, redisPrefix);

  return target.run({ webUrl, apiUrl, env: { DATABASE_URL: databaseUrl, REDIS_PREFIX: redisPrefix } });
}

// A signal and the run's own failure can both arrive; whichever comes first
// decides the exit code, and neither exits before cleanup is done.
let stopped: Promise<void> | undefined;
let exitCode: number | undefined;
async function finish(code: number): Promise<never> {
  exitCode ??= code;
  stopped ??= stopAll();
  await stopped;
  if (exitCode !== 0) console.error(`smoke: failed; process logs in ${logDir}`);
  process.exit(exitCode);
}

/** Starts the stack, runs the check against it, tears down and exits with the check's code. */
export function launch(target: Check): void {
  process.on('SIGINT', () => void finish(130));
  process.on('SIGTERM', () => void finish(143));

  main(target).then(finish, (error: unknown) => {
    console.error(error);
    return finish(1);
  });
}
