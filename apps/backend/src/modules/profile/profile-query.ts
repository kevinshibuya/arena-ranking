import type { FormatId, PlacementCount, ProfileTotals } from '@arena/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, type SQL } from 'drizzle-orm';
import { DATABASE, type Database } from '../../core/database';
import { matches, participants } from '../../db/schema';

/** A season id, or null for all-time. */
export type SeasonScope = number | null;

/** Teams in a format, from its id (`6x3` has 6); none for irregular. */
function teamCount(format: FormatId): number {
  const teams = /^(\d+)x\d+$/.exec(format)?.[1];
  return teams === undefined ? 0 : Number(teams);
}

/** A player's numbers, aggregated from the stored matches of one format and scope. */
@Injectable()
export class ProfileQuery {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async totals(puuid: string, format: FormatId, season: SeasonScope): Promise<ProfileTotals> {
    const where: SQL[] = [eq(participants.puuid, puuid), eq(matches.format, format)];
    if (season !== null) where.push(eq(matches.seasonId, season));
    const rows = await this.db
      .select({ placement: participants.placement, games: count() })
      .from(participants)
      .innerJoin(matches, eq(matches.id, participants.matchId))
      .where(and(...where))
      .groupBy(participants.placement);

    const byPlacement = new Map(rows.map((row) => [row.placement, row.games]));
    const buckets = Math.max(teamCount(format), ...byPlacement.keys());
    const placements: PlacementCount[] = Array.from({ length: buckets }, (_, index) => ({
      placement: index + 1,
      games: byPlacement.get(index + 1) ?? 0,
    }));
    const games = rows.reduce((sum, row) => sum + row.games, 0);
    const placed = rows.reduce((sum, row) => sum + row.placement * row.games, 0);
    const top4 = rows.filter((row) => row.placement <= 4).reduce((sum, row) => sum + row.games, 0);
    return {
      games,
      wins: byPlacement.get(1) ?? 0,
      top4Rate: games === 0 ? null : top4 / games,
      averagePlacement: games === 0 ? null : placed / games,
      placements,
    };
  }
}
