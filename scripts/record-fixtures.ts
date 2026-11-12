// `pnpm record-fixtures`: records the Riot fixture set from the live API into
// apps/fake-upstream/fixtures-recorded, then derives the variants. Run it once by
// hand. The recording holds real players, so git ignores that directory; the
// package script then runs `fixtures:anonymise`, which writes the committed set.
//
//   RIOT_API_KEY      the development key; when unset, read from .riot.key at the repo root
//   FIXTURE_RIOT_ID   whose history to record (Brazil), required
//   FIXTURE_MAX_CURRENT_MATCHES  current-season bodies recorded per player, newest first, default 60
//   ARENA_QUEUE_IDS   the queue ids every listing runs once per, as the backend reads them
//   RECORD_INTERVAL_MS  gap between requests, default 1300 (under 100 per two minutes)
//
// Matches already recorded are skipped, so a run stopped by an expired key
// resumes where it stopped once the key is replaced.

import { RECORDED_FIXTURES_DIR } from '../apps/fake-upstream/src';
import { SEASON_SEED } from '../apps/backend/src/modules/seasons/season-seed';
import { recordFixtures } from './fixtures/record';
import { scriptRiotConfig } from './riot/script-config';

const { config, riot } = scriptRiotConfig(process.env);
const interval = process.env.RECORD_INTERVAL_MS;
const maxCurrent = process.env.FIXTURE_MAX_CURRENT_MATCHES;
const riotId = process.env.FIXTURE_RIOT_ID;
if (!riotId) {
  console.error('record-fixtures: set FIXTURE_RIOT_ID to the Riot ID whose history to record, as in Name#TAG');
  process.exit(1);
}

recordFixtures({
  riot,
  outDir: RECORDED_FIXTURES_DIR,
  riotId,
  seasons: SEASON_SEED,
  queueIds: config.riot.arenaQueueIds,
  intervalMs: interval ? Number(interval) : undefined,
  maxCurrentMatches: maxCurrent ? Number(maxCurrent) : undefined,
}).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`record-fixtures: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
