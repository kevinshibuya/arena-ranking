import type { Metadata } from 'next';
import { loadProfileView } from './load';
import { profileMetadata } from './metadata';
import { ChampionsSection } from './sections/champions';
import { ProfileHeader } from './sections/header';
import { MatchesSection } from './sections/matches';
import { RatingSection } from './sections/rating';
import { RefreshSection } from './sections/refresh';
import type { ProfileSectionProps } from './sections/section-props';
import { ScopeSelectors } from './sections/selectors';
import { ErrorState, NoArenaGames, NotFoundState } from './sections/states';
import { SyncBanner } from './sections/sync-banner';
import { standingForPreview } from './standing';
import { TeammatesSection } from './sections/teammates';
import { TotalsSection } from './sections/totals';

export async function generateMetadata({ params, searchParams }: PageProps<'/[region]/[riotId]'>): Promise<Metadata> {
  const view = await loadProfileView(params, searchParams);
  return profileMetadata(view, await standingForPreview(view));
}

// Composition only: each section lives in its own file under ./sections, and a
// later feature fills its section there instead of editing this page.
export default async function ProfilePage({ params, searchParams }: PageProps<'/[region]/[riotId]'>) {
  const view = await loadProfileView(params, searchParams);
  if (view.kind === 'not-found') return <NotFoundState riotId={view.riotId} />;
  if (view.kind === 'error') return <ErrorState message={view.message} />;

  const props: ProfileSectionProps = { profile: view.profile, formats: view.formats, seasons: view.seasons };
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ProfileHeader {...props} />
        <RefreshSection {...props} />
      </div>
      <SyncBanner {...props} />
      <ScopeSelectors {...props} />
      {view.profile.syncState === 'no-arena-games' ? (
        <NoArenaGames message={view.profile.message} />
      ) : (
        <>
          <TotalsSection {...props} />
          <RatingSection {...props} />
          <ChampionsSection {...props} />
          <TeammatesSection {...props} />
          <MatchesSection {...props} />
        </>
      )}
    </main>
  );
}
