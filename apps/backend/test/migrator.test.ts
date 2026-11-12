import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { createDatabase, dropDatabase, scratchDatabaseName, withDatabase } from '../src/db/databases';
import { migrate } from '../src/db/migrator';

const serverUrl = process.env.ARENA_TEST_SERVER_URL!;

describe('migrator', () => {
  let name: string;
  let url: string;
  let dir: string;

  beforeEach(async () => {
    name = scratchDatabaseName('migrator');
    await createDatabase(serverUrl, name);
    url = withDatabase(serverUrl, name);
    dir = mkdtempSync(join(tmpdir(), 'arena-migrations-'));
  });

  afterEach(async () => {
    await dropDatabase(serverUrl, name);
  });

  async function query<T>(sql: string): Promise<T[]> {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      return (await client.query(sql)).rows as T[];
    } finally {
      await client.end();
    }
  }

  it('applies files in name order and records each name', async () => {
    writeFileSync(join(dir, '20260102000000_second.sql'), "insert into log values ('second');");
    writeFileSync(join(dir, '20260101000000_first.sql'), 'create table log (entry text);');
    writeFileSync(join(dir, 'README.md'), 'not a migration');

    expect(await migrate(url, dir)).toEqual(['20260101000000_first.sql', '20260102000000_second.sql']);
    expect(await query<{ entry: string }>('select entry from log')).toEqual([{ entry: 'second' }]);
    expect(await query<{ name: string }>('select name from schema_migrations order by name')).toEqual([
      { name: '20260101000000_first.sql' },
      { name: '20260102000000_second.sql' },
    ]);
  });

  it('skips files already applied', async () => {
    writeFileSync(join(dir, '20260101000000_first.sql'), 'create table log (entry text);');
    await migrate(url, dir);
    writeFileSync(join(dir, '20260102000000_second.sql'), "insert into log values ('second');");

    expect(await migrate(url, dir)).toEqual(['20260102000000_second.sql']);
    expect(await migrate(url, dir)).toEqual([]);
  });

  it('rolls back a failing file and records nothing for it', async () => {
    writeFileSync(join(dir, '20260101000000_broken.sql'), 'create table half (id int); select nope;');

    await expect(migrate(url, dir)).rejects.toThrow('20260101000000_broken.sql');
    expect(await query("select to_regclass('half') as half")).toEqual([{ half: null }]);
    expect(await query('select name from schema_migrations')).toEqual([]);
  });

  it('refuses a file that is not named <14-digit timestamp>_<name>.sql', async () => {
    writeFileSync(join(dir, '1_first.sql'), 'select 1;');

    await expect(migrate(url, dir)).rejects.toThrow('1_first.sql');
  });
});
