# Static data

Champion names and icons from Data Dragon, Arena augments from Community Dragon, cached in Postgres. `apps/backend/src/modules/static-data/`.

## Refresh

`static-data-refresh` on the `maintenance` queue, run by a job scheduler daily at 06:00 UTC (`StaticDataModule.onModuleInit`). One run:

1. `GET <DDRAGON_BASE>/api/versions.json`; the first `x.y.z` entry is the latest patch.
2. `GET <DDRAGON_BASE>/cdn/<patch>/data/en_US/champion.json`: one `champions` row per champion for that patch, keyed by Data Dragon's `key`, the id match-v5 reports as `championId`.
3. `GET <CDRAGON_BASE>/latest/cdragon/arena/en_us.json`: one `augments` row per augment. Augments are stored only; v1 shows none.
4. A `static_data_refreshes` row with the patch and the counts.

Steps 2 to 4 are upserts in one transaction, so a run is idempotent, and a rerun only moves the last refresh time. Earlier patches stay cached. Any upstream answer but a 200 fails the job and changes nothing; the scheduler's job retries 3 times, a minute apart and doubling.

The schedule is a cron pattern, not an interval: an interval runs at once on a fresh Redis, which in tests would reach for the real upstreams. A fresh deployment shows champions as `Champion <id>` with no icon until the first run. The smoke launcher runs one refresh itself, after the worker is ready (`refreshStaticDataNow` in `refresh-now.ts`).

Health carries `staticData: { lastRefreshAt, patch }`, both null before the first run.

## Lookup

`ChampionCatalog.resolve(ids)` (exported by `StaticDataModule`) answers a `ChampionRef` per id: `{ id, name, iconUrl }`. An id resolves against the latest cached patch, or the most recent cached patch that has it, so a match from an older patch still gets a name, and a champion the newest patch lacks keeps its last one. An id no cached patch has answers `name: null, iconUrl: null`.

Icon URLs are `https://ddragon.leagueoflegends.com/cdn/<patch>/img/champion/<file>`, on the public host whatever `DDRAGON_BASE` says: the browser loads them, and in tests and smoke `DDRAGON_BASE` is the fake, which serves no images.

## Fixtures

`pnpm record-static-fixtures` records, from the public hosts, the three answers a refresh reads into `apps/fake-upstream/fixtures-anon/ddragon/` and `cdragon/`. The versions list and the latest patch's champion data are kept as they are; the augment list is cut to the fields stored and marked derived. The committed set is patch 16.20.1, recorded on 2026-10-09, and has every champion the Riot fixtures play.
