import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ApplicationConfig } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { CONFIG, type Config } from '../../core/config';
import { QUEUES } from '../../core/queues';
import { RiotClientModule } from '../riot-client/riot-client.module';
import { basicAuth, DASHBOARD_ROUTE, dashboardRouter } from './dashboard';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { ProcessHealthContributor } from './health/process.health';
import { OpsHealthContributor } from './ops.health';
import { RiotKeyGuard } from './riot-key/riot-key-guard';
import { RiotKeyProbeHandler } from './riot-key/riot-key-probe.handler';

@Module({
  imports: [RiotClientModule],
  controllers: [HealthController],
  providers: [HealthService, ProcessHealthContributor, OpsHealthContributor, RiotKeyGuard, RiotKeyProbeHandler],
  exports: [RiotKeyGuard],
})
export class OpsModule implements NestModule {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly application: ApplicationConfig,
    @InjectQueue(QUEUES.riot) private readonly riot: Queue,
    @InjectQueue(QUEUES.maintenance) private readonly maintenance: Queue,
  ) {}

  /** The queue dashboard, mounted only when both DASHBOARD_USER and DASHBOARD_PASS are set. Never in the worker. */
  configure(consumer: MiddlewareConsumer): void {
    const { user, pass } = this.config.dashboard;
    if (user === undefined || pass === undefined) return;
    const basePath = `/${this.application.getGlobalPrefix()}/${DASHBOARD_ROUTE}`.replace(/\/+/g, '/');
    consumer
      .apply(basicAuth({ user, pass }), dashboardRouter(basePath, [this.riot, this.maintenance]))
      .forRoutes(DASHBOARD_ROUTE);
  }
}
