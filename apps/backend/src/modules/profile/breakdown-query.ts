import type { ChampionStats, FormatId, MatchSummary, TeammateStats } from '@arena/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DATABASE, type Database } from '../../core/database';
import { matches, participants, players } from '../../db/schema';
import { ChampionCatalog } from '../static-data/champion-catalog';
import type { SeasonScope } from './profile-query';

/** Where a page of matches ends: the last game's start and id, newest-first order. */
export interface MatchCursor {
  startedAt: Date;
  matchId: string;
}

export interface MatchPage {
  matches: MatchSummary[];
  next: MatchCursor | null;
}

const mate = alias(participants, 'mate');

const wins = sql<number>`(count(*) filter (where ${participants.placement} = 1))::int`;
const top4 = sql<number>`(count(*) filter (where ${participants.placement} <= 4))::int`;

/** The player's breakdowns, aggregated from the stored matches of one format and scope. */
@Injectable()
export class BreakdownQuery {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly catalog: ChampionCatalog,
  ) {}

  private scoped(puuid: string, format: FormatId, season: SeasonScope): SQL[] {
    const where: SQL[] = [eq(participants.puuid, puuid), eq(matches.format, format)];
    if (season !== null) where.push(eq(matches.seasonId, season));
    return where;
  }

  /** One row per champion played: most games first, then the better average placement. */
  async champions(puuid: string, format: FormatId, season: SeasonScope): Promise<ChampionStats[]> {
    const rows = await this.db
      .select({
        championId: participants.championId,
        games: count(),
        wins,
        top4,
        placed: sql<number>`sum(${participants.placement})::int`,
      })
      .from(participants)
      .innerJoin(matches, eq(matches.id, participants.matchId))
      .where(and(...this.scoped(puuid, format, season)))
      .groupBy(participants.championId);

    const names = await this.catalog.resolve(rows.map((row) => row.championId));
    return rows
      .map((row) => ({
        champion: names.get(row.championId)!,
        games: row.games,
        wins: row.wins,
        top4Rate: row.top4 / row.games,
        averagePlacement: row.placed / row.games,
      }))
      .sort((a, b) => b.games - a.games || a.averagePlacement - b.averagePlacement || a.champion.id - b.champion.id);
  }

  /** Everyone who shared the player's subteam: most games together first, then most wins. */
  async teammates(puuid: string, format: FormatId, season: SeasonScope): Promise<TeammateStats[]> {
    const rows = await this.db
      .select({ puuid: mate.puuid, gameName: players.gameName, tagLine: players.tagLine, games: count(), wins, top4 })
      .from(participants)
      .innerJoin(matches, eq(matches.id, participants.matchId))
      .innerJoin(
        mate,
        and(eq(mate.matchId, participants.matchId), eq(mate.subteamId, participants.subteamId), ne(mate.puuid, participants.puuid)),
      )
      .leftJoin(players, eq(players.puuid, mate.puuid))
      .where(and(...this.scoped(puuid, format, season)))
      .groupBy(mate.puuid, players.gameName, players.tagLine);

    return rows
      .map((row) => ({
        puuid: row.puuid,
        gameName: row.gameName,
        tagLine: row.tagLine,
        games: row.games,
        wins: row.wins,
        top4Rate: row.top4 / row.games,
      }))
      .sort((a, b) => b.games - a.games || b.wins - a.wins || b.top4Rate - a.top4Rate || a.puuid.localeCompare(b.puuid));
  }

  /** Up to `limit` games newest first, after `cursor` when given. */
  async matches(
    puuid: string,
    format: FormatId,
    season: SeasonScope,
    limit: number,
    cursor: MatchCursor | null,
  ): Promise<MatchPage> {
    const where = this.scoped(puuid, format, season);
    if (cursor) {
      where.push(sql`(${matches.startedAt}, ${matches.id}) < (${cursor.startedAt.toISOString()}::timestamptz, ${cursor.matchId})`);
    }
    const rows = await this.db
      .select({
        matchId: matches.id,
        startedAt: matches.startedAt,
        durationSeconds: matches.durationSeconds,
        placement: participants.placement,
        championId: participants.championId,
      })
      .from(participants)
      .innerJoin(matches, eq(matches.id, participants.matchId))
      .where(and(...where))
      .orderBy(desc(matches.startedAt), desc(matches.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    if (page.length === 0) return { matches: [], next: null };

    const mates = await this.db
      .select({
        matchId: mate.matchId,
        puuid: mate.puuid,
        championId: mate.championId,
        gameName: players.gameName,
        tagLine: players.tagLine,
      })
      .from(participants)
      .innerJoin(
        mate,
        and(eq(mate.matchId, participants.matchId), eq(mate.subteamId, participants.subteamId), ne(mate.puuid, participants.puuid)),
      )
      .leftJoin(players, eq(players.puuid, mate.puuid))
      .where(and(eq(participants.puuid, puuid), inArray(participants.matchId, page.map((row) => row.matchId))))
      .orderBy(mate.puuid);

    const names = await this.catalog.resolve([...page.map((row) => row.championId), ...mates.map((row) => row.championId)]);
    const last = page[page.length - 1]!;
    return {
      matches: page.map((row) => ({
        matchId: row.matchId,
        placement: row.placement,
        champion: names.get(row.championId)!,
        teammates: mates
          .filter((m) => m.matchId === row.matchId)
          .map((m) => ({ puuid: m.puuid, gameName: m.gameName, tagLine: m.tagLine, champion: names.get(m.championId)! })),
        durationSeconds: row.durationSeconds,
        startedAt: row.startedAt.toISOString(),
      })),
      next: rows.length > limit ? { startedAt: last.startedAt, matchId: last.matchId } : null,
    };
  }
}
