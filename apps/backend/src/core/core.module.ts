import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ConfigModule } from './config.module';
import { DatabaseModule } from './database';
import { LoggingModule } from './logging';
import { QueuesModule } from './queues';
import { RedisModule } from './redis';

/**
 * Infrastructure both processes share: config, logging, Postgres, Redis, the
 * queues and Nest's discovery service. Domain modules inject from it without
 * importing it, and never edit it.
 */
@Global()
@Module({
  imports: [ConfigModule, LoggingModule, DatabaseModule, RedisModule, QueuesModule, DiscoveryModule],
  exports: [DiscoveryModule],
})
export class CoreModule {}
