import type { LadderPositionResponse, LadderResponse } from '@arena/shared';
import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { CONFIG, type Config } from '../../core/config';
import { parseLadderFormat, parseRegion } from '../../core/request-params';
import { ratingScope, Ratings } from '../rating/ratings';
import { ReplaySchedule } from '../rating/replay-schedule';
import { SeasonsService } from '../seasons/seasons.service';
import { decodeCursor, encodeCursor } from './ladder-cursor';
import { LadderQuery } from './ladder-query';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}

@Controller('ladders')
export class LadderController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly seasons: SeasonsService,
    private readonly ratings: Ratings,
    private readonly schedule: ReplaySchedule,
    private readonly query: LadderQuery,
  ) {}

  /**
   * One ladder from the latest complete replay: players with at least
   * LADDER_MIN_GAMES games in the format (default 6x3) and scope (`season`: a
   * season id or `all`, the current season by default), highest rating first.
   * A cursor reads on from the run its first page came from, while that run is kept.
   */
  @Get(':region')
  async ladder(
    @Param('region') rawRegion: string,
    @Query('format') rawFormat?: string,
    @Query('season') rawSeason?: string,
    @Query('limit') rawLimit?: string,
    @Query('cursor') rawCursor?: string,
  ): Promise<LadderResponse> {
    const region = parseRegion(rawRegion);
    const format = parseLadderFormat(rawFormat);
    const limit = parseLimit(rawLimit);
    const cursor = rawCursor ? decodeCursor(rawCursor) : undefined;
    const scope = await this.seasons.scope(rawSeason);
    const minGames = this.config.ladderMinGames;

    const [run, times] = await Promise.all([this.ratings.latestRun(), this.schedule.times()]);
    const base = { region, format, scope, minGames, ...times };
    if (cursor && !(await this.ratings.isComplete(cursor.runId))) {
      throw new BadRequestException('The ladder has been recomputed since this cursor; start from the first page');
    }
    const runId = cursor?.runId ?? run?.id;
    if (runId === undefined) return { ...base, entries: [], nextCursor: null };

    const page = await this.query.page({ runId, region, format, scope: ratingScope(scope), minGames }, limit, cursor);
    return {
      ...base,
      entries: page.entries,
      nextCursor: page.next ? encodeCursor({ runId, ...page.next }) : null,
    };
  }

  /** Where a tracked player stands on one ladder: their rank, or the games they still need. */
  @Get(':region/players/:gameName/:tagLine')
  async position(
    @Param('region') rawRegion: string,
    @Param('gameName') gameName: string,
    @Param('tagLine') tagLine: string,
    @Query('format') rawFormat?: string,
    @Query('season') rawSeason?: string,
  ): Promise<LadderPositionResponse> {
    const region = parseRegion(rawRegion);
    const format = parseLadderFormat(rawFormat);
    const scope = await this.seasons.scope(rawSeason);
    const minGames = this.config.ladderMinGames;
    const player = await this.ratings.playerByRiotId(region, gameName, tagLine);
    if (!player) throw new NotFoundException(`No tracked player ${gameName}#${tagLine}`);

    const run = await this.ratings.latestRun();
    const key = { runId: run?.id ?? 0, region, format, scope: ratingScope(scope), minGames };
    const rating = run ? await this.ratings.of(run.id, player.puuid, format, key.scope) : null;
    return {
      player: { puuid: player.puuid, gameName: player.gameName, tagLine: player.tagLine },
      format,
      scope,
      minGames,
      ...(await this.query.position(key, rating)),
    };
  }
}
