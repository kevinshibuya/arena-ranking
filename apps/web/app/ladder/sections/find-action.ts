'use server';

import type { LadderPositionResponse } from '@arena/shared';
import { fetchLadderPosition } from '../../../lib/api/ladder';
import type { RiotId } from '../../../lib/riot-id';

export type FindResult =
  | { kind: 'found'; position: LadderPositionResponse }
  | { kind: 'untracked' }
  | { kind: 'error'; message: string };

/**
 * Looks a Riot ID up on one ladder from the server, so an untracked Riot ID
 * comes back as an answer rather than a failed request in the browser.
 */
export async function findOnLadder(region: string, riotId: RiotId, format: string, season: string): Promise<FindResult> {
  const position = await fetchLadderPosition(region, riotId.gameName, riotId.tagLine, { format, season });
  if (position.ok) return { kind: 'found', position: position.data };
  if (position.status === 404) return { kind: 'untracked' };
  return { kind: 'error', message: position.message };
}
