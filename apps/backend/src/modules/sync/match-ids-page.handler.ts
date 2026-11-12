import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JobHandler, QUEUES, type QueueJobHandler } from '../../core/queues';
import { MatchStore } from '../match-store/match-store';
import { RiotClient } from '../riot-client/riot-client';
import { MATCH_IDS_PAGE_SIZE, RIOT_JOBS, riotFailure, type MatchIdsPageJob } from './riot-jobs';
import { SyncRuns, type FollowUpJob } from './sync-runs';

/**
 * One page of match ids under one queue id. Follows up with a fetch for every
 * match not stored yet, and with the next page when this one came back full.
 */
@JobHandler({ queue: QUEUES.riot, name: RIOT_JOBS.matchIdsPage })
@Injectable()
export class MatchIdsPageHandler implements QueueJobHandler<MatchIdsPageJob, void> {
  constructor(
    private readonly riot: RiotClient,
    private readonly store: MatchStore,
    private readonly runs: SyncRuns,
  ) {}

  async handle(job: Job<MatchIdsPageJob>): Promise<void> {
    const page = job.data;
    const result = await this.riot.matchIdsByPuuid(page.region, page.puuid, {
      queue: page.queueId,
      startTime: new Date(page.startTime),
      endTime: page.endTime === undefined ? undefined : new Date(page.endTime),
      start: page.start,
      count: MATCH_IDS_PAGE_SIZE,
    });
    if (result.kind !== 'ok') throw riotFailure('match ids', result);

    const ids = result.data;
    const stored = await this.store.storedIds(ids);
    const followUps: FollowUpJob[] = ids
      .filter((matchId) => !stored.has(matchId))
      .map((matchId) => ({
        name: RIOT_JOBS.match,
        data: { syncId: page.syncId, region: page.region, matchId, priority: page.priority },
      }));
    if (ids.length === MATCH_IDS_PAGE_SIZE) {
      followUps.push({ name: RIOT_JOBS.matchIdsPage, data: { ...page, start: page.start + MATCH_IDS_PAGE_SIZE } });
    }
    await this.runs.settle(page.syncId, followUps, ids.length);
  }

  async failed(job: Job<MatchIdsPageJob>): Promise<void> {
    await this.runs.settleFailed(job.data.syncId);
  }
}
