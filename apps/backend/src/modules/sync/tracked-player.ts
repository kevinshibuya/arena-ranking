import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../core/database';
import { players } from '../../db/schema';
import type { Region } from '../riot-client/regions';
import type { Player } from './sync-runs';

/**
 * A tracked player by the Riot ID last seen for them, case-insensitive, the
 * newest sighting first when an old name is still on another row. Never asks Riot.
 */
export async function trackedPlayerByRiotId(db: Database, region: Region, gameName: string, tagLine: string): Promise<Player | null> {
  const [player] = await db
    .select()
    .from(players)
    .where(
      and(
        eq(players.region, region),
        sql`lower(${players.gameName}) = lower(${gameName})`,
        sql`lower(${players.tagLine}) = lower(${tagLine})`,
      ),
    )
    .orderBy(sql`${players.riotIdSeenAt} desc nulls last`)
    .limit(1);
  return player ?? null;
}
