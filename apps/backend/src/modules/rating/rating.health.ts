import { Injectable } from '@nestjs/common';
import type { ReplayTimes } from '@arena/shared';
import { HealthContributor, type HealthSectionContributor } from '../ops/health/health-contributor';
import { ReplaySchedule } from './replay-schedule';

@HealthContributor()
@Injectable()
export class RatingHealthContributor implements HealthSectionContributor<'rating'> {
  readonly section = 'rating';

  constructor(private readonly schedule: ReplaySchedule) {}

  contribute(): Promise<ReplayTimes> {
    return this.schedule.times();
  }
}
