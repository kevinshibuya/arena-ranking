import type { FormatSummary, ProfileResponse, SeasonSummary } from '@arena/shared';
import { seasonQuery } from '../../../../lib/scope';

/** What the profile page hands every section. */
export interface ProfileSectionProps {
  profile: ProfileResponse;
  formats: FormatSummary[];
  seasons: SeasonSummary[];
}

/** The profile's format and scope as query values, for links and API calls scoped like the page. */
export function scopeQuery(profile: ProfileResponse): { format: string; season: string } {
  return { format: profile.format, season: seasonQuery(profile.scope) };
}

/** One string per format and scope, to key what must start over when either changes. */
export function scopeKey(profile: ProfileResponse): string {
  const { format, season } = scopeQuery(profile);
  return `${format}|${season}`;
}
