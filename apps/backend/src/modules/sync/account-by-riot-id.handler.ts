import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JobHandler, QUEUES, type QueueJobHandler } from '../../core/queues';
import { RiotClient } from '../riot-client/riot-client';
import { RIOT_JOBS, riotFailure, type AccountByRiotIdJob, type AccountByRiotIdResult } from './riot-jobs';

/** Resolves a Riot ID to its account. The API awaits this job. */
@JobHandler({ queue: QUEUES.riot, name: RIOT_JOBS.accountByRiotId })
@Injectable()
export class AccountByRiotIdHandler implements QueueJobHandler<AccountByRiotIdJob, AccountByRiotIdResult> {
  constructor(private readonly riot: RiotClient) {}

  async handle(job: Job<AccountByRiotIdJob>): Promise<AccountByRiotIdResult> {
    const { region, gameName, tagLine } = job.data;
    const result = await this.riot.accountByRiotId(region, gameName, tagLine);
    if (result.kind === 'ok') return { found: true, account: result.data };
    if (result.kind === 'not-found') return { found: false };
    throw riotFailure('account by Riot ID', result);
  }
}
