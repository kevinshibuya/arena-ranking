import type { FormatSummary, LadderResponse, SeasonSummary } from '@arena/shared';
import { cache } from 'react';
import { fetchLadder } from '../../lib/api/ladder';
import { fetchFormats, fetchSeasons } from '../../lib/api/selectors';
import { DEFAULT_REGION } from '../../lib/regions';
import { single, type SearchParams } from '../../lib/search-params';

/** What a ladder URL resolves to, shared by the page and its metadata. */
export type LadderView =
  | {
      kind: 'ladder';
      ladder: LadderResponse;
      formats: FormatSummary[];
      seasons: SeasonSummary[];
      /** The `limit` query, kept for load-more and the selector links. */
      limit: string | undefined;
    }
  | { kind: 'error'; message: string };

const loadLadder = cache((format?: string, season?: string, limit?: string) =>
  fetchLadder(DEFAULT_REGION, { format, season, limit }),
);
const loadFormats = cache(fetchFormats);
const loadSeasons = cache(fetchSeasons);

export async function loadLadderView(searchParams: Promise<SearchParams>): Promise<LadderView> {
  const query = await searchParams;
  const limit = single(query.limit);
  const [ladder, formats, seasons] = await Promise.all([
    loadLadder(single(query.format), single(query.season), limit),
    loadFormats(),
    loadSeasons(),
  ]);
  if (!ladder.ok) return { kind: 'error', message: ladder.message };
  if (!formats.ok) return { kind: 'error', message: formats.message };
  if (!seasons.ok) return { kind: 'error', message: seasons.message };
  return {
    kind: 'ladder',
    ladder: ladder.data,
    formats: formats.data.formats.filter((format) => format.ladder),
    seasons: seasons.data.seasons,
    limit,
  };
}
