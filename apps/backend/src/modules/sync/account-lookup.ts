import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { QueueEvents, type Queue } from 'bullmq';
import { CONFIG, type Config } from '../../core/config';
import { QUEUES } from '../../core/queues';
import type { AccountDto } from '../riot-client/riot.types';
import type { Region } from '../riot-client/regions';
import { RIOT_JOBS, riotJobOptions, type AccountByRiotIdJob, type AccountByRiotIdResult } from './riot-jobs';

/** How long a search waits for its account lookup before giving up. */
const LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Resolves a Riot ID for a request that is waiting on it: a job on the `riot`
 * queue with no priority, so it runs before every sync job and has a share of
 * each rate window kept for it, awaited. The API never calls Riot itself.
 */
@Injectable()
export class AccountLookup implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountLookup.name);
  private readonly events: QueueEvents;

  constructor(
    @InjectQueue(QUEUES.riot) private readonly queue: Queue,
    @Inject(CONFIG) config: Config,
  ) {
    this.events = new QueueEvents(QUEUES.riot, { connection: { url: config.redisUrl }, prefix: config.redisPrefix });
  }

  async onModuleInit(): Promise<void> {
    await this.events.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.events.close();
  }

  /** The account, or null when the Riot ID does not resolve. */
  async byRiotId(region: Region, gameName: string, tagLine: string): Promise<AccountDto | null> {
    const data: AccountByRiotIdJob = { region, gameName, tagLine };
    // No priority: the plain wait list runs before every sync job, and a human is blocked on this one.
    const job = await this.queue.add(RIOT_JOBS.accountByRiotId, data, riotJobOptions());
    let result: AccountByRiotIdResult;
    try {
      result = (await job.waitUntilFinished(this.events, LOOKUP_TIMEOUT_MS)) as AccountByRiotIdResult;
    } catch (error) {
      this.logger.warn({ err: error, jobId: job.id }, 'account lookup failed');
      throw new ServiceUnavailableException('Riot did not answer the Riot ID lookup; try again shortly');
    }
    return result.found ? result.account : null;
  }
}
