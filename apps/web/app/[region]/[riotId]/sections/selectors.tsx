import { profilePath } from '../../../../lib/riot-id';
import { ScopeChoices } from '../../../scope-choices';
import { scopeQuery, type ProfileSectionProps } from './section-props';

/** Format and season choices, from the formats and seasons endpoints; each choice is a URL. */
export function ScopeSelectors({ profile, formats, seasons }: ProfileSectionProps) {
  const href = (format: string, season: string) =>
    profilePath(profile.player.region, profile.player, `?${new URLSearchParams({ format, season })}`);
  return <ScopeChoices formats={formats} seasons={seasons} current={scopeQuery(profile)} href={href} />;
}
