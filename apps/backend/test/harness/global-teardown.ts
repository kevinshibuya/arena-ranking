import { dropDatabase } from '../../src/db/databases';

export default async function globalTeardown(): Promise<void> {
  const serverUrl = process.env.ARENA_TEST_SERVER_URL;
  const name = process.env.ARENA_TEST_DATABASE;
  if (serverUrl && name) await dropDatabase(serverUrl, name);
}
