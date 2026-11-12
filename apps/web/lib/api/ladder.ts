import type { LadderPositionResponse, LadderResponse } from '@arena/shared';
import { apiGet, queryString, type ApiResult } from './client';
import type { ProfileQuery } from './profile';

export interface LadderQuery extends ProfileQuery {
  /** Entries per page; the API defaults to 50 and allows up to 100. */
  limit?: string;
  /** The previous page's `nextCursor`. */
  cursor?: string;
}

/** One page of a ladder, highest rating first. */
export function fetchLadder(region: string, query: LadderQuery = {}): Promise<ApiResult<LadderResponse>> {
  return apiGet(`/api/ladders/${encodeURIComponent(region)}${queryString({ ...query })}`);
}

/** Where a tracked player stands on a ladder. A 404 is a Riot ID no match or search has brought in. */
export function fetchLadderPosition(
  region: string,
  gameName: string,
  tagLine: string,
  query: ProfileQuery = {},
): Promise<ApiResult<LadderPositionResponse>> {
  const path = [region, 'players', gameName, tagLine].map(encodeURIComponent).join('/');
  return apiGet(`/api/ladders/${path}${queryString({ format: query.format, season: query.season })}`);
}
