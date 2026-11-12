# Migrations

Plain SQL, applied in filename order by `pnpm migrate` (and by the test harness on its own fresh database).

- Name: `<yyyymmddhhmmss>_<snake_case_name>.sql`, UTC timestamp of when you wrote it. Any other `.sql` name stops the migrator.
- Each file runs in one transaction. Its name is recorded in `schema_migrations` and never runs again, so never edit a file that has landed: add a new one.
- Keep the Drizzle schema file of the domain (`src/db/schema/`) in step by hand.
