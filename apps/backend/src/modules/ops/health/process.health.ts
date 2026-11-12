import { Injectable } from '@nestjs/common';
import type { ProcessHealth } from '@arena/shared';
import { HealthContributor, type HealthSectionContributor } from './health-contributor';

@HealthContributor()
@Injectable()
export class ProcessHealthContributor implements HealthSectionContributor<'process'> {
  readonly section = 'process';

  async contribute(): Promise<ProcessHealth> {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }
}
