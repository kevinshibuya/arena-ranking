import type { FormatSummary, LadderResponse, SeasonSummary } from '@arena/shared';
import { seasonQuery } from '../../../lib/scope';

/** What the ladder page hands every section. */
export interface LadderSectionProps {
  ladder: LadderResponse;
  /** Formats with a ladder. */
  formats: FormatSummary[];
  seasons: SeasonSummary[];
  limit: string | undefined;
}

/** The ladder's format, scope and page size as query values, for links and API calls scoped like the page. */
export function ladderQuery({ ladder, limit }: Pick<LadderSectionProps, 'ladder' | 'limit'>): {
  format: string;
  season: string;
  limit: string | undefined;
} {
  return { format: ladder.format, season: seasonQuery(ladder.scope), limit };
}
