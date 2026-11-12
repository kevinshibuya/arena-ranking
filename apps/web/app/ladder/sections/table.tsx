'use client';

import type { LadderEntry, LadderResponse } from '@arena/shared';
import Link from 'next/link';
import { useState } from 'react';
import { fetchLadder } from '../../../lib/api/ladder';
import { profilePath } from '../../../lib/riot-id';
import { seasonQuery } from '../../../lib/scope';
import { percent, placement, rating } from '../../../lib/stats-format';
import { useHydrated } from '../../../lib/use-hydrated';

function Player({ entry, region }: { entry: LadderEntry; region: string }) {
  const { gameName, tagLine } = entry.player;
  if (!gameName || !tagLine) return <span className="text-neutral-500">Unnamed player</span>;
  return (
    <Link href={profilePath(region, { gameName, tagLine })} prefetch={false} className="break-words font-medium hover:underline">
      {gameName}#{tagLine}
    </Link>
  );
}

const cell = 'px-2 py-2 sm:px-3';
const wide = 'hidden sm:table-cell';

/**
 * The ladder's rows, the first page from the server; "Load more" appends the
 * next page in place, without leaving the page.
 */
export function LadderTable({ initial, limit, emptyText }: { initial: LadderResponse; limit: string | undefined; emptyText: string }) {
  const [entries, setEntries] = useState(initial.entries);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const hydrated = useHydrated();

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setProblem(null);
    const page = await fetchLadder(initial.region, {
      format: initial.format,
      season: seasonQuery(initial.scope),
      limit,
      cursor,
    });
    setLoading(false);
    if (!page.ok) {
      setProblem(page.message);
      return;
    }
    setEntries((shown) => [...shown, ...page.data.entries]);
    setCursor(page.data.nextCursor);
  }

  if (entries.length === 0) {
    return (
      <p data-testid="ladder-empty" className="rounded-md border border-neutral-200 px-4 py-6 text-neutral-700">
        {emptyText}
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table aria-label="Ladder" className="w-full text-sm">
          <thead className="border-b border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className={`${cell} w-10 text-right`}>
                #
              </th>
              <th scope="col" className={cell}>
                Player
              </th>
              <th scope="col" className={`${cell} text-right`}>
                Rating
              </th>
              <th scope="col" className={`${cell} ${wide} text-right`}>
                Games
              </th>
              <th scope="col" className={`${cell} ${wide} text-right`}>
                Win rate
              </th>
              <th scope="col" className={`${cell} text-right`}>
                Top 4
              </th>
              <th scope="col" className={`${cell} text-right`}>
                Avg
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {entries.map((entry) => (
              <tr key={entry.player.puuid} className="border-b border-neutral-100">
                <td data-testid="rank" className={`${cell} text-right text-neutral-500`}>
                  {entry.rank}
                </td>
                <td className={cell}>
                  <Player entry={entry} region={initial.region} />
                </td>
                <td data-testid="rating" className={`${cell} text-right font-semibold`}>{rating(entry.rating)}</td>
                <td className={`${cell} ${wide} text-right`}>{entry.games}</td>
                <td className={`${cell} ${wide} text-right`}>{percent(entry.winRate)}</td>
                <td className={`${cell} text-right`}>{percent(entry.top4Rate)}</td>
                <td className={`${cell} text-right`}>{placement(entry.averagePlacement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={!hydrated || loading}
          className="mt-4 h-10 rounded-md border border-neutral-300 px-4 text-sm font-medium hover:border-neutral-500 disabled:text-neutral-400"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {problem}
        </p>
      )}
    </div>
  );
}
