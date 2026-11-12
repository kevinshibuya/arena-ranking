import { Suspense } from 'react';
import { fetchChampions } from '../../../../lib/api/breakdowns';
import { placement, percent } from '../../../../lib/stats-format';
import { ChampionIcon, championName } from './champion-icon';
import { SectionLoading } from './section-loading';
import { scopeKey, scopeQuery, type ProfileSectionProps } from './section-props';

/** Per-champion games, wins, top-4 rate and average placement, most played first. */
async function ChampionsBody({ profile }: ProfileSectionProps) {
  const result = await fetchChampions(profile.player.region, profile.player.gameName, profile.player.tagLine, scopeQuery(profile));

  return (
    <>
      {!result.ok ? (
        <p className="mt-3 text-sm text-neutral-600">Champions unavailable: {result.message}</p>
      ) : result.data.champions.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-600">No games in this format and season.</p>
      ) : (
        <table data-testid="champions" className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-neutral-500">
            <tr className="border-b border-neutral-200">
              <th scope="col" className="py-2 font-normal">
                Champion
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Games
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Wins
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Top 4
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Avg
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {result.data.champions.map((row) => (
              <tr key={row.champion.id} className="border-b border-neutral-100">
                <th scope="row" className="py-2 pr-2 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <ChampionIcon champion={row.champion} />
                    <span className="min-w-0 break-words">{championName(row.champion)}</span>
                  </span>
                </th>
                <td className="py-2 text-right">{row.games}</td>
                <td className="py-2 text-right">{row.wins}</td>
                <td className="py-2 text-right">{percent(row.top4Rate)}</td>
                <td className="py-2 text-right">{placement(row.averagePlacement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
export function ChampionsSection(props: ProfileSectionProps) {
  return (
    <section aria-labelledby="champions-heading">
      <h2 id="champions-heading" className="text-sm font-medium text-neutral-700">
        Champions
      </h2>
      <Suspense key={scopeKey(props.profile)} fallback={<SectionLoading />}>
        <ChampionsBody {...props} />
      </Suspense>
    </section>
  );
}
