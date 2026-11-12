import { Suspense } from 'react';
import { fetchMatches } from '../../../../lib/api/breakdowns';
import { regionById } from '../../../../lib/regions';
import { MatchList } from './match-list';
import { SectionLoading } from './section-loading';
import { scopeKey, scopeQuery, type ProfileSectionProps } from './section-props';

/** The player's games, newest first, a page at a time. */
async function MatchesBody({ profile }: ProfileSectionProps) {
  const { region, gameName, tagLine } = profile.player;
  const scope = scopeQuery(profile);
  const result = await fetchMatches(region, gameName, tagLine, scope);
  const first = result.ok ? result.data : null;

  return (
    <>
      {!first ? (
        <p className="mt-3 text-sm text-neutral-600">Matches unavailable: {!result.ok && result.message}</p>
      ) : first.matches.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-600">No games in this format and season.</p>
      ) : (
        <MatchList
          // A server re-render (while syncing, or a new scope) starts the list over from its new first page.
          key={`${scope.format}|${scope.season}|${first.matches[0]!.matchId}|${first.matches.length}`}
          region={region}
          timeZone={regionById(region)?.timeZone ?? 'UTC'}
          gameName={gameName}
          tagLine={tagLine}
          scope={scope}
          firstPage={first}
        />
      )}
    </>
  );
}

/**
 * Streams in after the page, so a slow breakdown never holds up the totals or a
 * navigation. The boundary is keyed by scope: a navigation is a transition, which
 * keeps showing a boundary's old content until the new one is ready, so only a new
 * boundary lets a scope change land at once. A poll's refresh keeps the key and
 * swaps the section in place.
 */
export function MatchesSection(props: ProfileSectionProps) {
  return (
    <section aria-labelledby="matches-heading">
      <h2 id="matches-heading" className="text-sm font-medium text-neutral-700">
        Matches
      </h2>
      <Suspense key={scopeKey(props.profile)} fallback={<SectionLoading />}>
        <MatchesBody {...props} />
      </Suspense>
    </section>
  );
}
