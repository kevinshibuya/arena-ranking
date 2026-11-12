import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { CONFIG, type Config } from '../../core/config';
import { DATABASE, type Database } from '../../core/database';
import { JobHandler, QUEUES, type QueueJobHandler } from '../../core/queues';
import { matches, participants, players } from '../../db/schema';
import type { Region } from '../riot-client/regions';
import { Clock } from './clock';
import { SyncRuns } from './sync-runs';

export const SWEEP_JOB = 'sweep';

/** Every hour, on the hour (UTC). */
export const SWEEP_PATTERN = '0 * * * *';

/** A player synced more recently than this is left to the next sweep. */
const SWEEP_INTERVAL_MS = 3600_000;

export interface SweepSummary {
  candidates: number;
  started: number;
}

/**
 * Keeps active players fresh: every tracked player with a match inside the
 * look-back whose last sync is older than the sweep interval gets an
 * incremental sync at priority 2, or a primary sync if never synced. A player
 * whose sync from an earlier sweep or a refresh is still running is skipped.
 */
@JobHandler({ queue: QUEUES.maintenance, name: SWEEP_JOB })
@Injectable()
export class Sweep implements OnModuleInit, QueueJobHandler<unknown, SweepSummary> {
  private readonly logger = new Logger(Sweep.name);

  constructor(
    @InjectQueue(QUEUES.maintenance) private readonly maintenance: Queue,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    private readonly clock: Clock,
    private readonly runs: SyncRuns,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.maintenance.upsertJobScheduler(SWEEP_JOB, { pattern: SWEEP_PATTERN }, { name: SWEEP_JOB });
  }

  async handle(): Promise<SweepSummary> {
    const now = this.clock.now().getTime();
    const playedSince = new Date(now - this.config.sweepLookbackHours * 3600_000);
    const syncedBefore = new Date(now - SWEEP_INTERVAL_MS);
    const candidates = await this.db
      .select({ puuid: players.puuid, region: players.region })
      .from(players)
      .where(
        and(
          or(isNull(players.lastSyncedAt), lt(players.lastSyncedAt, syncedBefore)),
          sql`exists (${this.db
            .select({ one: sql`1` })
            .from(participants)
            .innerJoin(matches, eq(matches.id, participants.matchId))
            .where(and(eq(participants.puuid, players.puuid), gte(matches.endedAt, playedSince)))})`,
        ),
      );

    const running = await this.runs.running(candidates.map((player) => player.puuid));
    let started = 0;
    for (const player of candidates) {
      if (running.has(player.puuid)) continue;
      if (await this.runs.startIncremental(player.region as Region, player.puuid, 2)) started += 1;
    }
    this.logger.log({ candidates: candidates.length, started }, 'sweep finished');
    return { candidates: candidates.length, started };
  }
}
