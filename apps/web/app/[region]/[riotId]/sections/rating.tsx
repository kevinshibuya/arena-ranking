import type { RatingResponse } from '@arena/shared';
import Link from 'next/link';
import { regionById } from '../../../../lib/regions';
import { formatLabel, hasLadder, scopeName } from '../../../../lib/scope';
import { count, dateTime, rating } from '../../../../lib/stats-format';
import { standingOf } from '../standing';
import { RatingChart } from './rating-chart';
import { scopeQuery, type ProfileSectionProps } from './section-props';

function RankedState({ data, rank, ladderHref, label }: { data: RatingResponse; rank: number | null; ladderHref: string; label: string }) {
  if (data.ranked) {
    return (
      <>
        Ranked {rank !== null && `#${rank} `}on{' '}
        <Link href={ladderHref} prefetch={false} className="underline underline-offset-4">
          the {label} ladder
        </Link>
      </>
    );
  }
  const played = data.games === 0 ? 'no rated game yet' : count(data.games, 'game', 'games');
  return <>Unranked: {played}, {count(data.gamesRemaining, 'more game', 'more games')} to be listed</>;
}

/** The player's rating, where it puts them, and how it moved game by game over the selected scope. */
export async function RatingSection({ profile, formats }: ProfileSectionProps) {
  if (!hasLadder(formats, profile.format)) return null;
  const standing = await standingOf(profile);
  const timeZone = regionById(profile.player.region)?.timeZone ?? 'UTC';
  const heading = (
    <h2 id="rating-heading" className="text-sm font-medium text-neutral-700">
      Rating
    </h2>
  );
  if (!standing.ok) {
    return (
      <section aria-labelledby="rating-heading">
        {heading}
        <p className="mt-2 text-sm text-neutral-600">The rating is unavailable: {standing.message}</p>
      </section>
    );
  }

  const { rating: data, rank } = standing.data;
  const label = formatLabel(formats, data.format);
  const query = scopeQuery(profile);
  const points = data.history.map((point, index) => ({
    game: index + 1,
    rating: point.rating,
    when: dateTime(point.endedAt, timeZone),
  }));

  return (
    <section aria-labelledby="rating-heading">
      {heading}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p data-testid="rating" className="text-3xl font-semibold tabular-nums">
          {rating(data.rating)}
        </p>
        <p data-testid="ranked-state" className="text-sm text-neutral-700">
          <RankedState data={data} rank={rank} label={label} ladderHref={`/ladder?${new URLSearchParams(query)}`} />
        </p>
      </div>
      {points.length > 0 && (
        <figure className="mt-4">
          <figcaption className="sr-only">Rating after each rated game in {scopeName(data.scope)}</figcaption>
          <RatingChart points={points} />
          <table aria-label="Rating history" className="sr-only">
            <thead>
              <tr>
                <th scope="col">Game</th>
                <th scope="col">Ended</th>
                <th scope="col">Rating</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.game}>
                  <td>{point.game}</td>
                  <td>{point.when}</td>
                  <td>{rating(point.rating)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      )}
      <p className="mt-2 text-xs text-neutral-500">
        Recomputed every two hours from every stored match.{' '}
        {data.lastReplayAt ? `Last at ${dateTime(data.lastReplayAt, timeZone)}` : 'Not computed yet'}
        {data.nextReplayAt && `, next at ${dateTime(data.nextReplayAt, timeZone)}`}.
      </p>
    </section>
  );
}
