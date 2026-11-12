import type { Metadata } from 'next';
import { RIOT_DISCLAIMER } from '../site-footer';

export const metadata: Metadata = { title: 'About · Arena Ranking' };

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">About</h1>
      <p className="mt-4 text-neutral-700">
        Arena Ranking is a free stats tracker and community ladder for League of Legends Arena on the Brazil server. It
        builds every profile from the player&apos;s full match history and rates players with the Plackett-Luce model
        over team placements.
      </p>
      <h2 className="mt-10 text-lg font-semibold">Legal</h2>
      <p className="mt-2 text-sm leading-relaxed text-neutral-700">{RIOT_DISCLAIMER}</p>
    </main>
  );
}
