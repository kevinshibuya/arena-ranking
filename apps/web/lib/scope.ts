import type { FormatSummary, ProfileScope } from '@arena/shared';

/** A scope as the `season` query value: the season id, or `all`. */
export function seasonQuery(scope: ProfileScope): string {
  return scope.kind === 'all-time' ? 'all' : String(scope.seasonId);
}

/** A scope in a sentence: the season's name, or "all-time". */
export function scopeName(scope: ProfileScope): string {
  return scope.kind === 'all-time' ? 'all-time' : scope.name;
}

export function formatLabel(formats: FormatSummary[], id: string): string {
  return formats.find((format) => format.id === id)?.label ?? id;
}

/** Whether the format has a ladder, and so ratings. */
export function hasLadder(formats: FormatSummary[], id: string): boolean {
  return formats.find((format) => format.id === id)?.ladder ?? false;
}
