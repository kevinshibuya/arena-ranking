'use client';

import type { MatchesResponse, MatchSummary } from '@arena/shared';
import Link from 'next/link';
import { useState } from 'react';
import { fetchMatches } from '../../../../lib/api/breakdowns';
import { profilePath, riotIdText } from '../../../../lib/riot-id';
import { dateTime, duration, ordinal } from '../../../../lib/stats-format';
import { ChampionIcon, championName } from './champion-icon';

interface MatchListProps {
  region: string;
  timeZone: string;
  gameName: string;
  tagLine: string;
  scope: { format: string; season: string };
  firstPage: MatchesResponse;
}

function MatchRow({ match, region, timeZone, query }: { match: MatchSummary; region: string; timeZone: string; query: string }) {
  return (
    <li data-testid="match" className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
      <span
        className={`w-10 shrink-0 font-semibold tabular-nums ${match.placement === 1 ? 'text-amber-700' : match.placement <= 4 ? 'text-sky-800' : 'text-neutral-500'}`}
      >
        {ordinal(match.placement)}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <ChampionIcon champion={match.champion} size={32} />
        <span className="min-w-0">
          <span className="block font-medium">{championName(match.champion)}</span>
          {match.teammates.length > 0 && (
            <span className="block break-words text-xs text-neutral-500">
              with{' '}
              {match.teammates.map((mate, index) => (
                <span key={mate.puuid}>
                  {index > 0 && ', '}
                  {mate.gameName && mate.tagLine ? (
                    <Link
                      href={profilePath(region, { gameName: mate.gameName, tagLine: mate.tagLine }, query)}
                      className="text-sky-800 hover:underline"
                    >
                      {riotIdText({ gameName: mate.gameName, tagLine: mate.tagLine })}
                    </Link>
                  ) : (
                    'Unknown player'
                  )}{' '}
                  ({championName(mate.champion)})
                </span>
              ))}
            </span>
          )}
        </span>
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums text-neutral-500">
        <span className="block">{duration(match.durationSeconds)}</span>
        <time dateTime={match.startedAt} className="block">
          {dateTime(match.startedAt, timeZone)}
        </time>
      </span>
    </li>
  );
}

/** The first page from the server, later pages fetched in the browser on "Load more". */
export function MatchList({ region, timeZone, gameName, tagLine, scope, firstPage }: MatchListProps) {
  const [matches, setMatches] = useState(firstPage.matches);
  const [cursor, setCursor] = useState(firstPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const query = `?${new URLSearchParams(scope)}`;

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setProblem(null);
    const result = await fetchMatches(region, gameName, tagLine, { ...scope, cursor });
    setLoading(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setMatches((shown) => [...shown, ...result.data.matches]);
    setCursor(result.data.nextCursor);
  }

  return (
    <>
      <ol className="mt-1 divide-y divide-neutral-100">
        {matches.map((match) => (
          <MatchRow key={match.matchId} match={match} region={region} timeZone={timeZone} query={query} />
        ))}
      </ol>
      {problem && <p className="mt-2 text-sm text-red-700">Could not load more: {problem}</p>}
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="mt-3 rounded-full border border-neutral-300 px-4 py-1.5 text-sm text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  );
}
