import type { FormatSummary, ProfileResponse, SeasonSummary } from '@arena/shared';
import { cache } from 'react';
import { fetchProfile } from '../../../lib/api/profile';
import { fetchFormats, fetchSeasons } from '../../../lib/api/selectors';
import { regionById } from '../../../lib/regions';
import { riotIdFromSegment, riotIdText, type RiotId } from '../../../lib/riot-id';
import { single, type SearchParams } from '../../../lib/search-params';

/** What a profile URL resolves to, shared by the page and its metadata. */
export type ProfileView =
  | { kind: 'profile'; profile: ProfileResponse; formats: FormatSummary[]; seasons: SeasonSummary[] }
  | { kind: 'not-found'; riotId: string }
  | { kind: 'error'; message: string };

// One API call per render even though metadata and the page both ask: a Riot ID
// never seen is resolved at Riot on the way.
const loadProfile = cache((region: string, gameName: string, tagLine: string, format?: string, season?: string) =>
  fetchProfile(region, gameName, tagLine, { format, season }),
);
const loadFormats = cache(fetchFormats);
const loadSeasons = cache(fetchSeasons);

export async function loadProfileView(
  params: Promise<{ region: string; riotId: string }>,
  searchParams: Promise<SearchParams>,
): Promise<ProfileView> {
  const { region, riotId: segment } = await params;
  const query = await searchParams;
  const riotId: RiotId | null = riotIdFromSegment(segment);
  if (!riotId) return { kind: 'not-found', riotId: decodeSafely(segment) };
  if (!regionById(region)) return { kind: 'not-found', riotId: riotIdText(riotId) };

  const [profile, formats, seasons] = await Promise.all([
    loadProfile(region, riotId.gameName, riotId.tagLine, single(query.format), single(query.season)),
    loadFormats(),
    loadSeasons(),
  ]);
  if (!profile.ok) {
    return profile.status === 404
      ? { kind: 'not-found', riotId: riotIdText(riotId) }
      : { kind: 'error', message: profile.message };
  }
  if (!formats.ok) return { kind: 'error', message: formats.message };
  if (!seasons.ok) return { kind: 'error', message: seasons.message };
  return { kind: 'profile', profile: profile.data, formats: formats.data.formats, seasons: seasons.data.seasons };
}

function decodeSafely(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
