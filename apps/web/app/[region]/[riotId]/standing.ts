import type { ProfileResponse, RatingResponse } from '@arena/shared';
import { cache } from 'react';
import type { ApiResult } from '../../../lib/api/client';
import { fetchLadderPosition } from '../../../lib/api/ladder';
import { fetchRating } from '../../../lib/api/rating';
import { hasLadder } from '../../../lib/scope';
import type { ProfileView } from './load';
import { scopeQuery } from './sections/section-props';

/** A player's rating in the profile's format and scope, and their rank when ranked. */
export interface Standing {
  rating: RatingResponse;
  /** Null when unranked, or when the ladder could not say. */
  rank: number | null;
}

// Once per render for both the rating section and the page's metadata.
const loadStanding = cache(
  async (region: string, gameName: string, tagLine: string, format: string, season: string): Promise<ApiResult<Standing>> => {
    const rating = await fetchRating(region, gameName, tagLine, { format, season });
    if (!rating.ok) return rating;
    if (!rating.data.ranked) return { ok: true, data: { rating: rating.data, rank: null } };
    const position = await fetchLadderPosition(region, gameName, tagLine, { format, season });
    const rank = position.ok && position.data.ranked ? position.data.rank : null;
    return { ok: true, data: { rating: rating.data, rank } };
  },
);

/** The profile's standing. Call only for a format with a ladder. */
export function standingOf(profile: ProfileResponse): Promise<ApiResult<Standing>> {
  const { region, gameName, tagLine } = profile.player;
  const { format, season } = scopeQuery(profile);
  return loadStanding(region, gameName, tagLine, format, season);
}

/** The standing a profile's link preview names: null when there is no profile, no ladder or no answer. */
export async function standingForPreview(view: ProfileView): Promise<Standing | null> {
  if (view.kind !== 'profile' || !hasLadder(view.formats, view.profile.format)) return null;
  const standing = await standingOf(view.profile);
  return standing.ok ? standing.data : null;
}
