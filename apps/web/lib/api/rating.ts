import type { RatingResponse } from '@arena/shared';
import { apiGet, queryString, type ApiResult } from './client';
import type { ProfileQuery } from './profile';

/** A player's rating, ranked state and rating history for one format and scope. */
export function fetchRating(
  region: string,
  gameName: string,
  tagLine: string,
  query: ProfileQuery = {},
): Promise<ApiResult<RatingResponse>> {
  const path = [region, gameName, tagLine].map(encodeURIComponent).join('/');
  return apiGet(`/api/profiles/${path}/rating${queryString({ format: query.format, season: query.season })}`);
}
