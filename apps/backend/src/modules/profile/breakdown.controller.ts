import type { ChampionsResponse, MatchesResponse, ProfileScope, TeammatesResponse } from '@arena/shared';
import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../core/database';
import { parseFormat, parseRegion } from '../../core/request-params';
import { players } from '../../db/schema';
import { SeasonsService } from '../seasons/seasons.service';
import { BreakdownQuery, type MatchCursor } from './breakdown-query';
import type { SeasonScope } from './profile-query';

function seasonScope(scope: ProfileScope): SeasonScope {
  return scope.kind === 'season' ? scope.seasonId : null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function encodeCursor(cursor: MatchCursor): string {
  return Buffer.from(JSON.stringify([cursor.startedAt.toISOString(), cursor.matchId])).toString('base64url');
}

function decodeCursor(raw: string | undefined): MatchCursor | null {
  if (raw === undefined || raw === '') return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string') {
      const startedAt = new Date(value[0]);
      if (!Number.isNaN(startedAt.getTime())) return { startedAt, matchId: value[1] };
    }
  } catch {
    // Not base64url JSON; fall through.
  }
  throw new BadRequestException('Unknown cursor');
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}

/**
 * A tracked player's champions, teammates and matches, by region and the Riot ID
 * last seen for them, for one format (default 6x3) and one scope (`season`: a
 * season id or `all`, the current season by default). Answers from stored
 * matches only; never calls Riot, so a Riot ID not seen yet is a 404.
 */
@Controller('profiles/:region/:gameName/:tagLine')
export class BreakdownController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly seasons: SeasonsService,
    private readonly query: BreakdownQuery,
  ) {}

  @Get('champions')
  async champions(
    @Param('region') region: string,
    @Param('gameName') gameName: string,
    @Param('tagLine') tagLine: string,
    @Query('format') rawFormat?: string,
    @Query('season') rawSeason?: string,
  ): Promise<ChampionsResponse> {
    const { puuid, format, scope } = await this.resolve(region, gameName, tagLine, rawFormat, rawSeason);
    return { format, scope, champions: await this.query.champions(puuid, format, seasonScope(scope)) };
  }

  @Get('teammates')
  async teammates(
    @Param('region') region: string,
    @Param('gameName') gameName: string,
    @Param('tagLine') tagLine: string,
    @Query('format') rawFormat?: string,
    @Query('season') rawSeason?: string,
  ): Promise<TeammatesResponse> {
    const { puuid, format, scope } = await this.resolve(region, gameName, tagLine, rawFormat, rawSeason);
    return { format, scope, teammates: await this.query.teammates(puuid, format, seasonScope(scope)) };
  }

  @Get('matches')
  async matches(
    @Param('region') region: string,
    @Param('gameName') gameName: string,
    @Param('tagLine') tagLine: string,
    @Query('format') rawFormat?: string,
    @Query('season') rawSeason?: string,
    @Query('cursor') rawCursor?: string,
    @Query('limit') rawLimit?: string,
  ): Promise<MatchesResponse> {
    const cursor = decodeCursor(rawCursor);
    const limit = parseLimit(rawLimit);
    const { puuid, format, scope } = await this.resolve(region, gameName, tagLine, rawFormat, rawSeason);
    const page = await this.query.matches(puuid, format, seasonScope(scope), limit, cursor);
    return { format, scope, matches: page.matches, nextCursor: page.next ? encodeCursor(page.next) : null };
  }

  private async resolve(
    rawRegion: string,
    gameName: string,
    tagLine: string,
    rawFormat: string | undefined,
    rawSeason: string | undefined,
  ) {
    const region = parseRegion(rawRegion);
    const format = parseFormat(rawFormat);
    const scope = await this.seasons.scope(rawSeason);
    // Case-insensitively, as Riot matches a Riot ID; the newest sighting wins a name two accounts held.
    const [player] = await this.db
      .select({ puuid: players.puuid })
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
    if (!player) throw new NotFoundException(`No tracked player ${gameName}#${tagLine}`);
    return { puuid: player.puuid, format, scope };
  }
}
