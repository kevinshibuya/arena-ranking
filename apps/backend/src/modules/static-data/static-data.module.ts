import { InjectQueue } from '@nestjs/bullmq';
import { Module, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../core/queues';
import { ChampionCatalog } from './champion-catalog';
import { StaticDataHealthContributor } from './static-data.health';
import { STATIC_DATA_REFRESH_JOB } from './refresh-now';
import { StaticDataRefreshHandler } from './static-data-refresh.handler';

@Module({
  providers: [ChampionCatalog, StaticDataRefreshHandler, StaticDataHealthContributor],
  exports: [ChampionCatalog],
})
export class StaticDataModule implements OnModuleInit {
  constructor(@InjectQueue(QUEUES.maintenance) private readonly maintenance: Queue) {}

  /**
   * Daily at 06:00 UTC. A cron pattern rather than an interval: an interval
   * runs at once on every fresh Redis, so every test app would reach for the
   * upstreams.
   */
  async onModuleInit(): Promise<void> {
    await this.maintenance.upsertJobScheduler(
      STATIC_DATA_REFRESH_JOB,
      { pattern: '0 6 * * *', tz: 'UTC' },
      {
        name: STATIC_DATA_REFRESH_JOB,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 30 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      },
    );
  }
}
