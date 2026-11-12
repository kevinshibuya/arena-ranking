import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { OpsHealth, QueueHealth } from '@arena/shared';
import type { Queue } from 'bullmq';
import { QUEUES, queueDepth } from '../../core/queues';
import { RiotBudget } from '../riot-client/riot-budget';
import { HealthContributor, type HealthSectionContributor } from './health/health-contributor';
import { RiotKeyGuard } from './riot-key/riot-key-guard';

async function queueHealth(queue: Queue): Promise<QueueHealth> {
  const [depth, paused] = await Promise.all([queueDepth(queue), queue.isPaused()]);
  return { depth, paused };
}

@HealthContributor()
@Injectable()
export class OpsHealthContributor implements HealthSectionContributor<'ops'> {
  readonly section = 'ops';

  constructor(
    private readonly key: RiotKeyGuard,
    private readonly budget: RiotBudget,
    @InjectQueue(QUEUES.riot) private readonly riot: Queue,
    @InjectQueue(QUEUES.maintenance) private readonly maintenance: Queue,
  ) {}

  async contribute(): Promise<OpsHealth> {
    const [riotKey, appBudget, riot, maintenance] = await Promise.all([
      this.key.state(),
      this.budget.read(),
      queueHealth(this.riot),
      queueHealth(this.maintenance),
    ]);
    return { riotKey, appBudget, queues: { riot, maintenance } };
  }
}
