import { fetchRefreshState } from '../../../../lib/api/refresh';
import { regionById } from '../../../../lib/regions';
import { RefreshControl } from './refresh-control';
import type { ProfileSectionProps } from './section-props';

/** Update now: the last update, the cooldown left, and the button. */
export async function RefreshSection({ profile }: ProfileSectionProps) {
  const { puuid, region, gameName, tagLine } = profile.player;
  const state = await fetchRefreshState(region, gameName, tagLine);
  if (!state.ok) return null;
  return (
    <RefreshControl
      // Another profile starts its own countdown, not this one's.
      key={puuid}
      player={{ region, gameName, tagLine }}
      timeZone={regionById(region)?.timeZone ?? 'UTC'}
      initial={state.data}
    />
  );
}
