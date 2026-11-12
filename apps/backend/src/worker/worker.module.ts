import { Module } from '@nestjs/common';
import { OpsModule } from '../modules/ops/ops.module';
import { QueueWorkers } from './queue-workers';

/** Worker-only: imported by the worker entrypoint, never by the API. */
@Module({ imports: [OpsModule], providers: [QueueWorkers] })
export class WorkerModule {}
