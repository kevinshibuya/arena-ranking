import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../core/database';
import { players } from '../../db/schema';
import type { Region } from '../riot-client/regions';
import { AccountLookup } from './account-lookup';
import { SyncRuns, type Player } from './sync-runs';
import { trackedPlayerByRiotId } from './tracked-player';

/**
 * A search by Riot ID: from the tracked players first, so a profile view never
 * waits on Riot. Riot is asked only for a Riot ID never seen; the player is then
 * found by PUUID, so a renamed account keeps its one row under its new name. A
 * player never synced (new, known only from matches, or left by a failed primary)
 * gets a primary sync.
 */
@Injectable()
export class PlayerSearch {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly accounts: AccountLookup,
    private readonly runs: SyncRuns,
  ) {}

  /** The player, or null when the Riot ID does not resolve. */
  async search(region: Region, gameName: string, tagLine: string): Promise<Player | null> {
    const tracked = await trackedPlayerByRiotId(this.db, region, gameName, tagLine);
    if (tracked) {
      if (tracked.syncState !== 'unknown') return tracked;
      // Its PUUID is known, so the primary sync starts without a lookup.
      return (await this.runs.claimPrimary(region, tracked.puuid, 1)) ?? (await this.byPuuid(tracked.puuid));
    }

    const account = await this.accounts.byRiotId(region, gameName, tagLine);
    if (!account) return null;

    // The account lookup is the newest sighting of the Riot ID there is.
    await this.db
      .insert(players)
      .values({ puuid: account.puuid, region, gameName: account.gameName, tagLine: account.tagLine, riotIdSeenAt: new Date() })
      .onConflictDoUpdate({
        target: players.puuid,
        set: {
          gameName: sql`excluded.game_name`,
          tagLine: sql`excluded.tag_line`,
          riotIdSeenAt: sql`excluded.riot_id_seen_at`,
        },
      });

    // Only the search that flips the state starts the sync.
    return (await this.runs.claimPrimary(region, account.puuid, 1)) ?? (await this.byPuuid(account.puuid));
  }

  private async byPuuid(puuid: string): Promise<Player | null> {
    const [player] = await this.db.select().from(players).where(eq(players.puuid, puuid));
    return player ?? null;
  }
}
