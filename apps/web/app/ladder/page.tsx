import type { Metadata } from 'next';
import { formatLabel, scopeName } from '../../lib/scope';
import { loadLadderView } from './load';
import { ladderMetadata } from './metadata';
import { FindOnLadder } from './sections/find';
import { LadderHeader } from './sections/header';
import { ladderQuery, type LadderSectionProps } from './sections/section-props';
import { LadderSelectors } from './sections/selectors';
import { LadderTable } from './sections/table';

export async function generateMetadata({ searchParams }: PageProps<'/ladder'>): Promise<Metadata> {
  return ladderMetadata(await loadLadderView(searchParams));
}

export default async function LadderPage({ searchParams }: PageProps<'/ladder'>) {
  const view = await loadLadderView(searchParams);
  if (view.kind === 'error') {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ladder unavailable</h1>
        <p className="mt-3 text-neutral-600">{view.message}</p>
      </main>
    );
  }

  const props: LadderSectionProps = { ladder: view.ladder, formats: view.formats, seasons: view.seasons, limit: view.limit };
  const query = ladderQuery(props);
  // A new format, season or page size starts the client parts afresh.
  const key = `${query.format}:${query.season}:${query.limit ?? ''}`;
  const { ladder } = view;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <LadderHeader {...props} />
      <LadderSelectors {...props} />
      <FindOnLadder key={`find:${key}`} region={ladder.region} format={query.format} season={query.season} />
      <LadderTable
        key={`table:${key}`}
        initial={ladder}
        limit={query.limit}
        emptyText={`No player has ${ladder.minGames} or more games in ${formatLabel(view.formats, ladder.format)}, ${scopeName(ladder.scope)} yet.`}
      />
    </main>
  );
}
