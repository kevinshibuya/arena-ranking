'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

const POLL_MS = 3000;

/**
 * Re-renders the page from the server a few seconds after the last re-render
 * landed, while mounted. Waiting for it matters: a refresh started while one is
 * still rendering replaces it, so on a fixed interval a render slower than the
 * interval would never show.
 */
export function PollWhileSyncing() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  useEffect(() => {
    if (refreshing) return;
    const timer = setTimeout(() => startTransition(() => router.refresh()), POLL_MS);
    return () => clearTimeout(timer);
  }, [refreshing, router]);
  return null;
}
