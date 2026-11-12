import type { ProfileResponse } from '@arena/shared';
import { apiGet, queryString, type ApiResult } from './client';

export interface ProfileQuery {
  /** A format id; the API defaults to 6x3. */
  format?: string;
  /** A season id or `all`; the API defaults to the current season. */
  season?: string;
}

/** A profile by Riot ID. A 404 is a Riot ID that does not resolve. */
export function fetchProfile(
  region: string,
  gameName: string,
  tagLine: string,
  query: ProfileQuery = {},
): Promise<ApiResult<ProfileResponse>> {
  const path = [region, gameName, tagLine].map(encodeURIComponent).join('/');
  return apiGet(`/api/profiles/${path}${queryString({ format: query.format, season: query.season })}`);
}
