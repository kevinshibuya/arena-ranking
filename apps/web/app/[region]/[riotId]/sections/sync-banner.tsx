import type { SyncState } from '@arena/shared';
import { PollWhileSyncing } from './poll-while-syncing';
import type { ProfileSectionProps } from './section-props';

/** What a state still lacks, in words; null once nothing is missing. */
function missing(state: SyncState): string | null {
  switch (state) {
    case 'unknown':
      return 'This player has not been synced yet: the numbers come only from matches other searches brought in.';
    case 'primary-syncing':
      return 'Syncing the current season from Riot. The numbers fill in as matches arrive; earlier 2026 seasons come after.';
    case 'primary-synced':
      return 'Current season synced; earlier 2026 seasons are not in yet, so past-season and all-time numbers are partial.';
    case 'backfilling':
      return 'Filling in earlier 2026 seasons; past-season and all-time numbers are partial until it finishes.';
    case 'complete':
    case 'no-arena-games':
      return null;
  }
}

/** Shown while the sync state is not complete; polls while the current season is still coming in. */
export function SyncBanner({ profile }: ProfileSectionProps) {
  const text = missing(profile.syncState);
  if (!text) return null;
  return (
    <div role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {text}
      {profile.syncState === 'primary-syncing' && <PollWhileSyncing />}
    </div>
  );
}
