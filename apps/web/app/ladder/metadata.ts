import type { Metadata } from 'next';
import { scopeName, formatLabel } from '../../lib/scope';
import { SITE_NAME } from '../../lib/site';
import { count, percent, rating } from '../../lib/stats-format';
import type { LadderView } from './load';

/**
 * The ladder's title, description, OpenGraph and Twitter tags: format, scope
 * and who is on top, so a pasted link says which ladder it is.
 */
export function ladderMetadata(view: LadderView): Metadata {
  if (view.kind === 'error') return { title: `Ladder unavailable · ${SITE_NAME}`, robots: { index: false } };

  const { ladder, formats } = view;
  const title = `Arena ladder · ${formatLabel(formats, ladder.format)} · ${scopeName(ladder.scope)}`;
  const top = ladder.entries[0];
  const leader = top?.player.gameName ? `${top.player.gameName}#${top.player.tagLine}` : 'An unnamed player';
  const description = top
    ? `#1 ${leader}, rating ${rating(top.rating)}, ${percent(top.top4Rate)} top 4 over ${count(top.games, 'game', 'games')}. Brazil server, players with ${ladder.minGames} or more games.`
    : `No player has ${ladder.minGames} games here yet. Brazil server.`;

  return {
    title: `${title} · ${SITE_NAME}`,
    description,
    openGraph: { title, description, type: 'website', siteName: SITE_NAME },
    twitter: { card: 'summary', title, description },
  };
}
