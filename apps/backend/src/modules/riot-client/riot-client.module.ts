import { Module } from '@nestjs/common';
import { CONFIG, type Config } from '../../core/config';
import { RiotBudget } from './riot-budget';
import { RiotClient } from './riot-client';

@Module({
  providers: [
    RiotBudget,
    {
      provide: RiotClient,
      useFactory: (config: Config, budget: RiotBudget) =>
        new RiotClient(config.riot, { onRateLimits: (limits) => budget.record(limits) }),
      inject: [CONFIG, RiotBudget],
    },
  ],
  exports: [RiotClient, RiotBudget],
})
export class RiotClientModule {}
