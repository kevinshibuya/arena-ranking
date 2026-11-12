import { regionById } from '../../../lib/regions';
import { formatLabel, scopeName } from '../../../lib/scope';
import { dateTime } from '../../../lib/stats-format';
import type { LadderSectionProps } from './section-props';

function When({ iso, timeZone, testId, never }: { iso: string | null; timeZone: string; testId: string; never: string }) {
  return iso ? (
    <time data-testid={testId} dateTime={iso} className="tabular-nums text-neutral-700">
      {dateTime(iso, timeZone)}
    </time>
  ) : (
    <span data-testid={testId}>{never}</span>
  );
}

/** Which ladder this is, who gets listed, and when it was and will next be computed. */
export function LadderHeader({ ladder, formats }: LadderSectionProps) {
  const region = regionById(ladder.region);
  const timeZone = region?.timeZone ?? 'UTC';
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ladder</h1>
      <p className="mt-1 text-neutral-600">
        {formatLabel(formats, ladder.format)}, {scopeName(ladder.scope)}, {region?.label ?? ladder.region} server.
        Players with {ladder.minGames} or more games, highest rating first.
      </p>
      <p className="mt-2 text-sm text-neutral-500">
        Last updated <When iso={ladder.lastReplayAt} timeZone={timeZone} testId="last-update" never="not yet" />
        {' · '}
        next update <When iso={ladder.nextReplayAt} timeZone={timeZone} testId="next-update" never="not scheduled" />
      </p>
    </header>
  );
}
