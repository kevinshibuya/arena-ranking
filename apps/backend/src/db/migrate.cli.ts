import { loadConfig } from '../core/config';
import { migrate } from './migrator';

// `pnpm migrate`: applies pending migrations to DATABASE_URL.
async function main(): Promise<void> {
  const applied = await migrate(loadConfig(process.env).databaseUrl);
  console.log(applied.length === 0 ? 'migrate: up to date' : `migrate: applied ${applied.join(', ')}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
