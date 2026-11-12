import type { ChampionsResponse, MatchesResponse, TeammatesResponse } from '@arena/shared';
import { apiGet, queryString, type ApiResult } from './client';
import type { ProfileQuery } from './profile';

function playerPath(region: string, gameName: string, tagLine: string, breakdown: string): string {
  return `/api/profiles/${[region, gameName, tagLine].map(encodeURIComponent).join('/')}/${breakdown}`;
}

/** Per-champion games, wins, top-4 rate and average placement, most played first. */
export function fetchChampions(region: string, gameName: string, tagLine: string, query: ProfileQuery = {}): Promise<ApiResult<ChampionsResponse>> {
  return apiGet(`${playerPath(region, gameName, tagLine, 'champions')}${queryString({ format: query.format, season: query.season })}`);
}

/** Subteam mates and the results together, most games together first. */
export function fetchTeammates(region: string, gameName: string, tagLine: string, query: ProfileQuery = {}): Promise<ApiResult<TeammatesResponse>> {
  return apiGet(`${playerPath(region, gameName, tagLine, 'teammates')}${queryString({ format: query.format, season: query.season })}`);
}

/** One page of games, newest first; pass the previous page's `nextCursor` for the next. */
export function fetchMatches(
  region: string,
  gameName: string,
  tagLine: string,
  query: ProfileQuery & { cursor?: string } = {},
): Promise<ApiResult<MatchesResponse>> {
  return apiGet(
    `${playerPath(region, gameName, tagLine, 'matches')}${queryString({ format: query.format, season: query.season, cursor: query.cursor })}`,
  );
}
