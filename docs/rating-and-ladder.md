# Rating and ladder

How ratings are computed from the match table and what the ladder, position and rating endpoints answer. `apps/backend/src/modules/rating/` and `apps/backend/src/modules/ladder/`.

## Replay

`replay(matches)` in `rating/rating-replay.ts` is the whole computation, a pure function over an in-memory match list:

1. Matches are sorted by end time, then match id, so the result depends only on the set of matches, never on the order they arrived in.
2. Irregular lobbies are skipped. Every other match is rated once in each of its scopes: its season (from its patch, stored on the match) and all-time. A match before every season is rated all-time only. Each format is its own ladder.
3. Teams are the match's subteams, ranked by placement. Equal placements are ties. openskill's `rate` runs with its defaults, which use the Plackett-Luce model.
4. Every player starts each format and scope at openskill's default rating. The displayed rating is the ordinal, mu minus three sigma.

It returns one rating per player, format and scope (mu, sigma, ordinal, games, wins, top-4 finishes, placement sum) and one history point per participant, scope and rated match (the ordinal right after it).

`ReplayRunner` runs it against the database:

1. Inserts a `replay_runs` row: a new run id, `completed_at` null.
2. Walks every non-irregular match in pages of 500, in `(ended_at, id)` order over the `matches_ended_at_id` index, with their participants. Each page is rated by a `RatingReplay` (`rating-replay.ts`), which holds only the per-player state, and its `rating_history` rows are written before the next page is read; the `ratings` rows are written at the end. Memory holds one page plus that state, and the event loop turns between pages, so the worker's Riot jobs and lock renewals keep running. `replay()` is the in-memory form over a whole set, for the pure tests.
3. Sets `completed_at`. Readers only use the latest complete run, so a run in progress is never visible.
4. Deletes every run older than the previous complete one, complete or not, with its rows. The latest two complete runs remain.

The job is `rating-replay` on the `maintenance` queue. `RatingModule` registers it as a job scheduler at boot: every two hours on the hour, UTC (`0 */2 * * *`). `pnpm replay` enqueues one more and waits for a worker to finish it, using `REDIS_URL` and `REDIS_PREFIX` as the worker does. It prints the run id and counts, or exits 1 with the failure.

## Endpoints

`format` is a format id, `6x3` by default; `season` is a season id or `all`, the current season by default. A player is ranked with at least `LADDER_MIN_GAMES` (default 10) games in that format and scope.

| Route | Answers |
| --- | --- |
| `GET /api/ladders/:region?format=&season=&limit=&cursor=` | `LadderResponse`: ranked players, highest rating first, `limit` per page (default 50, at most 100) |
| `GET /api/ladders/:region/players/:gameName/:tagLine?format=&season=` | `LadderPositionResponse`: `ranked: true` with `rank`, or `ranked: false` with `gamesRemaining` |
| `GET /api/profiles/:region/:gameName/:tagLine/rating?format=&season=` | `RatingResponse`: rating, `ranked`, `gamesRemaining` and one history point per rated match, oldest first |

All three read the latest complete run and carry nothing from a run in progress. The ladder and rating responses carry `lastReplayAt` (when the latest complete run finished, null before any) and `nextReplayAt` (the scheduler's next run).

- A ladder row has rank, Riot ID, rating, games, win rate, top-4 rate and average placement, all from the run's own counts. Ranks are by position: equal ratings are ordered by PUUID and still get distinct ranks.
- `nextCursor` is opaque and null on the last page. It names the run its first page came from, so paging stays on that run while it is kept; once that run is pruned, the cursor answers 400.
- `irregular` has no ladder: 400. An unknown season, a bad `limit` or a malformed cursor is a 400; an unknown region a 404.
- Position and rating find the player by the Riot ID last seen for them, case-insensitively, among tracked players. They never ask Riot: a Riot ID no match or search has brought in is a 404. A player with no rated game in the scope is unranked with every game remaining; their rating is null.

The profile response does not change; the rating is its own endpoint.

## Health

`GET /api/health` carries a `rating` section with `lastReplayAt` and `nextReplayAt`, as above.

## Tests

`rating/rating-replay.test.ts` covers the pure replay against openskill's documented figures, order independence, ties, a last-patch match and formats. `test/ladder.e2e.test.ts` syncs both recorded players from the fixtures and covers the ladder order and cut, paging, position, the rating endpoint, a run in progress, pruning and `pnpm replay`.
