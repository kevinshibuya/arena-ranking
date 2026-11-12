import type { ChampionRef } from '@arena/shared';
import { Inject, Injectable } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../core/database';
import { champions } from '../../db/schema';
import { championIconUrl } from './sources';

/** Champion names and icons by match-v5 champion id, from the cached Data Dragon patches. */
@Injectable()
export class ChampionCatalog {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Each id against the latest cached patch, or the most recent cached patch
   * that has it. An id no cached patch has comes back with a null name and icon.
   */
  async resolve(ids: Iterable<number>): Promise<Map<number, ChampionRef>> {
    const wanted = [...new Set(ids)];
    const resolved = new Map<number, ChampionRef>(wanted.map((id) => [id, { id, name: null, iconUrl: null }]));
    if (wanted.length === 0) return resolved;
    const rows = await this.db
      .selectDistinctOn([champions.championId], {
        id: champions.championId,
        patch: champions.patch,
        name: champions.name,
        image: champions.image,
      })
      .from(champions)
      .where(inArray(champions.championId, wanted))
      .orderBy(champions.championId, sql`string_to_array(${champions.patch}, '.')::int[] desc`);
    for (const row of rows) {
      resolved.set(row.id, { id: row.id, name: row.name, iconUrl: championIconUrl(row.patch, row.image) });
    }
    return resolved;
  }
}
