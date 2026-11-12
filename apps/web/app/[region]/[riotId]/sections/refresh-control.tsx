'use client';

import type { RefreshResponse } from '@arena/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fetchRefreshState, requestRefresh } from '../../../../lib/api/refresh';
import { dateTime, duration } from '../../../../lib/stats-format';
import { useHydrated } from '../../../../lib/use-hydrated';

const POLL_MS = 2000;
/** How long the control waits for a queued sync before it stops looking. */
const WAIT_MS = 120_000;

interface RefreshControlProps {
  player: { region: string; gameName: string; tagLine: string };
  timeZone: string;
  initial: RefreshResponse;
}

/**
 * The button and what it says around it. The countdown runs in the browser from
 * the seconds the API last reported. After a queued sync it asks for the last
 * update until it moves, then re-renders the page from the server.
 */
export function RefreshControl({ player, timeZone, initial }: RefreshControlProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [lastSyncedAt, setLastSyncedAt] = useState(initial.lastSyncedAt);
  const [cooldown, setCooldown] = useState(initial.cooldownSeconds);
  // A new object restarts the countdown from its seconds.
  const [countdown, setCountdown] = useState({ seconds: initial.cooldownSeconds });
  // The last update when a sync was queued, while waiting for it to move.
  const [awaiting, setAwaiting] = useState<{ since: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { region, gameName, tagLine } = player;

  useEffect(() => {
    if (countdown.seconds <= 0) return;
    const until = Date.now() + countdown.seconds * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setCooldown(left);
      if (left === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (!awaiting) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const giveUpAt = Date.now() + WAIT_MS;
    const poll = async () => {
      const state = await fetchRefreshState(region, gameName, tagLine);
      if (stopped) return;
      if (state.ok && state.data.lastSyncedAt !== awaiting.since) {
        setLastSyncedAt(state.data.lastSyncedAt);
        setAwaiting(null);
        router.refresh();
      } else if (Date.now() > giveUpAt) {
        setAwaiting(null);
      } else {
        timer = setTimeout(poll, POLL_MS);
      }
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [awaiting, region, gameName, tagLine, router]);

  async function refresh() {
    setBusy(true);
    setNote(null);
    const result = await requestRefresh(region, gameName, tagLine);
    setBusy(false);
    if (!result.ok) {
      setNote(`Could not update: ${result.message}`);
      return;
    }
    const answer = result.data;
    setLastSyncedAt(answer.lastSyncedAt);
    setCooldown(answer.cooldownSeconds);
    setCountdown({ seconds: answer.cooldownSeconds });
    if (answer.queued) setAwaiting({ since: answer.lastSyncedAt });
    else if (answer.refused === 'rate-limited') setNote(`Too many updates from here; try again in ${duration(answer.retryAfterSeconds ?? 60)}.`);
    else if (!answer.refused) setNote('This profile is already syncing.');
  }

  return (
    <div className="flex flex-col items-start gap-1 text-sm sm:items-end">
      <button
        type="button"
        onClick={refresh}
        disabled={!hydrated || busy || cooldown > 0}
        className="rounded-full border border-neutral-300 px-4 py-1.5 text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
      >
        Update now
      </button>
      <p data-testid="last-updated" className="text-xs text-neutral-500">
        {lastSyncedAt ? (
          <>
            Last updated <time dateTime={lastSyncedAt}>{dateTime(lastSyncedAt, timeZone)}</time>
          </>
        ) : (
          'Not updated yet'
        )}
        {awaiting && ', updating…'}
      </p>
      {cooldown > 0 && (
        <p data-testid="refresh-cooldown" className="text-xs tabular-nums text-neutral-500">
          Available again in {duration(cooldown)}
        </p>
      )}
      {note && <p className="text-xs text-neutral-700">{note}</p>}
    </div>
  );
}
