// The queue ids Arena matches are listed under, the default for ARENA_QUEUE_IDS.
// Riot's published queue list names only 1700 and 1710, and live matches use
// unpublished ids as well, so every listing runs once per id here and the format
// comes from the lobby shape, never from the id.
//
//   1700  Arena; carried 8x2 lobbies of 16 in 2026 Season 2 (game version 16.9, May 2026)
//   1710  Arena, 16-player lobby by Riot's list; no match seen under it in 2026
//   1740  6x3 lobbies of 18 from game version 16.16 (August 2026, end of Season 2) into Season 3
//   1750  the same, 6x3 lobbies of 18 from 16.16 on; what sets it apart from 1740 is not known
//
// Seen in Player0001#ANON's matches recorded on 2026-10-09. A new id is found with
// `pnpm riot:queues <Name#TAG>` and added through the variable, no deploy.

export const DEFAULT_ARENA_QUEUE_IDS: readonly number[] = [1700, 1710, 1740, 1750];
