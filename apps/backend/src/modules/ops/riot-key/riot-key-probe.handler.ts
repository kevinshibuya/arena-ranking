import { Injectable, Logger } from '@nestjs/common';
import { JobHandler, QUEUES, type QueueJobHandler } from '../../../core/queues';
import { RiotClient } from '../../riot-client/riot-client';
import { REGIONS, type Region } from '../../riot-client/regions';
import { RIOT_KEY_PROBE_JOB, RiotKeyGuard } from './riot-key-guard';

const PROBE_REGION = Object.keys(REGIONS)[0] as Region;

/** One cheap request with the key file's contents; success restores the key, anything else probes again later. */
@JobHandler({ queue: QUEUES.maintenance, name: RIOT_KEY_PROBE_JOB })
@Injectable()
export class RiotKeyProbeHandler implements QueueJobHandler<void, void> {
  private readonly logger = new Logger(RiotKeyProbeHandler.name);

  constructor(
    private readonly riot: RiotClient,
    private readonly key: RiotKeyGuard,
  ) {}

  async handle(): Promise<void> {
    if ((await this.key.state()) === 'ok') return;
    const accepted = await this.riot.platformStatus(PROBE_REGION).then(
      (result) => result.kind === 'ok',
      (error: unknown) => {
        this.logger.warn({ err: error }, 'key probe could not reach Riot');
        return false;
      },
    );
    if (accepted) await this.key.restore();
    else await this.key.scheduleProbe();
  }
}
