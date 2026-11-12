import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SyncState } from '@arena/shared';
import type { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../../core/config';
import { DATABASE, type Database } from '../../core/database';
import { QUEUES } from '../../core/queues';
import { REDIS } from '../../core/redis';
import { participants, players } from '../../db/schema';
import type { Region } from '../riot-client/regions';
import { currentSeason } from '../seasons/season-lookup';
import { SeasonsService } from '../seasons/seasons.service';
import { Clock } from './clock';
import { RIOT_JOBS, riotJobOptions, type MatchIdsPageJob, type MatchJob, type RiotPriority } from './riot-jobs';

export type Player = typeof players.$inferSelect;

/** Primary lists the current season, backfill the earlier ones, incremental from the last sync on. */
type RunKind = 'primary' | 'backfill' | 'incremental';

/** A run's counters outlive any sane run, then go. */
const RUN_TTL_SECONDS = 24 * 3600;

/**
 * An incremental sync lists from the last sync less this much: a game in
 * progress then started before it, and the listing filters on the start.
 */
const INCREMENTAL_OVERLAP_MS = 3600_000;

export type FollowUpJob =
  | { name: typeof RIOT_JOBS.matchIdsPage; data: MatchIdsPageJob }
  | { name: typeof RIOT_JOBS.match; data: MatchJob };

/**
 * A sync run is a set of Riot jobs that grows as listing pages come back, so it
 * is tracked by a counter rather than a flow: `pending` counts the run's jobs
 * not yet settled, and the job that brings it to zero finishes the run. Each
 * job adds its follow-ups to the counter before it removes itself, so the
 * counter never reaches zero early. A job that fails for good still settles,
 * counted under `failed`, so every run finishes.
 */
@Injectable()
export class SyncRuns {
  private readonly logger = new Logger(SyncRuns.name);

  constructor(
    @InjectQueue(QUEUES.riot) private readonly queue: Queue,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    private readonly seasons: SeasonsService,
    private readonly clock: Clock,
  ) {}

  /**
   * Claims a player never synced (state `unknown`) and starts its primary sync.
   * Only the caller that flips the state starts the sync; the others get null.
   */
  async claimPrimary(region: Region, puuid: string, priority: RiotPriority): Promise<Player | null> {
    const [claimed] = await this.db
      .update(players)
      .set({ syncState: 'primary-syncing' })
      .where(and(eq(players.puuid, puuid), eq(players.syncState, 'unknown')))
      .returning();
    if (!claimed) return null;
    try {
      await this.startPrimary(region, puuid, priority);
    } catch (error) {
      // Released, so the next caller claims it again.
      await this.db.update(players).set({ syncState: 'unknown' }).where(eq(players.puuid, puuid));
      throw error;
    }
    return claimed;
  }

  /**
   * Lists from the player's last sync on. A player never synced gets a primary
   * sync instead, when nothing else has claimed it. Says which sync it started.
   */
  async startIncremental(region: Region, puuid: string, priority: RiotPriority): Promise<'incremental' | 'primary' | null> {
    const [player] = await this.db.select().from(players).where(eq(players.puuid, puuid));
    if (!player) return null;
    if (!player.lastSyncedAt) return (await this.claimPrimary(region, puuid, priority)) ? 'primary' : null;
    const startTime = player.lastSyncedAt.getTime() - INCREMENTAL_OVERLAP_MS;
    await this.start('incremental', region, puuid, this.clock.now(), { startTime }, priority);
    // Earlier seasons still missing, from a backfill that lost a job: retried alongside.
    if (player.syncState === 'primary-synced') await this.startBackfill(region, puuid);
    return 'incremental';
  }

  /** Of these players, the ones with a primary or incremental sync not finished yet. */
  async running(puuids: readonly string[]): Promise<Set<string>> {
    if (puuids.length === 0) return new Set();
    const markers = await this.redis.mget(puuids.map((puuid) => this.playerKey(puuid)));
    return new Set(puuids.filter((_, index) => markers[index] !== null));
  }

  /** Lists the current season once per Arena queue id, for a player already marked primary-syncing. */
  private async startPrimary(region: Region, puuid: string, priority: RiotPriority): Promise<void> {
    const now = this.clock.now();
    const season = currentSeason(await this.seasons.list(), now);
    if (!season) throw new Error(`No season has started by ${now.toISOString()}`);
    await this.start('primary', region, puuid, now, { startTime: season.startsAt.getTime() }, priority);
  }

  /**
   * Lists the earlier seasons, from the first seasons row up to the current
   * season's start, at the lowest priority. With no earlier season to list, the
   * player's history is settled at once.
   */
  private async startBackfill(region: Region, puuid: string): Promise<void> {
    const now = this.clock.now();
    const seasons = await this.seasons.list();
    const current = currentSeason(seasons, now);
    const first = seasons[0];
    if (!current || !first || first.startsAt.getTime() >= current.startsAt.getTime()) {
      await this.settleHistory(puuid, 'primary-synced');
      return;
    }
    // Before the jobs exist, so the run's finish always finds it backfilling.
    await this.setState(puuid, 'backfilling');
    await this.start(
      'backfill',
      region,
      puuid,
      now,
      // Riot's filter takes whole seconds; the current season's first second is the primary sync's.
      { startTime: first.startsAt.getTime(), endTime: current.startsAt.getTime() - 1000 },
      3,
    );
  }

  private async start(
    kind: RunKind,
    region: Region,
    puuid: string,
    startedAt: Date,
    window: { startTime: number; endTime?: number },
    priority: RiotPriority,
  ): Promise<void> {
    const syncId = randomUUID();
    const queueIds = this.config.riot.arenaQueueIds;

    const counters = this.redis
      .multi()
      .hset(this.key(syncId), {
        kind,
        puuid,
        region,
        startedAt: startedAt.toISOString(),
        pending: queueIds.length,
        found: 0,
      })
      .expire(this.key(syncId), RUN_TTL_SECONDS);
    // A backfill runs beside the player's other syncs; the sweep only skips these.
    if (kind !== 'backfill') counters.set(this.playerKey(puuid), syncId, 'EX', RUN_TTL_SECONDS);
    await counters.exec();
    await this.queue.addBulk(
      queueIds.map((queueId) => ({
        name: RIOT_JOBS.matchIdsPage,
        data: { syncId, region, puuid, queueId, ...window, start: 0, priority } satisfies MatchIdsPageJob,
        opts: riotJobOptions(priority),
      })),
    );
  }

  /**
   * Called by a run's job once its Riot request has succeeded: enqueues its
   * follow-ups, counts the match ids it found, and finishes the run when it
   * was the last job out.
   */
  /** Called by a run's job whose last attempt failed: counted, then settled with no follow-ups. */
  async settleFailed(syncId: string): Promise<void> {
    await this.redis.hincrby(this.key(syncId), 'failed', 1);
    await this.settle(syncId, []);
  }

  async settle(syncId: string, followUps: readonly FollowUpJob[], foundMatchIds = 0): Promise<void> {
    const key = this.key(syncId);
    if (foundMatchIds > 0) await this.redis.hincrby(key, 'found', foundMatchIds);
    if (followUps.length > 0) {
      await this.redis.hincrby(key, 'pending', followUps.length);
      await this.queue.addBulk(
        followUps.map((job) => ({ name: job.name, data: job.data, opts: riotJobOptions(job.data.priority) })),
      );
    }
    const left = await this.redis.hincrby(key, 'pending', -1);
    if (left === 0) await this.finish(syncId);
    else if (left < 0) {
      this.logger.warn({ syncId }, 'sync run settled after its counters were gone');
      await this.redis.del(key);
    }
  }

  private async finish(syncId: string): Promise<void> {
    const run = await this.redis.hgetall(this.key(syncId));
    await this.redis.del(this.key(syncId));
    const { puuid, region } = run;
    if (!puuid || !region) return;
    const found = Number(run.found);
    const failed = Number(run.failed ?? 0);
    const startedAt = new Date(run.startedAt ?? Date.now());
    if (failed > 0) {
      // A run that lost a job leaves no trace on the player, so the next search,
      // refresh or sweep runs it again: a primary goes back to unknown, a backfill
      // to primary-synced, and an incremental does not move last_synced_at.
      if (run.kind === 'primary') {
        await this.db
          .update(players)
          .set({ syncState: 'unknown' })
          .where(and(eq(players.puuid, puuid), eq(players.syncState, 'primary-syncing')));
      } else if (run.kind === 'backfill') {
        await this.db
          .update(players)
          .set({ syncState: 'primary-synced' })
          .where(and(eq(players.puuid, puuid), eq(players.syncState, 'backfilling')));
      }
      if (run.kind !== 'backfill') await this.redis.del(this.playerKey(puuid));
      this.logger.warn({ syncId, kind: run.kind, puuid, found, failed }, 'sync finished with failed jobs; left for the next sync');
      return;
    }
    if (run.kind === 'primary') {
      // An empty current season still gets its earlier seasons; the backfill decides no-arena-games.
      await this.db
        .update(players)
        .set({ syncState: 'primary-synced', lastSyncedAt: startedAt })
        .where(eq(players.puuid, puuid));
      await this.startBackfill(region as Region, puuid);
    } else if (run.kind === 'backfill') {
      await this.settleHistory(puuid, 'backfilling');
    } else if (run.kind === 'incremental') {
      // Two incremental syncs can overlap; the later start wins.
      await this.db
        .update(players)
        .set({ lastSyncedAt: sql`greatest(${players.lastSyncedAt}, ${startedAt})` })
        .where(eq(players.puuid, puuid));
      // A player with no Arena games has played one since; their backfill already ran.
      if (found > 0) {
        await this.db
          .update(players)
          .set({ syncState: 'complete' })
          .where(and(eq(players.puuid, puuid), eq(players.syncState, 'no-arena-games')));
      }
    }
    if (run.kind !== 'backfill') await this.redis.del(this.playerKey(puuid));
    this.logger.log({ syncId, kind: run.kind, puuid, found }, 'sync finished');
  }

  /**
   * Once every season has been listed: complete when any match of the player is
   * stored, no-arena-games otherwise. Only from the state the caller expects.
   */
  private async settleHistory(puuid: string, from: SyncState): Promise<void> {
    const stored = await this.db
      .select({ matchId: participants.matchId })
      .from(participants)
      .where(eq(participants.puuid, puuid))
      .limit(1);
    await this.db
      .update(players)
      .set({ syncState: stored.length > 0 ? 'complete' : 'no-arena-games' })
      .where(and(eq(players.puuid, puuid), eq(players.syncState, from)));
  }

  private async setState(puuid: string, syncState: SyncState): Promise<void> {
    await this.db.update(players).set({ syncState }).where(eq(players.puuid, puuid));
  }

  private key(syncId: string): string {
    return `sync:${syncId}`;
  }

  private playerKey(puuid: string): string {
    return `sync:player:${puuid}`;
  }
}
