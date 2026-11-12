import type { FormatId, LadderEntry, LadderPosition } from '@arena/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, lt, or, type SQL } from 'drizzle-orm';
import { DATABASE, type Database } from '../../core/database';
import { players, ratings } from '../../db/schema';
import type { RatingScope } from '../rating/rating-replay';
import type { StoredRating } from '../rating/ratings';
import type { Region } from '../riot-client/regions';

/** One ladder: a complete run's ratings in one region, format and scope, from a minimum of games. */
export interface LadderKey {
  runId: number;
  region: Region;
  format: FormatId;
  scope: RatingScope;
  minGames: number;
}

/** The last row of a page: where the next page starts. */
export interface LadderMark {
  ordinal: number;
  puuid: string;
  rank: number;
}

/** Highest ordinal first; equal ordinals by PUUID, so every row has one position. */
function ahead(mark: { ordinal: number; puuid: string }): SQL {
  return or(gt(ratings.ordinal, mark.ordinal), and(eq(ratings.ordinal, mark.ordinal), lt(ratings.puuid, mark.puuid)))!;
}

function behind(mark: { ordinal: number; puuid: string }): SQL {
  return or(lt(ratings.ordinal, mark.ordinal), and(eq(ratings.ordinal, mark.ordinal), gt(ratings.puuid, mark.puuid)))!;
}

@Injectable()
export class LadderQuery {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private listed(key: LadderKey): SQL {
    return and(
      eq(ratings.runId, key.runId),
      eq(ratings.format, key.format),
      eq(ratings.scope, key.scope),
      gte(ratings.games, key.minGames),
      eq(players.region, key.region),
    )!;
  }

  /** Up to `limit` rows after `after` (from the top without it), and the mark of the next page if there is one. */
  async page(key: LadderKey, limit: number, after?: LadderMark): Promise<{ entries: LadderEntry[]; next: LadderMark | null }> {
    const rows = await this.db
      .select({
        puuid: ratings.puuid,
        gameName: players.gameName,
        tagLine: players.tagLine,
        ordinal: ratings.ordinal,
        games: ratings.games,
        wins: ratings.wins,
        top4s: ratings.top4s,
        placementSum: ratings.placementSum,
      })
      .from(ratings)
      .innerJoin(players, eq(players.puuid, ratings.puuid))
      .where(after ? and(this.listed(key), behind(after)) : this.listed(key))
      .orderBy(desc(ratings.ordinal), asc(ratings.puuid))
      .limit(limit + 1);

    const firstRank = (after?.rank ?? 0) + 1;
    const entries = rows.slice(0, limit).map(
      (row, index): LadderEntry => ({
        rank: firstRank + index,
        player: { puuid: row.puuid, gameName: row.gameName, tagLine: row.tagLine },
        rating: row.ordinal,
        games: row.games,
        winRate: row.wins / row.games,
        top4Rate: row.top4s / row.games,
        averagePlacement: row.placementSum / row.games,
      }),
    );
    const last = entries.at(-1);
    return {
      entries,
      next: rows.length > limit && last ? { ordinal: last.rating, puuid: last.player.puuid, rank: last.rank } : null,
    };
  }

  /** Where a player with this rating (or none) stands on the ladder. */
  async position(key: LadderKey, rating: StoredRating | null): Promise<LadderPosition> {
    const games = rating?.games ?? 0;
    if (!rating || games < key.minGames) {
      return { ranked: false, games, gamesRemaining: key.minGames - games };
    }
    const [row] = await this.db
      .select({ ahead: count() })
      .from(ratings)
      .innerJoin(players, eq(players.puuid, ratings.puuid))
      .where(and(this.listed(key), ahead(rating)));
    return { ranked: true, rank: (row?.ahead ?? 0) + 1, rating: rating.ordinal, games };
  }
}
