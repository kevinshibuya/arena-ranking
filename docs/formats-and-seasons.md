# Formats and seasons

The two lookups every stored match goes through: its lobby format and its season.

## Format

`detectFormat(participants)` in `apps/backend/src/modules/formats/format-detector.ts` groups a match's participants by `playerSubteamId` and names the format team count by team size: `6x3`, `8x2`, `4x4`. Riot's Arena queue ids (`ARENA_QUEUE_IDS`: 1700, 1710, 1740, 1750) do not tell the 2026 formats apart, and the same id has carried different shapes, so the lobby shape is the only source. Uneven team sizes, or a participant with no subteam id (missing, null or zero), give `irregular`, which no ladder uses.

`DEFAULT_FORMAT` is `6x3`, labelled "6 teams of 3". `formatLabel(id)` gives the label of any format.

## Season

The `seasons` table holds a name, the first patch in game-version form (major and minor of the `gameVersion` match-v5 reports: `16.9` for the patch Riot calls 26.09, since the major is the year minus 10) and a start timestamp. The first migration seeds the 2026 seasons from `SEASON_SEED` (`apps/backend/src/modules/seasons/season-seed.ts`):

| Season | First patch | Starts (UTC) |
| --- | --- | --- |
| 2026 Season 1 | 16.1 | 2026-01-08 |
| 2026 Season 2 | 16.9 | 2026-04-29 |
| 2026 Season 3 | 16.17 | 2026-08-26 |

Start dates are Riot's published patch days. A match belongs to the season with the latest first patch at or before the major and minor of its game version, so a game on 16.8 is Season 1 whatever its date. A patch before 16.1 has no season. `seasonForGameVersion` and `currentSeason` in `season-lookup.ts` are the pure mapping; `SeasonsService` (exported by `SeasonsModule`) reads the table and applies them.

Adding a season is an insert, no deploy:

```sql
insert into seasons (name, first_patch, starts_at)
values ('2027 Season 1', '17.1', '2027-01-07T00:00:00Z');
```

## Endpoints

- `GET /api/seasons` returns `SeasonsResponse`: every season, oldest first, the latest one already started marked `current`.
- `GET /api/formats` returns `FormatsResponse`: `6x3` (the default), `8x2` and `irregular`, each with its label and whether it has a ladder.
