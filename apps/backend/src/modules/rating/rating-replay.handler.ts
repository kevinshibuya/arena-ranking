import { Injectable } from '@nestjs/common';
import { JobHandler, QUEUES, type QueueJobHandler } from '../../core/queues';
import { REPLAY_JOB, type ReplaySummary } from './replay-job';
import { ReplayRunner } from './replay-runner';

@JobHandler({ queue: QUEUES.maintenance, name: REPLAY_JOB })
@Injectable()
export class RatingReplayHandler implements QueueJobHandler<unknown, ReplaySummary> {
  constructor(private readonly runner: ReplayRunner) {}

  handle(): Promise<ReplaySummary> {
    return this.runner.run();
  }
}
