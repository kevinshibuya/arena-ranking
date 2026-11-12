import type { RefreshResponse } from '@arena/shared';
import { apiGet, apiPost, type ApiResult } from './client';

function refreshPath(region: string, gameName: string, tagLine: string): string {
  return `/api/profiles/${[region, gameName, tagLine].map(encodeURIComponent).join('/')}/refresh`;
}

/** The profile's cooldown left and its last update. A 404 is a player nobody has seen. */
export function fetchRefreshState(region: string, gameName: string, tagLine: string): Promise<ApiResult<RefreshResponse>> {
  return apiGet(refreshPath(region, gameName, tagLine));
}

/** Update now. A refusal (429) is an answer too: `refused` says why, with the time to wait. */
export function requestRefresh(region: string, gameName: string, tagLine: string): Promise<ApiResult<RefreshResponse>> {
  return apiPost(refreshPath(region, gameName, tagLine), [429]);
}
