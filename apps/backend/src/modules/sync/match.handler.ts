import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JobHandler, QUEUES, type QueueJobHandler } from '../../core/queues';
import { MatchStore } from '../match-store/match-store';
import { RiotClient } from '../riot-client/riot-client';
import { RIOT_JOBS, riotFailure, type MatchJob } from './riot-jobs';
import { SyncRuns } from './sync-runs';

/** Fetches one listed match and stores it. */
@JobHandler({ queue: QUEUES.riot, name: RIOT_JOBS.match })
@Injectable()
export class MatchHandler implements QueueJobHandler<MatchJob, void> {
  private readonly logger = new Logger(MatchHandler.name);

  constructor(
    private readonly riot: RiotClient,
    private readonly store: MatchStore,
    private readonly runs: SyncRuns,
  ) {}

  async handle(job: Job<MatchJob>): Promise<void> {
    const { region, matchId, syncId } = job.data;
    const result = await this.riot.matchById(region, matchId);
    if (result.kind === 'ok') await this.store.store(region, result.data);
    else if (result.kind === 'not-found') this.logger.warn({ matchId }, 'listed match not found at Riot; skipped');
    else throw riotFailure('match', result);
    await this.runs.settle(syncId, []);
  }

  async failed(job: Job<MatchJob>): Promise<void> {
    await this.runs.settleFailed(job.data.syncId);
  }
}
