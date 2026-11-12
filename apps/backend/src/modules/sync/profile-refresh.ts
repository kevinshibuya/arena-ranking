import type { RefreshResponse } from '@arena/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { DATABASE, type Database } from '../../core/database';
import { REDIS } from '../../core/redis';
import type { Region } from '../riot-client/regions';
import { SyncRuns, type Player } from './sync-runs';
import { trackedPlayerByRiotId } from './tracked-player';

/** How long a refreshed profile waits before the next refresh. */
const COOLDOWN_MS = 120_000;

/** Refreshes one client may ask for per window, whichever profiles. */
const CLIENT_LIMIT = 10;
const CLIENT_WINDOW_MS = 60_000;

const seconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

/**
 * Update now: a priority-1 incremental sync of one profile, at most once per
 * profile every two minutes and ten times a minute per client, both counted in
 * Redis. Every request counts against its client, refused or not.
 */
@Injectable()
export class ProfileRefresh {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly runs: SyncRuns,
  ) {}

  /** A tracked player by the Riot ID last seen for them; never asks Riot. */
  player(region: Region, gameName: string, tagLine: string): Promise<Player | null> {
    return trackedPlayerByRiotId(this.db, region, gameName, tagLine);
  }

  async state(player: Player): Promise<RefreshResponse> {
    return { queued: false, cooldownSeconds: await this.cooldownSeconds(player.puuid), lastSyncedAt: iso(player.lastSyncedAt) };
  }

  async refresh(player: Player, client: string): Promise<RefreshResponse> {
    const lastSyncedAt = iso(player.lastSyncedAt);
    const clientKey = `refresh:client:${client}`;
    // The window opens with the client's first request, in the same transaction as the count.
    const [[, count], , [, ttl]] = (await this.redis
      .multi()
      .incr(clientKey)
      .pexpire(clientKey, CLIENT_WINDOW_MS, 'NX')
      .pttl(clientKey)
      .exec()) as [[Error | null, number], [Error | null, number], [Error | null, number]];
    if (count > CLIENT_LIMIT) {
      return {
        queued: false,
        refused: 'rate-limited',
        cooldownSeconds: await this.cooldownSeconds(player.puuid),
        retryAfterSeconds: seconds(Math.max(ttl, 0)),
        lastSyncedAt,
      };
    }

    const profileKey = this.profileKey(player.puuid);
    if ((await this.redis.set(profileKey, '1', 'PX', COOLDOWN_MS, 'NX')) === null) {
      return { queued: false, refused: 'cooldown', cooldownSeconds: await this.cooldownSeconds(player.puuid), lastSyncedAt };
    }
    let started: Awaited<ReturnType<SyncRuns['startIncremental']>>;
    try {
      started = await this.runs.startIncremental(player.region as Region, player.puuid, 1);
    } catch (error) {
      await this.redis.del(profileKey);
      throw error;
    }
    if (started) return { queued: true, cooldownSeconds: seconds(COOLDOWN_MS), lastSyncedAt };
    // Its primary sync is already running: nothing to queue, nothing to wait out.
    await this.redis.del(profileKey);
    return { queued: false, cooldownSeconds: 0, lastSyncedAt };
  }

  private async cooldownSeconds(puuid: string): Promise<number> {
    return seconds(await this.redis.pttl(this.profileKey(puuid)));
  }

  private profileKey(puuid: string): string {
    return `refresh:profile:${puuid}`;
  }
}

function iso(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}
