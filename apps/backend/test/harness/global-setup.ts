import { loadConfig } from '../../src/core/config';
import { createDatabase, scratchDatabaseName, withDatabase } from '../../src/db/databases';
import { migrate } from '../../src/db/migrator';

// Runs once per `pnpm test`: creates a database for this run only, migrates it,
// and points DATABASE_URL at it for every test worker. global-teardown drops it.
export default async function globalSetup(): Promise<void> {
  const serverUrl = loadConfig(process.env).databaseUrl;
  const name = scratchDatabaseName('test');
  await createDatabase(serverUrl, name);
  const url = withDatabase(serverUrl, name);
  await migrate(url);
  process.env.ARENA_TEST_SERVER_URL = serverUrl;
  process.env.ARENA_TEST_DATABASE = name;
  process.env.DATABASE_URL = url;
}
