# Riot client, fake upstream and fixtures

How the backend talks to Riot, and how tests and smoke runs get a Riot that answers from committed fixtures instead.

## Riot client

`apps/backend/src/modules/riot-client/`. `RiotClientModule` exports `RiotClient`, the only code that performs HTTP to Riot.

| Method | Riot endpoint |
| --- | --- |
| `accountByRiotId(region, gameName, tagLine)` | account-v1 by Riot ID |
| `accountByPuuid(region, puuid)` | account-v1 by PUUID |
| `matchIdsByPuuid(region, puuid, { queue, startTime, endTime, start, count })` | match-v5 match ids; times are `Date`s, sent as epoch seconds |
| `matchById(region, matchId)` | match-v5 match |
| `platformStatus(region)` | lol-status-v4 platform data, on the platform host; the key probe's request |

Each returns a `RiotResult<T>`, discriminated by `kind`:

- `ok`: `data` plus `rateLimits`.
- `not-found`: 404, e.g. a Riot ID that does not resolve.
- `rate-limited`: 429, with `retryAfterSeconds` and `limitType` (`application`, `method` or `service`).
- `key-rejected`: 401 or 403.
- `error`: any other status, with the raw `body`.

Every kind carries `rateLimits`: the app and method windows, `{ seconds, limit, used }`, parsed from the `X-App-Rate-Limit*` and `X-Method-Rate-Limit*` headers.

The client never retries and never sleeps; that is the queue layer's job. It reads the key for every request: `RIOT_KEY_FILE`'s current contents, falling back to `RIOT_API_KEY` while the file is unset, missing or empty. So the request after a 401 or 403 already uses a replaced key. With no key at all it throws `RiotKeyMissingError` and sends nothing.

Every response's rate-limit windows also go to the `onRateLimits` option, awaited; in the app it is `RiotBudget`, which keeps the app budget in Redis for health ([docs/ops.md](ops.md)).

`regions.ts` maps a region to its hosts: `br` is platform `br1` and regional host `americas`. Account-v1 and match-v5 use the regional host, lol-status the platform host. The base URLs come from `RIOT_API_BASE_AMERICAS` and `RIOT_API_BASE_BR1`.

## Arena queue ids

Riot's published queue list names only 1700 and 1710 for Arena, and live matches use ids it does not carry. `ARENA_QUEUE_IDS` (comma-separated, default `1700,1710,1740,1750`) is read into `config.riot.arenaQueueIds`; the default and what each id was seen to carry live in `apps/backend/src/modules/riot-client/arena-queues.ts`. Every Arena listing runs once per id, the recorder's and the sync's. The format never comes from the id: it comes from the lobby shape.

| Queue id | Seen carrying |
| --- | --- |
| 1700 | 8x2 lobbies of 16 in 2026 Season 2 (game version 16.9, May 2026) |
| 1710 | Nothing for the recorded player in 2026 |
| 1740 | 6x3 lobbies of 18 from game version 16.16 (August 2026, the end of Season 2) into Season 3 |
| 1750 | The same, 6x3 lobbies of 18 from 16.16 on; what sets it apart from 1740 is not known |

When a profile shows fewer games than the client, Riot may have added an id. Find it with:

```sh
pnpm riot:queues <Name#TAG>
```

It lists the player's newest 100 match ids with no queue filter, fetches the newest 20 and prints id, date, queue id, game mode, lobby shape and game version, then the queue ids seen that `ARENA_QUEUE_IDS` does not hold. A new Arena id is one edit to the variable. It uses the key the way the recorder does, and exits 1 naming the request path when Riot rejects the key or the Riot ID does not resolve.

## Fake upstream

`apps/fake-upstream` (`@arena/fake-upstream`) is one HTTP server for every upstream host. Point every base URL at it:

```ts
import { startFakeUpstream, loadCanned } from '@arena/fake-upstream';

const fake = await startFakeUpstream({ port: 0 }); // the committed fixtures
const app = await startApp({ worker: true, env: { RIOT_API_BASE_AMERICAS: fake.url, RIOT_API_BASE_BR1: fake.url } });
```

The fake serves each fixture at its path, from whichever host directory holds it. It matches a Riot ID case-insensitively, as Riot does. Anything not recorded gets a 404 naming the path, never an empty 200.

The match-id listing is never replayed from a recording. The fake builds it from every match it holds, recorded, derived and added at runtime:

- `puuid` must be in `metadata.participants`.
- `queue`, `startTime` and `endTime` filter on `gameCreation`, both ends inclusive. Riot's docs don't say which timestamp the real API compares; this is an assumption.
- Results are newest first, then paged by `start` (default 0) and `count` (default 20, maximum 100, otherwise 400).

### Controls

| Request | Method on `FakeUpstream` | Effect |
| --- | --- | --- |
| `POST /__admin/matches` with a match | `addMatch(match)` | Served by id and in later listings |
| `POST /__admin/responses` with `{ path, times?, riotToken?, response }` | `respondNext(rule)` | The next `times` (default 1) requests to `path` get `response` (`{ status, headers?, body? }`); a trailing `*` in `path` matches a prefix; with `riotToken`, only requests carrying that `X-Riot-Token` match, which stands for an expired key |
| `POST /__admin/reset` | `reset()` | Drops added matches, pending canned responses and the request log |
| `GET /__admin/requests` | `requests()` | Every upstream request since the last reset: `{ method, path, riotToken, at }` |

`loadCanned('rate-limited')` (429, `Retry-After: 7`) and `loadCanned('key-rejected')` (403) are ready-made responses for `respondNext`.

`buildMatch({ id, created, teams, queue?, version? })` makes a synthetic match for tests that need exact control over participants and time.

## Fixtures

