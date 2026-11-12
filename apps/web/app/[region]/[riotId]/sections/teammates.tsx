import type { TeammateStats } from '@arena/shared';
import Link from 'next/link';
import { Suspense } from 'react';
import { fetchTeammates } from '../../../../lib/api/breakdowns';
import { profilePath, riotIdText } from '../../../../lib/riot-id';
import { percent } from '../../../../lib/stats-format';
import { SectionLoading } from './section-loading';
import { scopeKey, scopeQuery, type ProfileSectionProps } from './section-props';

const SHOWN = 10;

function Rows({ rows, region, query }: { rows: TeammateStats[]; region: string; query: string }) {
  return (
    <ul className="divide-y divide-neutral-100">
      {rows.map((row) => (
        <li key={row.puuid} className="flex items-baseline justify-between gap-3 py-2 text-sm">
          {row.gameName && row.tagLine ? (
            <Link
              href={profilePath(region, { gameName: row.gameName, tagLine: row.tagLine }, query)}
              className="min-w-0 break-words text-sky-800 hover:underline"
            >
              {riotIdText({ gameName: row.gameName, tagLine: row.tagLine })}
            </Link>
          ) : (
            <span className="min-w-0 text-neutral-500">Unknown player</span>
          )}
          <span className="shrink-0 tabular-nums text-neutral-600">
            {row.games} {row.games === 1 ? 'game' : 'games'} · {row.wins} {row.wins === 1 ? 'win' : 'wins'} ·{' '}
            {percent(row.top4Rate)} top 4
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Who shared the player's subteam, most games together first; each links to their profile. */
async function TeammatesBody({ profile }: ProfileSectionProps) {
  const scope = scopeQuery(profile);
  const result = await fetchTeammates(profile.player.region, profile.player.gameName, profile.player.tagLine, scope);
  const query = `?${new URLSearchParams(scope)}`;

  return (
    <>
      {!result.ok ? (
        <p className="mt-3 text-sm text-neutral-600">Teammates unavailable: {result.message}</p>
      ) : result.data.teammates.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-600">No games in this format and season.</p>
      ) : (
        <div data-testid="teammates" className="mt-1">
          <Rows rows={result.data.teammates.slice(0, SHOWN)} region={profile.player.region} query={query} />
          {result.data.teammates.length > SHOWN && (
            <details className="mt-1">
              <summary className="cursor-pointer py-2 text-sm text-neutral-600 hover:text-neutral-900">
                {result.data.teammates.length - SHOWN} more
              </summary>
              <Rows rows={result.data.teammates.slice(SHOWN)} region={profile.player.region} query={query} />
            </details>
          )}
        </div>
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
export function TeammatesSection(props: ProfileSectionProps) {
  return (
    <section aria-labelledby="teammates-heading">
      <h2 id="teammates-heading" className="text-sm font-medium text-neutral-700">
        Teammates
      </h2>
      <Suspense key={scopeKey(props.profile)} fallback={<SectionLoading />}>
        <TeammatesBody {...props} />
      </Suspense>
    </section>
  );
}
