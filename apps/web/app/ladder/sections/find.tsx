'use client';

import type { LadderPositionResponse } from '@arena/shared';
import Link from 'next/link';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { parseRiotId, profilePath, riotIdText, type RiotId } from '../../../lib/riot-id';
import { count, rating } from '../../../lib/stats-format';
import { useHydrated } from '../../../lib/use-hydrated';
import { findOnLadder, type FindResult } from './find-action';

function standing(position: LadderPositionResponse): string {
  if (position.ranked) return `is #${position.rank} on this ladder, rating ${rating(position.rating)}.`;
  const played = position.games === 0 ? 'no game here yet' : count(position.games, 'game', 'games');
  return `is unranked: ${played}, ${count(position.gamesRemaining, 'more game', 'more games')} to be listed.`;
}

/** Finds a Riot ID on this ladder: their rank, or how many games they still need. */
export function FindOnLadder({ region, format, season }: { region: string; format: string; season: string }) {
  const [result, setResult] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const hydrated = useHydrated();

  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get('riotId');
    const parsed = parseRiotId(typeof input === 'string' ? input : '');
    if (!parsed.ok) {
      setResult(parsed.problem);
      return;
    }
    setBusy(true);
    const { gameName, tagLine } = parsed.riotId;
    const found = await findOnLadder(region, parsed.riotId, format, season).catch(
      (): FindResult => ({ kind: 'error', message: 'The stats server did not answer.' }),
    );
    setBusy(false);
    if (found.kind === 'found') {
      const { player } = found.position;
      const riotId: RiotId = { gameName: player.gameName ?? gameName, tagLine: player.tagLine ?? tagLine };
      setResult(
        <>
          <Link href={profilePath(region, riotId)} prefetch={false} className="font-medium underline underline-offset-4">
            {riotIdText(riotId)}
          </Link>{' '}
          {standing(found.position)}
        </>,
      );
    } else if (found.kind === 'untracked') {
      setResult(`${riotIdText(parsed.riotId)} isn't tracked yet. Search them on the home page to add them.`);
    } else {
      setResult(found.message);
    }
  }

  return (
    <form onSubmit={find} noValidate className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-neutral-700">
        Find a Riot ID on this ladder
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          name="riotId"
          type="text"
          placeholder="Name#TAG"
          autoComplete="off"
          spellCheck={false}
          className="h-10 min-w-0 flex-1 rounded-md border border-neutral-300 px-3 text-base"
        />
        <button type="submit" disabled={!hydrated || busy} className="h-10 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white">
          Find
        </button>
      </div>
      <p role="status" data-testid="find-result" className="min-h-5 text-sm text-neutral-700">
        {result}
      </p>
    </form>
  );
}
