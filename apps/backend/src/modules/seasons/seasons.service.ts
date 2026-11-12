import type { ProfileScope } from '@arena/shared';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { DATABASE, type Database } from '../../core/database';
import { seasons } from '../../db/schema';
import { currentSeason, seasonForGameVersion, type Season } from './season-lookup';

/** Reads the seasons table; the mapping itself is in season-lookup. */
@Injectable()
export class SeasonsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Every season, oldest first. */
  list(): Promise<Season[]> {
    return this.db.select().from(seasons).orderBy(asc(seasons.startsAt));
  }

  /** The season of a match played on `gameVersion`, or null before the first season. */
  async forGameVersion(gameVersion: string): Promise<Season | null> {
    return seasonForGameVersion(gameVersion, await this.list());
  }

  /**
   * The scope a `season` query value names: a season id, `all` for all-time, or
   * the current season when absent. 400 for an unknown season.
   */
  async scope(raw: string | undefined): Promise<ProfileScope> {
    if (raw === 'all') return { kind: 'all-time' };
    const seasons = await this.list();
    const season =
      raw === undefined || raw === ''
        ? currentSeason(seasons, new Date())
        : seasons.find((candidate) => String(candidate.id) === raw);
    if (!season) throw new BadRequestException(raw ? `Unknown season: ${raw}` : 'No season has started yet');
    return { kind: 'season', seasonId: season.id, name: season.name };
  }
}
