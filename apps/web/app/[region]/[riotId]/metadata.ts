import type { Metadata } from 'next';
import { placement, percent, count, rating } from '../../../lib/stats-format';
import { riotIdText } from '../../../lib/riot-id';
import type { ProfileView } from './load';
import type { Standing } from './standing';
import { formatLabel } from '../../../lib/scope';
import { SITE_NAME as SITE } from '../../../lib/site';

/**
 * The profile's title, description, OpenGraph and Twitter tags, so a pasted
 * link previews the player's numbers for the selected format and scope, and
 * their rating and rank when they are ranked there.
 */
export function profileMetadata(view: ProfileView, standing: Standing | null = null): Metadata {
  if (view.kind === 'not-found') return { title: `Player not found · ${SITE}`, robots: { index: false } };
  if (view.kind === 'error') return { title: `Profile unavailable · ${SITE}`, robots: { index: false } };

  const { profile, formats } = view;
  const { totals } = profile;
  const scope = profile.scope.kind === 'all-time' ? 'all-time' : profile.scope.name;
  const title = `${riotIdText(profile.player)} · Arena ${formatLabel(formats, profile.format)}`;
  const ranked = standing?.rating.ranked
    ? `rating ${rating(standing.rating.rating)}, ${standing.rank === null ? 'ranked' : `#${standing.rank} on the ladder`}, `
    : '';
  const stats = `${ranked}${percent(totals.top4Rate)} top 4, average placement ${placement(totals.averagePlacement)}`;
  const description =
    totals.games === 0
      ? `No Arena games in ${scope} yet.`
      : `${count(totals.games, 'game', 'games')} in ${scope}: ${stats}.`;

  return {
    title: `${title} · ${SITE}`,
    description,
    openGraph: { title, description, type: 'profile', siteName: SITE },
    twitter: { card: 'summary', title, description },
  };
}
