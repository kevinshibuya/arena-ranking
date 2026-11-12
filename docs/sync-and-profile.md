# Sync and profile

How a search turns into stored matches and a profile.

## Search

`GET /api/profiles/:region/:gameName/:tagLine?format=<format>&season=<season id|all>` answers `ProfileResponse` (`packages/shared/src/profile.ts`). The format defaults to `6x3` and the season to the current one.

1. The Riot ID is looked up among the tracked players first (`trackedPlayerByRiotId`: region and case-insensitive Riot ID, newest sighting first), with no Riot call, so a profile view never waits on Riot. A tracked player still `unknown` (known only from matches, or left there by a failed primary sync) is claimed for a primary sync from its stored PUUID.
2. Only a Riot ID no tracked player carries is resolved at Riot, by an `account-by-riot-id` job that the API awaits for up to 10 seconds. The job has no priority, so it joins BullMQ's plain wait list, which runs before every sync job. A Riot ID that does not resolve is a 404, `No such Riot ID: Name#TAG`. A lookup that fails or times out is a 503. The player is then found by PUUID and takes the Riot ID just resolved, so a renamed account searched under its new name keeps its one row.
3. A player never synced (sync state `unknown`) is claimed for a primary sync, and the response says `primary-syncing`. Only the search that flips the state starts the sync.
4. The totals come from the stored matches of that format and season, whatever the sync state: games, wins (1st place), top-4 rate, average placement and a placement histogram from 1 to the format's team count. A player with no stored match in any season once every season has been listed answers 200 with state `no-arena-games` and a message.

## Breakdowns

`src/modules/profile/breakdown.controller.ts`, by region and the Riot ID last seen for the player (case-insensitive), scoped by `format` and `season` like the profile, from stored matches only: they never call Riot, so a Riot ID no match or search has brought in yet is a 404, as is an unknown region.

| Endpoint | Answers |
| --- | --- |
| `GET /api/profiles/:region/:gameName/:tagLine/champions` | `ChampionsResponse`: games, wins, top-4 rate and average placement per champion, most games first, then the better average placement |
| `GET /api/profiles/:region/:gameName/:tagLine/teammates` | `TeammatesResponse`: everyone who shared the player's subteam, with games, wins and top-4 rate together, most games first, then most wins |
| `GET /api/profiles/:region/:gameName/:tagLine/matches?cursor=&limit=` | `MatchesResponse`: placement, champion, the rest of the subteam, duration and start, newest first (start, then match id); `limit` 1 to 100, 20 by default; `nextCursor` until the last page. A cursor it did not issue is a 400 |

Champions carry name and icon URL from the static data cache ([docs/static-data.md](static-data.md)). Champion games sum to the profile's game count for the same format and scope.

## Primary sync

`src/modules/sync/`. The API never calls Riot: every Riot request is its own job on the `riot` queue.

| Job | Request | Follow-ups |
| --- | --- | --- |
| `account-by-riot-id` | account-v1 by Riot ID | none |
| `match-ids-page` | one page of 100 match ids for one queue id, from the current season's start | a `match` job per id not stored yet; the next page when this one was full |
| `match` | match-v5 by id | none |

A primary sync lists once per id in `ARENA_QUEUE_IDS`, at priority 1 from a search or a refresh and 2 from the sweep. Its jobs are counted in a Redis hash, `sync:<id>` (`SyncRuns`): a job adds its follow-ups to `pending` before it takes itself off, and the job that brings `pending` to zero finishes the run. A finished primary sync marks the player `primary-synced`, with `last_synced_at` set to when the sync started, and starts the backfill, whether or not the current season had a match. A listed match Riot answers 404 for is skipped. A 429, a rejected key or a missing key sends the job back to wait without spending an attempt ([docs/ops.md](ops.md)).

Any other answer than success fails the attempt. Every Riot job has five attempts, with exponential backoff from 1 second (1, 2, 4, 8). A job whose last attempt fails still settles its run, counted under `failed`, so every run finishes. A run that lost a job leaves no trace on the player, so the next search, refresh or sweep runs it again: a primary sync puts the player back to `unknown` (its stored matches stay), a backfill back to `primary-synced`, and an incremental sync leaves `last_synced_at` where it was.

"Now" (a sync's start, the season it lists, the sweep's look-back) comes from the injectable `Clock` (`clock.ts`); tests replace it through `startApp({ overrides: [[Clock, { now }]] })`.

## Backfill

After a primary sync, the player turns `backfilling` and a backfill lists every Arena queue id at priority 3, from the first seasons row's start up to the second before the current season's start (`endTime`). When it finishes the player is `complete` if any match of theirs is stored, and `no-arena-games` otherwise. A player with no season before the current one is settled the same way at once. A `primary-synced` player, whose backfill lost a job, gets the backfill again with their next incremental sync. A priority-1 job enqueued while backfill jobs wait runs before them. The profile's sync banner names the earlier seasons as missing until then.

## Incremental sync

Lists every Arena queue id from the player's `last_synced_at` less an hour (a game in progress at the last sync started before it), at the caller's priority, and moves `last_synced_at` to its own start when it finishes. A player never synced gets a primary sync instead. A `no-arena-games` player whose incremental sync finds a match turns `complete`: their backfill already ran. While a primary or incremental sync of a player runs, `sync:player:<puuid>` holds its id.

## Sweep

`sweep.ts`, a `sweep` job on the `maintenance` queue that the sync module schedules every hour on the hour (`0 * * * *`). It starts an incremental sync at priority 2 for every tracked player, searched or discovered, with a match ended in the last `SWEEP_LOOKBACK_HOURS` (default 168, 7 days) and a `last_synced_at` older than an hour or unset, skipping one whose primary or incremental sync is still running.

## Update now

| Route | Answer |
| --- | --- |
| `GET /api/profiles/:region/:gameName/:tagLine/refresh` | `RefreshResponse` (`packages/shared/src/refresh.ts`): the cooldown left and `lastSyncedAt` |
| `POST /api/profiles/:region/:gameName/:tagLine/refresh` | 202 with `queued: true` and a 120 s cooldown when it queued an incremental sync at priority 1; 429 with `refused` (`cooldown` or `rate-limited`) and `Retry-After` when refused; 200 with `queued: false` when the player's primary sync is already running |

The player is found by the Riot ID last seen for them, without asking Riot; one nobody has seen is a 404. Both limits live in Redis: `refresh:profile:<puuid>`, set for two minutes by the refresh that queues, and `refresh:client:<ip>`, ten requests a minute counted from the client's first, refused ones included. The client is Express's `req.ip`: the `X-Forwarded-For` address only when the peer is in `TRUSTED_PROXIES`, otherwise the peer itself.

## Match store

`src/modules/match-store/`. `MatchStore.store` writes in one transaction:

- `matches`: one row per Riot match id, with its region, queue id, game version, season (from the game version, null before the first season), format (from the lobby shape), start, end, duration and the raw match as lz4-compressed `jsonb`.
- `participants`: one row per match and PUUID: subteam, placement, champion, kills, deaths, assists, damage to champions, gold, the seven item slots and the six augment ids.
- `players`: every participant, as a tracked player. The Riot ID the match carries replaces the stored one only when the match started after the stored sighting (`riot_id_seen_at`); an account lookup counts as a sighting now.

Inserts ignore rows already there, so a match listed for several players is fetched once if they sync one after another, and stored once whatever the order.
