import type { ReactNode } from 'react';

// The pages a profile URL renders when there is no profile to show.

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-3 text-neutral-600">{children}</div>
    </main>
  );
}

export function NotFoundState({ riotId }: { riotId: string }) {
  return (
    <Message title="Player not found">
      <p data-testid="not-found">
        No account named <strong className="font-medium text-neutral-900">{riotId}</strong> on the Brazil server. Check
        the name and the tag after the #.
      </p>
    </Message>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Message title="Profile unavailable">
      <p>{message}</p>
      <p className="mt-2">Try again in a moment.</p>
    </Message>
  );
}

/** In place of the stats, for a player whose sync found no Arena game. */
export function NoArenaGames({ message }: { message: string | undefined }) {
  return (
    <p data-testid="no-arena-games" className="rounded-md border border-neutral-200 px-4 py-6 text-neutral-700">
      {message ?? 'No Arena games found for this player.'}
    </p>
  );
}
