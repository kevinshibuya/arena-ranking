import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

// Applies plain SQL migrations in filename order. Each file runs in its own
// transaction and its name goes into schema_migrations; a name already there is
// skipped. No generated journal: adding a migration is adding a file.

export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

const MIGRATION_NAME = /^\d{14}_[a-z0-9_-]+\.sql$/;
// Arbitrary constant: serialises concurrent migrators on one database.
const LOCK_ID = 727_001;

function migrationFiles(dir: string): string[] {
  const files = readdirSync(dir).filter((file) => file.endsWith('.sql'));
  const misnamed = files.filter((file) => !MIGRATION_NAME.test(file));
  if (misnamed.length > 0) {
    throw new Error(`Migration names must be <yyyymmddhhmmss>_<name>.sql: ${misnamed.join(', ')}`);
  }
  return files.sort();
}

/** Applies every pending migration in `dir` and returns the names it applied. */
export async function migrate(databaseUrl: string, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = migrationFiles(dir);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const applied = new Set(
      (await client.query<{ name: string }>('select name from schema_migrations')).rows.map((row) => row.name),
    );
    const done: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      try {
        await client.query('begin');
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
      done.push(file);
    }
    return done;
  } finally {
    await client.end();
  }
}
