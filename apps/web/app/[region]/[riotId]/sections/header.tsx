import { regionById } from '../../../../lib/regions';
import { riotIdText } from '../../../../lib/riot-id';
import type { ProfileSectionProps } from './section-props';

export function ProfileHeader({ profile }: ProfileSectionProps) {
  return (
    <header>
      <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{riotIdText(profile.player)}</h1>
      <p className="mt-1 text-sm text-neutral-500">{regionById(profile.player.region)?.label ?? profile.player.region}</p>
    </header>
  );
}
