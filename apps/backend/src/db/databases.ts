import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

// Creates and drops whole databases on the server a connection URL points at.
// The test harness and the smoke launcher use these to give every run its own
// database, so several worktrees can run at once against one Postgres.

export function scratchDatabaseName(purpose: string): string {
  return `arena_${purpose}_${Date.now()}_${randomBytes(3).toString('hex')}`;
}

export function withDatabase(url: string, name: string): string {
  const next = new URL(url);
  next.pathname = `/${name}`;
  return next.toString();
}

async function onServer<T>(url: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: withDatabase(url, 'postgres') });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function assertSafeName(name: string): void {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Refusing database name ${JSON.stringify(name)}`);
}

export async function createDatabase(url: string, name: string): Promise<void> {
  assertSafeName(name);
  await onServer(url, (client) => client.query(`create database ${name}`));
}

export async function dropDatabase(url: string, name: string): Promise<void> {
  assertSafeName(name);
  await onServer(url, (client) => client.query(`drop database if exists ${name} with (force)`));
}
