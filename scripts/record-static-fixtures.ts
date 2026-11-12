// `pnpm record-static-fixtures`: records the Data Dragon and Community Dragon
// answers the static data refresh reads into apps/fake-upstream/fixtures-anon. Run it
// once by hand; it needs no key.
//
//   DDRAGON_BASE, CDRAGON_BASE   the upstreams, defaulting to the public hosts
//
// The versions list and the newest version's champion data are recorded as
// they are. The Arena augment list is half a megabyte, mostly tooltips and
// numbers; it is cut to the fields the refresh stores and marked derived.

import { DEFAULT_FIXTURES_DIR, writeFixture, type Host } from '../apps/fake-upstream/src';
import { loadConfig } from '../apps/backend/src/core/config';
import {
  CDRAGON_ARENA_PATH,
  DDRAGON_VERSIONS_PATH,
  ddragonChampionsPath,
  type CdragonArena,
  type DdragonVersions,
} from '../apps/backend/src/modules/static-data/sources';

const config = loadConfig(process.env);

async function get(base: string, path: string): Promise<unknown> {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`GET ${base}${path}: ${response.status}`);
  return response.json();
}

function write(host: Host, path: string, body: unknown, note?: string): void {
  const file = writeFixture(DEFAULT_FIXTURES_DIR, host, path, {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body,
    ...(note ? { derived: { note } } : {}),
  });
  console.log(`recorded ${file}`);
}

async function main(): Promise<void> {
  const versions = (await get(config.ddragonBase, DDRAGON_VERSIONS_PATH)) as DdragonVersions;
  write('ddragon', DDRAGON_VERSIONS_PATH, versions);
  const latest = versions[0]!;
  write('ddragon', ddragonChampionsPath(latest), await get(config.ddragonBase, ddragonChampionsPath(latest)));

  const arena = (await get(config.cdragonBase, CDRAGON_ARENA_PATH)) as CdragonArena;
  const augments = arena.augments.map(({ id, apiName, name, rarity, iconSmall, iconLarge }) => ({
    id,
    apiName,
    name,
    rarity,
    iconSmall,
    iconLarge,
  }));
  write('cdragon', CDRAGON_ARENA_PATH, { augments }, 'Recorded, then cut to the fields the static data refresh stores');
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`record-static-fixtures: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