```
apps/fake-upstream/fixtures-anon/   the committed set, anonymised
  manifest.json          what was recorded, formats seen per queue id, derived fixtures
  riot-regional/         americas.api.riotgames.com
  riot-platform/         br1.api.riotgames.com
  ddragon/               ddragon.leagueoflegends.com (pnpm record-static-fixtures, docs/static-data.md)
  cdragon/               raw.communitydragon.org (the same)
  canned/                responses for respondNext, not served by path
```

A fixture file holds one response, `{ status, headers, body }`, at its request path with each segment percent-encoded. For example, `/lol/match/v5/matches/BR1_1` is stored as `riot-regional/lol/match/v5/matches/BR1_1.json`. Fixtures not recorded from the live API as they are carry `derived: { from?, note }`.

### Recording

```sh
export RIOT_API_KEY=RGAPI-…        # or put it in .riot.key at the repo root
FIXTURE_RIOT_ID='Name#TAG' pnpm record-fixtures
pnpm fixtures:check
```

The recorder goes through `RiotClient`, one request every 1.3 s (`RECORD_INTERVAL_MS`), and sits out any 429 for its Retry-After. It records:

- The account by Riot ID and by PUUID.
- The full current-season listing, once per id in `ARENA_QUEUE_IDS`, and the newest `FIXTURE_MAX_CURRENT_MATCHES` (default 60) match bodies of it. Match ids grow with time, closely enough that the highest ids across queues stand for the newest matches. The manifest keeps the full listed count per player and per queue id, to check against the client.
- Up to 10 matches per earlier 2026 season and queue id.
- The teammate who shared the player's subteam most often in the recorded current-season matches: that teammate's account, by PUUID and by Riot ID, and their current season recorded the same way.

An empty current season stops the run, naming the queue ids it tried and pointing at `pnpm riot:queues`. Matches already on disk are skipped, so a run stopped by an expired key resumes. It writes the manifest, then derives.

The recording lands in `apps/fake-upstream/fixtures-recorded/`, which git ignores, because it holds real players. `pnpm record-fixtures` then runs `pnpm fixtures:anonymise` (`scripts/anonymise-fixtures.ts`), which writes the Riot hosts, `canned/` and the manifest into `fixtures-anon/`:

- Every PUUID, summoner id and Riot ID becomes a synthetic one, the same in every file: `anon-player-0001-0…`, `anon-summoner-0001`, `Player0001#ANON`. The recorded player is `Player0001` and the teammate `Player0002`; the rest are numbered in order of first appearance.
- Match ids become `BR1_1000000001` upwards in the order of the real ids, so the newest match keeps the highest id. `info.gameId` and `info.gameName` follow.
- Summoner names are emptied, and every profile icon and summoner level is the same.
- The participant blocks the app never reads (`challenges`, `perks`, `missions`, `PlayerBehavior`, `selectedRolePreferences`) are dropped. That cut the set from 30 MB to 13 MB.
- Timestamps, game versions, queue ids, champions, items, augments and placements stay as recorded.

The script fails without writing anything if a real identifier would survive, and writes no mapping from real to synthetic values.

A player's `currentSeasonMatchIds` in the manifest are the recorded current-season matches they are in, newest first. That is what the fake lists for them, and it can be shorter than `currentSeasonListed.total`.

### The committed set

Recorded on 2026-10-09 with the defaults above, then anonymised:

| Player | Current season listed | Recorded | Earlier sample |
| --- | --- | --- | --- |
| Player0001#ANON | 304 (1740: 68, 1750: 236) | 74 | 30: ten 8x2 games in 1700 on 16.9, ten 6x3 each in 1740 and 1750 on 16.16 |
| Player0002#ANON, the teammate | 96 (1740: 12, 1750: 84) | 60 | none |

They share 33 recorded current-season matches. Every recorded current-season lobby is 6x3, on game versions 16.19 and 16.20. The client and fake tests run on this set; `scripts/fixtures/committed-set.test.ts` pins the facts above. A new recording changes the match ids and the synthetic player numbers those tests name.

### Derived and hand-authored

`pnpm fixtures:derive` rewrites these from the newest of the largest regular current-season lobbies of the primary player, at least 16 players. `record-fixtures` runs it itself.

| Fixture | What it is |
| --- | --- |
| `BR1_9000000001` | 8x2: the same players regrouped into eight pairs |
| `BR1_9000000002` | Irregular: one player moved into the primary player's team |
| `BR1_9000000003` | Last patch of the previous season (game version 16.16), played two hours after the current season's start timestamp; it belongs to the previous season by its patch |
| `BR1_9000000004` | Two weeks into 2026 Season 1, game version 16.2 |
| `Sem Arena#BR1` | An account with no Arena match |
| `Ninguem#0000` | A Riot ID that does not resolve (404) |
| `/lol/status/v4/platform-data` | The platform status, what the key probe asks for |
| `canned/rate-limited.json` | 429 with Retry-After 7 |
| `canned/key-rejected.json` | 403 |

The manifest lists each one with the format and season it stands for. Season start timestamps come from `SEASON_SEED` in `apps/backend/src/modules/seasons/season-seed.ts`, which the seasons table is seeded from too.

### Check

`pnpm fixtures:check [-- <dir>]` exits 1, listing every problem, unless the set has:

- Both recorded accounts, by Riot ID and by PUUID, with every match the manifest lists.
- At least one current-season match both players played.
- Every derived and hand-authored fixture, marked as derived.
- A manifest listing the formats seen and their queue ids, and each player's full current-season listed count, no smaller than what is recorded.
- Against `SEASON_SEED`: every recorded current-season match's game version maps to the manifest's current season, and every earlier match's to an earlier season.
