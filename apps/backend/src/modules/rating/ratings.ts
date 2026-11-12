import type { FormatId, ProfileScope, RatingHistoryPoint } from '@arena/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../core/database';
import { matches, players, ratingHistory, ratings, replayRuns } from '../../db/schema';
import type { Region } from '../riot-client/regions';
import { ALL_TIME, seasonScope, type RatingScope } from './rating-replay';

export type Player = typeof players.$inferSelect;
export type StoredRating = typeof ratings.$inferSelect;

export interface CompleteRun {
  id: number;
  completedAt: Date;
}

export function ratingScope(scope: ProfileScope): RatingScope {
  return scope.kind === 'season' ? seasonScope(scope.seasonId) : ALL_TIME;
}

/** Reads what replay runs wrote. Only complete runs are ever read. */
@Injectable()
export class Ratings {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The run every reader uses: the latest complete one, or none before the first. */
  async latestRun(): Promise<CompleteRun | null> {
    const [run] = await this.db
      .select({ id: replayRuns.id, completedAt: replayRuns.completedAt })
      .from(replayRuns)
      .where(isNotNull(replayRuns.completedAt))
      .orderBy(desc(replayRuns.id))
      .limit(1);
    return run ? { id: run.id, completedAt: run.completedAt! } : null;
  }

  /** Whether a run is complete and not yet pruned. */
  async isComplete(runId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: replayRuns.id })
      .from(replayRuns)
      .where(and(eq(replayRuns.id, runId), isNotNull(replayRuns.completedAt)));
    return rows.length > 0;
  }

  /**
   * A tracked player by the Riot ID last seen for them, case-insensitively as
   * Riot matches it. Never asks Riot.
   */
  async playerByRiotId(region: Region, gameName: string, tagLine: string): Promise<Player | null> {
    const [player] = await this.db
      .select()
      .from(players)
      .where(
        and(
          eq(players.region, region),
          sql`lower(${players.gameName}) = lower(${gameName})`,
          sql`lower(${players.tagLine}) = lower(${tagLine})`,
        ),
      )
      .orderBy(sql`${players.riotIdSeenAt} desc nulls last`)
      .limit(1);
    return player ?? null;
  }

  async of(runId: number, puuid: string, format: FormatId, scope: RatingScope): Promise<StoredRating | null> {
    const [row] = await this.db
      .select()
      .from(ratings)
      .where(and(eq(ratings.runId, runId), eq(ratings.puuid, puuid), eq(ratings.format, format), eq(ratings.scope, scope)));
    return row ?? null;
  }

  /** One point per rated match, oldest first. */
  async history(runId: number, puuid: string, format: FormatId, scope: RatingScope): Promise<RatingHistoryPoint[]> {
    const rows = await this.db
      .select({ matchId: ratingHistory.matchId, endedAt: matches.endedAt, rating: ratingHistory.ordinalAfter })
      .from(ratingHistory)
      .innerJoin(matches, eq(matches.id, ratingHistory.matchId))
      .where(
        and(
          eq(ratingHistory.runId, runId),
          eq(ratingHistory.puuid, puuid),
          eq(ratingHistory.format, format),
          eq(ratingHistory.scope, scope),
        ),
      )
      .orderBy(asc(matches.endedAt), asc(matches.id));
    return rows.map((row) => ({ matchId: row.matchId, endedAt: row.endedAt.toISOString(), rating: row.rating }));
  }
}
