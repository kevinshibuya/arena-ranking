import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ProfileResponse, SyncState } from '@arena/shared';

// Helpers for specs that need the stack in a given state before the page loads.
// `pnpm smoke` hands them the stack's URL, database and Redis prefix.

const ROOT = join(__dirname, '../../..');

function stackEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is unset; run the specs through \`pnpm smoke\``);
  return value;
}

/** Asks for a profile through the API and waits until its primary sync is in. */
export function syncPlayer(gameName: string, tagLine: string): Promise<void> {
  return waitForSync(gameName, tagLine, ['primary-syncing']);
}

/**
 * Asks for a profile through the API and waits until its earlier seasons are in
 * too, so counts outside the current season no longer move under a spec.
 */
export function completePlayer(gameName: string, tagLine: string): Promise<void> {
  return waitForSync(gameName, tagLine, ['unknown', 'primary-syncing', 'primary-synced', 'backfilling']);
}

async function waitForSync(gameName: string, tagLine: string, pending: readonly SyncState[]): Promise<void> {
  const url = `${stackEnv('SMOKE_BASE_URL')}/api/profiles/br/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  const deadline = Date.now() + 60_000;
  let state: SyncState | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GET ${url}: ${response.status} ${await response.text()}`);
    state = ((await response.json()) as ProfileResponse).syncState;
    if (!pending.includes(state)) return;
    await sleep(500);
  }
  throw new Error(`${gameName}#${tagLine} still ${state} after 60s`);
}

/** Runs `pnpm replay` against the stack, so the ladder and ratings reflect every match stored. */
export function replay(): Promise<void> {
  const env = {
    ...process.env,
    DATABASE_URL: stackEnv('SMOKE_DATABASE_URL'),
    REDIS_PREFIX: stackEnv('SMOKE_REDIS_PREFIX'),
  };
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['replay'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pnpm replay exited ${code}:\n${output}`))));
  });
}

/** GET a JSON API path through the web app. */
export async function apiJson<T>(path: string): Promise<T> {
  const response = await fetch(`${stackEnv('SMOKE_BASE_URL')}${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}
