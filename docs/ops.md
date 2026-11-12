# Ops: rate limit, key state and dashboard

How Riot traffic keeps running unattended on a key that rotates daily, and what the operator sees. `apps/backend/src/modules/ops/`, with the `riot` worker in `src/worker/queue-workers.ts`.

## 429

A `riot` job that gets a 429 throws `RiotRateLimitedError` (`riot-client/riot-refusals.ts`; the sync handlers map results through `riotFailure` in `sync/riot-jobs.ts`). The `riot` worker then rate-limits the whole queue for the Retry-After, or 5 seconds when Riot sends none, and sends the job back to wait with its attempts untouched. No worker in any process takes a `riot` job in that window, and the job runs again by itself once it ends. Application, method and service 429s all take this path. Requests already in flight when the 429 arrives are not recalled.

Before each job, the worker takes a slot in both windows of the key (`RIOT_RATE_PER_SECOND`, `RIOT_RATE_PER_TWO_MINUTES`), counted in Redis across processes. A tenth of each window (rounded up, at least one slot where the window allows: 2 of 20 per second and 10 of 100 per two minutes on the development key) is kept for the Riot ID lookup a search waits on, which carries no priority and runs before every sync job. Sync jobs at any priority use the rest; the lookup may use the whole window; both count in the same windows, so the key stays under Riot's limits. A sync job that finds its share spent holds the queue for at most a second before the worker looks again, so a lookup is fetched within a second of arriving; a lookup that finds the whole window spent holds the queue until a slot frees, and the search answers 503 after 10 seconds.

## App budget

Every Riot response that carries `X-App-Rate-Limit` and `X-App-Rate-Limit-Count` overwrites `riot:app-budget` in Redis (`RiotBudget`): per window, its length, the limit and what is left. Health reports it with the time of that response.

## Key state

A 401 or 403 throws `RiotKeyRejectedError`, and a request with no key at all (`RIOT_KEY_FILE` unset, missing or empty, and no `RIOT_API_KEY`) throws `RiotKeyMissingError`. The worker hands either to `RiotKeyGuard.reject()`, which pauses the `riot` queue (a BullMQ pause, so it holds across processes and restarts), sets `riot:key-rejected` and sends the job back to wait. Nothing on the `riot` queue runs or is retried while the key is rejected, and a job sent back this way spends no attempt; a search for a Riot ID never seen times out on its lookup and answers 503, while tracked players answer from Postgres.

The first rejection enqueues a `riot-key-probe` job on the `maintenance` queue, delayed by `RIOT_KEY_PROBE_INTERVAL_MS` (default 60 seconds). The probe asks for lol-status platform data with the key file's current contents. When Riot answers, the key state goes back to ok and the `riot` queue resumes, so the jobs waiting on it, the pending sync's included, run on. When it does not, the probe enqueues the next one. No probe exists while the key is accepted.

The operator's only action is replacing the contents of the key file (`RIOT_KEY_FILE`). The next probe picks it up; no restart.

## Health

`GET /api/health` carries an `ops` section (`packages/shared/src/health/ops.ts`):

```json
{
  "riotKey": "ok",
  "appBudget": { "observedAt": "2026-10-09T22:10:04.120Z", "windows": [{ "seconds": 1, "limit": 20, "remaining": 19 }, { "seconds": 120, "limit": 100, "remaining": 61 }] },
  "queues": { "riot": { "depth": 0, "paused": false }, "maintenance": { "depth": 0, "paused": false } }
}
```

`appBudget` is null until a response with the headers. A queue's `depth` counts its jobs not finished: waiting, prioritised, delayed, active and waiting on children. The next run of a repeatable job, such as the rating replay, is a delayed job standing for a schedule and counts only once it is due (`queueDepth` in `core/queues.ts`).

## Queue dashboard

bull-board over both queues at `/api/ops/queues`, behind basic auth from `DASHBOARD_USER` and `DASHBOARD_PASS`. A request without them, or with wrong ones, gets 401 and a Basic challenge. Unless both variables are set the path is not mounted and answers 404. Only the API serves it.

## Tests

`apps/backend/test/rate-limit.e2e.test.ts` covers the 429 wait and a rejected key through to its recovery; `ops.e2e.test.ts` covers the health section and the dashboard. Both drive the API with the fake upstream's `respondNext`. For an expired key they write a key file and pass `riotToken` so only requests carrying the old key are refused.
