# Web app

`apps/web`, Next.js app router with Tailwind. Every page is server-rendered; the browser talks only to the web app.

## Pages

| Path | Page |
| --- | --- |
| `/` | Search by Riot ID (`Name#TAG`), Brazil the only region, and a link to the default ladder |
| `/<region>/<gameName>-<tagLine>` | A profile, e.g. `/br/Player0001-ANON`; `?format=<format id>&season=<season id or all>` scopes it |
| `/ladder` | The Brazil ladder; `?format=&season=` scope it as on a profile, `&limit=` sets the page size (the API's 50 by default) |
| `/about` | What the site is, and Riot's full disclaimer |

Every page ends with the footer: the short Riot disclaimer and a link to `/about`.

The search checks the input in the page and navigates to the profile. Submitted before the page hydrates, it arrives at `/?riotId=…&region=…` and the server does the same. A malformed Riot ID is explained under the box.

## Talking to the API

`next.config.ts` rewrites `/api/*` to `API_INTERNAL_URL`, so only the web container is exposed. The fetch helpers live in `lib/api/`, one file per domain:

| File | Endpoints |
| --- | --- |
| `profile.ts` | `fetchProfile(region, gameName, tagLine, { format, season })` |
| `selectors.ts` | `fetchFormats()`, `fetchSeasons()` |
| `breakdowns.ts` | `fetchChampions`, `fetchTeammates`, `fetchMatches(region, gameName, tagLine, { format, season, cursor? })` |
| `ladder.ts` | `fetchLadder(region, { format, season, limit, cursor })`, `fetchLadderPosition(region, gameName, tagLine, { format, season })` |
| `rating.ts` | `fetchRating(region, gameName, tagLine, { format, season })` |
| `refresh.ts` | `fetchRefreshState(region, gameName, tagLine)`, `requestRefresh(region, gameName, tagLine)` (a POST; its 429 is an answer) |

Each is built on `apiGet(path)` or `apiPost(path, answers)` from `lib/api/client.ts`, which answers `{ ok: true, data }` or `{ ok: false, status, message }` with the API's message. On the server it calls `API_INTERNAL_URL` directly; in the browser it calls `/api/…` on the web app.

## Profile

`app/[region]/[riotId]/`:

- `page.tsx` composes the sections and nothing else.
- `load.ts` resolves the URL to a profile, a not-found or an error, once per render for both the page and its metadata. The API answers tracked players from Postgres and resolves only a Riot ID never seen at Riot.
- `metadata.ts` builds the title, description, OpenGraph and Twitter tags: Riot ID, format label, games, top-4 rate and average placement.
- `metadata.ts` adds the rating and the ladder rank when the player is ranked in the selected format and scope.
- `standing.ts` loads the rating and, when ranked, the rank, once per render for both the rating section and the metadata.
- `sections/`, one file per section, each taking `ProfileSectionProps` (`profile`, `formats`, `seasons`): `header`, `refresh`, `sync-banner`, `selectors`, `totals`, `rating`, `champions`, `teammates`, `matches`. `scopeQuery(profile)` gives the page's format and season as query values for a section's own API call.

The format and season selectors are links built from the formats and seasons endpoints, so the selection is always in the URL. With no query the API's defaults apply: `6x3` and the current season.

The rating section shows for a format with a ladder: the rating, ranked with the rank and a link to the ladder or unranked with the games still needed, and a Recharts line of the rating after each rated game in the scope, with the same points in a screen-reader table. Times are written in the region's time zone (`lib/regions.ts`).

The sync banner shows whenever the sync state is not `complete`, naming what is missing. While the state is `primary-syncing` the page re-renders from the server (`router.refresh()`) 3 seconds after the last re-render landed, so the numbers fill in without a reload. It waits for the last one because a refresh started mid-render replaces it: on a fixed interval, a render slower than the interval would never show.

A Riot ID that does not resolve, and a player with no Arena game in any season once every season has been listed, each render their own message.

The refresh section, beside the header, reads the refresh state on the server and hands it to `refresh-control.tsx`: an "Update now" button, the last update in the region's time zone, and while the cooldown runs "Available again in m:ss", counted down in the browser with the button disabled. The button stays disabled until the page hydrates. After a queued sync it asks for the refresh state every 2 seconds until the last update moves, for up to two minutes, then re-renders the page from the server.

## Breakdowns

`champions`, `teammates` and `matches` each fetch their own endpoint by the profile's Riot ID, scoped like the page, while the page renders on the server:

- Champions: a table of games, wins, top-4 rate and average placement per champion, most played first.
- Teammates: the ten with the most games together, the rest behind a "more" disclosure. Each links to the teammate's profile with the page's format and season.
- Matches: the first 20 games from the server, newest first; "Load more" (`match-list.tsx`, a client component) fetches the next page through `/api` with the last cursor. Times are shown in the region's time zone (`lib/regions.ts`), so server and browser render the same text. A server re-render starts the list over.

Champion icons are plain `<img>`s pointing at Data Dragon, on a grey tile that stays when the image does not load. The smoke fixtures block every non-local host and forgive only the console error for an image they blocked themselves, so a section that needs its images fails the smoke.

## Ladder

`app/ladder/` follows the profile's layout: `page.tsx` composes, `load.ts` resolves the query once per render, `metadata.ts` builds the tags, and `sections/` holds `header` (which ladder, who is listed, last and next update), `selectors`, `find` and `table`.

- The format and season choices are the profile's (`app/scope-choices.tsx`), limited to formats with a ladder, and keep `limit`.
- `table` is a client component: the first page comes from the server, "Load more" fetches the next page by cursor through `/api` and appends it without leaving the page. A new format, season or limit remounts it.
- `find` looks a Riot ID up through a server action (`find-action.ts`), so an untracked Riot ID is an answer and not a failed request in the browser's console. It reports the rank and rating, the games still needed, or that the Riot ID is not tracked.
- Both stay disabled until the page hydrates (`lib/use-hydrated.ts`).

## Link previews

Next streams metadata into `<body>` for browsers, but serves it in `<head>` to crawlers that read no JavaScript, Discord's and Twitter's among them. The ladder's tags carry the format, the scope and the top entry. `pnpm smoke:og` runs the replay, then fetches a profile and the ladder as Discordbot and checks the tags in `<head>`.
