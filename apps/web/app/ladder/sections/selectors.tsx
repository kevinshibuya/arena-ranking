import { ScopeChoices } from '../../scope-choices';
import { ladderQuery, type LadderSectionProps } from './section-props';

/** Format and season choices for the ladder; each choice is a URL, the page size kept. */
export function LadderSelectors(props: LadderSectionProps) {
  const current = ladderQuery(props);
  const href = (format: string, season: string) => {
    const query = new URLSearchParams({ format, season });
    if (current.limit) query.set('limit', current.limit);
    return `/ladder?${query}`;
  };
  return <ScopeChoices formats={props.formats} seasons={props.seasons} current={current} href={href} />;
}
