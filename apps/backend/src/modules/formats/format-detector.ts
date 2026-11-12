import type { FormatId } from '@arena/shared';

/** The one field of a match-v5 participant the detector reads. */
export interface SubteamMember {
  playerSubteamId?: number | null;
}

export const IRREGULAR: FormatId = 'irregular';

export function formatLabel(format: FormatId): string {
  if (format === IRREGULAR) return 'Irregular lobbies';
  const [teams, size] = format.split('x');
  return `${teams} teams of ${size}`;
}

/** The ladder a selector starts on. */
export const DEFAULT_FORMAT = { id: '6x3', label: formatLabel('6x3') } as const satisfies {
  id: FormatId;
  label: string;
};

/**
 * Names a lobby's format from its participants, grouped by subteam: team count by
 * team size. Riot's queue ids do not tell the 2026 formats apart, so the shape is
 * the only source. Uneven teams, or a participant without a subteam, give
 * `irregular`.
 */
export function detectFormat(participants: readonly SubteamMember[]): FormatId {
  const teamSizes = new Map<number, number>();
  for (const { playerSubteamId } of participants) {
    if (typeof playerSubteamId !== 'number' || !Number.isInteger(playerSubteamId) || playerSubteamId <= 0) {
      return IRREGULAR;
    }
    teamSizes.set(playerSubteamId, (teamSizes.get(playerSubteamId) ?? 0) + 1);
  }
  const [size, ...otherSizes] = new Set(teamSizes.values());
  if (size === undefined || otherSizes.length > 0) return IRREGULAR;
  return `${teamSizes.size}x${size}`;
}
