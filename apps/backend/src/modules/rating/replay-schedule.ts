import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ReplayTimes } from '@arena/shared';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../core/queues';
import { REPLAY_JOB, REPLAY_PATTERN } from './replay-job';
import { Ratings } from './ratings';

/** Registers the repeatable replay and reports when it last ran and runs next. */
@Injectable()
export class ReplaySchedule implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUES.maintenance) private readonly maintenance: Queue,
    private readonly ratings: Ratings,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.maintenance.upsertJobScheduler(REPLAY_JOB, { pattern: REPLAY_PATTERN }, { name: REPLAY_JOB });
  }

  async times(): Promise<ReplayTimes> {
    const [run, scheduler] = await Promise.all([this.ratings.latestRun(), this.maintenance.getJobScheduler(REPLAY_JOB)]);
    return {
      lastReplayAt: run?.completedAt.toISOString() ?? null,
      nextReplayAt: scheduler?.next ? new Date(scheduler.next).toISOString() : null,
    };
  }
}
