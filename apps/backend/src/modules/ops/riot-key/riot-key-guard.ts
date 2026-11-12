import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RiotKeyState } from '@arena/shared';
import type { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../../../core/config';
import { QUEUES } from '../../../core/queues';
import { REDIS } from '../../../core/redis';

const REJECTED = 'riot:key-rejected';

export const RIOT_KEY_PROBE_JOB = 'riot-key-probe';

/**
 * The key state, in Redis so the API reports what the worker saw. A 401, a 403
 * or no key at all rejects the key and pauses the `riot` queue, so nothing is retried on it. While
 * rejected, a probe on the `maintenance` queue asks Riot again every interval with
 * the key file's current contents; the first success restores the key and
 * resumes the queue. Replacing the key file is all the operator does.
 */
@Injectable()
export class RiotKeyGuard {
  private readonly logger = new Logger(RiotKeyGuard.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CONFIG) private readonly config: Config,
    @InjectQueue(QUEUES.riot) private readonly riot: Queue,
    @InjectQueue(QUEUES.maintenance) private readonly maintenance: Queue,
  ) {}

  async state(): Promise<RiotKeyState> {
    return (await this.redis.exists(REJECTED)) ? 'rejected' : 'ok';
  }

  /** Pauses the `riot` queue; the first rejection of a key also starts the probe. */
  async reject(): Promise<void> {
    await this.riot.pause();
    const flipped = await this.redis.set(REJECTED, new Date().toISOString(), 'NX');
    if (flipped === null) return;
    this.logger.warn('Riot rejected the API key; riot queue paused until a probe with the key file succeeds');
    await this.scheduleProbe();
  }

  async restore(): Promise<void> {
    await this.redis.del(REJECTED);
    await this.riot.resume();
    this.logger.log('Riot accepts the API key again; riot queue resumed');
  }

  async scheduleProbe(): Promise<void> {
    await this.maintenance.add(RIOT_KEY_PROBE_JOB, {}, {
      delay: this.config.riot.keyProbeIntervalMs,
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }
}
