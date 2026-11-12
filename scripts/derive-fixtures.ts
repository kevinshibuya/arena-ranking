// `pnpm fixtures:derive`: rewrites the derived and hand-authored fixtures in
// apps/fake-upstream/fixtures-anon from the set there. `record-fixtures` runs this
// itself; run it alone after changing a derivation. Without a recorded set it
// writes the hand-authored fixtures only.

import { DEFAULT_FIXTURES_DIR, deriveFixtures, hasManifest, writeHandAuthored } from '../apps/fake-upstream/src';
import { SEASON_SEED } from '../apps/backend/src/modules/seasons/season-seed';

if (hasManifest(DEFAULT_FIXTURES_DIR)) {
  const derived = deriveFixtures(DEFAULT_FIXTURES_DIR, { seasons: SEASON_SEED });
  console.log(`fixtures:derive: wrote ${derived.length} fixtures`);
} else {
  const written = writeHandAuthored(DEFAULT_FIXTURES_DIR);
  console.error(`fixtures:derive: no recorded set yet; wrote the ${written.length} hand-authored fixtures only`);
  process.exit(1);
}
