// `pnpm fixtures:check [-- <dir>]`: verifies a fixture set, the committed one by
// default, its seasons against SEASON_SEED. Exits 1 listing every problem.

import { checkFixtures, DEFAULT_FIXTURES_DIR, readManifest } from '../apps/fake-upstream/src';
import { SEASON_SEED } from '../apps/backend/src/modules/seasons/season-seed';

const dir = process.argv.slice(2).find((arg) => arg !== '--') ?? DEFAULT_FIXTURES_DIR;
const problems = checkFixtures(dir, { seasons: SEASON_SEED });
if (problems.length > 0) {
  for (const problem of problems) console.error(`fixtures:check: ${problem}`);
  process.exit(1);
}
const manifest = readManifest(dir);
const players = manifest.players.map(
  (p) => `${p.gameName}#${p.tagLine} (${p.currentSeasonMatchIds.length} current-season recorded of ${p.currentSeasonListed.total} listed)`,
);
console.log(`fixtures:check: ok; ${players.join(', ')}; ${manifest.sharedCurrentSeasonMatchIds.length} shared; ${manifest.derived.length} derived`);
