import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CONFIG, type Config } from '../../core/config';
import { DATABASE, type Database } from '../../core/database';
import { JobHandler, QUEUES, type QueueJobHandler } from '../../core/queues';
import { augments, champions, staticDataRefreshes } from '../../db/schema';
import { STATIC_DATA_REFRESH_JOB } from './refresh-now';
import {
  CDRAGON_ARENA_PATH,
  DDRAGON_VERSIONS_PATH,
  ddragonChampionsPath,
  type CdragonArena,
  type DdragonChampions,
  type DdragonVersions,
} from './sources';

const VERSION = /^\d+\.\d+\.\d+$/;

/**
 * Fetches the newest Data Dragon version's champions and the Arena augment
 * list, and upserts both in one transaction. Earlier patches stay cached, so a
 * champion missing from the newest one still resolves. Any answer but a 200
 * fails the job and changes nothing.
 */
@JobHandler({ queue: QUEUES.maintenance, name: STATIC_DATA_REFRESH_JOB })
@Injectable()
export class StaticDataRefreshHandler implements QueueJobHandler<void, void> {
  private readonly logger = new Logger(StaticDataRefreshHandler.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async handle(): Promise<void> {
    const versions = await this.get<DdragonVersions>(this.config.ddragonBase, DDRAGON_VERSIONS_PATH);
    const patch = versions.find((version) => VERSION.test(version));
    if (!patch) throw new Error(`${DDRAGON_VERSIONS_PATH} lists no version`);
    const championData = await this.get<DdragonChampions>(this.config.ddragonBase, ddragonChampionsPath(patch));
    const arena = await this.get<CdragonArena>(this.config.cdragonBase, CDRAGON_ARENA_PATH);

    const championRows = Object.values(championData.data).map((champion) => ({
      patch,
      championId: Number(champion.key),
      name: champion.name,
      image: champion.image.full,
    }));
    const augmentRows = arena.augments.map((augment) => ({
      id: augment.id,
      apiName: augment.apiName,
      name: augment.name,
      rarity: augment.rarity,
      iconSmall: augment.iconSmall,
      iconLarge: augment.iconLarge,
    }));

    await this.db.transaction(async (tx) => {
      if (championRows.length > 0) {
        await tx
          .insert(champions)
          .values(championRows)
          .onConflictDoUpdate({
            target: [champions.patch, champions.championId],
            set: { name: sql`excluded.name`, image: sql`excluded.image` },
          });
      }
      if (augmentRows.length > 0) {
        await tx
          .insert(augments)
          .values(augmentRows)
          .onConflictDoUpdate({
            target: augments.id,
            set: {
              apiName: sql`excluded.api_name`,
              name: sql`excluded.name`,
              rarity: sql`excluded.rarity`,
              iconSmall: sql`excluded.icon_small`,
              iconLarge: sql`excluded.icon_large`,
            },
          });
      }
      await tx
        .insert(staticDataRefreshes)
        .values({ patch, champions: championRows.length, augments: augmentRows.length });
    });
    this.logger.log({ patch, champions: championRows.length, augments: augmentRows.length }, 'static data refreshed');
  }

  private async get<T>(base: string, path: string): Promise<T> {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
    return (await response.json()) as T;
  }
}
