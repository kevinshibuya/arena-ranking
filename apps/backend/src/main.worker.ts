import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BOOT_OPTIONS, configureWorker, exitOnBootFailure } from './bootstrap/configure';
import { WorkerModule } from './worker/worker.module';

@Module({ imports: [AppModule, WorkerModule] })
class WorkerProcessModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerProcessModule, BOOT_OPTIONS);
  configureWorker(app);
}

main().catch(exitOnBootFailure);
