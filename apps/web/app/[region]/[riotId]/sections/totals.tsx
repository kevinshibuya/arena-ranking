import { placement, percent } from '../../../../lib/stats-format';
import type { ProfileSectionProps } from './section-props';

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border border-neutral-200 px-4 py-3">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd data-testid={testId} className="mt-1 text-2xl font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/** Totals for the selected format and scope, and how the placements spread. */
export function TotalsSection({ profile }: ProfileSectionProps) {
  const { totals } = profile;
  const most = Math.max(1, ...totals.placements.map((row) => row.games));

  return (
    <section aria-labelledby="totals-heading">
      <h2 id="totals-heading" className="sr-only">
        Totals
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Games" value={String(totals.games)} testId="games" />
        <Stat label="Wins (1st)" value={String(totals.wins)} testId="wins" />
        <Stat label="Top 4" value={percent(totals.top4Rate)} testId="top4-rate" />
        <Stat label="Avg placement" value={placement(totals.averagePlacement)} testId="average-placement" />
      </dl>

      <figure className="mt-6">
        <figcaption className="text-sm font-medium text-neutral-700">Placements</figcaption>
        <div aria-hidden="true" className="mt-3 flex h-40 items-end gap-0.5">
          {totals.placements.map((row) => (
            <div key={row.placement} className="group relative flex h-full flex-1 flex-col justify-end">
              <span className="mb-1 text-center text-xs tabular-nums text-neutral-600">{row.games}</span>
              <div
                title={`${row.games} games placed ${row.placement}`}
                className="rounded-t bg-sky-700 group-hover:bg-sky-900"
                style={{ height: `${(row.games / most) * 100}%`, minHeight: row.games > 0 ? 2 : 0 }}
              />
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="mt-1 flex gap-0.5 border-t border-neutral-300 pt-1">
          {totals.placements.map((row) => (
            <span key={row.placement} className="flex-1 text-center text-xs text-neutral-500">
              {row.placement}
            </span>
          ))}
        </div>
        <table className="sr-only">
          <thead>
            <tr>
              <th scope="col">Placement</th>
              <th scope="col">Games</th>
            </tr>
          </thead>
          <tbody>
            {totals.placements.map((row) => (
              <tr key={row.placement}>
                <td>{row.placement}</td>
                <td>{row.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    </section>
  );
}
