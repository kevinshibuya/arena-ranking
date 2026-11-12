import type { StaticDataHealth } from '@arena/shared';
import { Inject, Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { DATABASE, type Database } from '../../core/database';
import { staticDataRefreshes } from '../../db/schema';
import { HealthContributor, type HealthSectionContributor } from '../ops/health/health-contributor';

@HealthContributor()
@Injectable()
export class StaticDataHealthContributor implements HealthSectionContributor<'staticData'> {
  readonly section = 'staticData';

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async contribute(): Promise<StaticDataHealth> {
    const [last] = await this.db
      .select({ patch: staticDataRefreshes.patch, refreshedAt: staticDataRefreshes.refreshedAt })
      .from(staticDataRefreshes)
      .orderBy(desc(staticDataRefreshes.refreshedAt), desc(staticDataRefreshes.id))
      .limit(1);
    return { lastRefreshAt: last?.refreshedAt.toISOString() ?? null, patch: last?.patch ?? null };
  }
}
