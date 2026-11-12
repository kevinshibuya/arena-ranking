import type { FormatsResponse, SeasonsResponse } from '@arena/shared';
import { apiGet, type ApiResult } from './client';

/** The formats for selectors and labels, the default one marked. */
export function fetchFormats(): Promise<ApiResult<FormatsResponse>> {
  return apiGet('/api/formats');
}

/** The seasons for selectors, oldest first, the current one marked. */
export function fetchSeasons(): Promise<ApiResult<SeasonsResponse>> {
  return apiGet('/api/seasons');
}
