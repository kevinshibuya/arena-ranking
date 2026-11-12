import Link from 'next/link';
import { redirect } from 'next/navigation';
import { regionById, DEFAULT_REGION } from '../lib/regions';
import { parseRiotId, profilePath } from '../lib/riot-id';
import { SearchForm } from './search-form';

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  // A search submitted before the page hydrated arrives as a query.
  const { riotId, region } = await searchParams;
  let problem: string | null = null;
  if (typeof riotId === 'string') {
    const parsed = parseRiotId(riotId);
    if (!parsed.ok) problem = parsed.problem;
    else redirect(profilePath(typeof region === 'string' && regionById(region) ? region : DEFAULT_REGION, parsed.riotId));
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Arena Ranking</h1>
      <p className="mt-3 text-neutral-600">Arena stats and a community ladder for the Brazil server.</p>
      <SearchForm initialRiotId={typeof riotId === 'string' ? riotId : ''} initialProblem={problem} />
      <p className="mt-10 text-sm">
        <Link href="/ladder" prefetch={false} className="font-medium underline underline-offset-4">
          See the 6x3 ladder
        </Link>
      </p>
    </main>
  );
}
