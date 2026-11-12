import type { RatingResponse } from '@arena/shared';
import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { CONFIG, type Config } from '../../core/config';
import { parseFormat, parseRegion } from '../../core/request-params';
import { SeasonsService } from '../seasons/seasons.service';
import { ratingScope, Ratings } from './ratings';
import { ReplaySchedule } from './replay-schedule';

@Controller('profiles')
export class RatingController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly seasons: SeasonsService,
    private readonly ratings: Ratings,
    private readonly schedule: ReplaySchedule,
  ) {}

  /**
   * A tracked player's rating in one format and scope from the latest complete
   * replay, whether it ranks them, and its history. Never asks Riot: a Riot ID
   * not seen yet is a 404.
   */
  @Get(':region/:gameName/:tagLine/rating')
  async rating(
    @Param('region') rawRegion: string,
    @Param('gameName') gameName: string,
    @Param('tagLine') tagLine: string,
    @Query('format') rawFormat?: string,
    @Query('season') rawSeason?: string,
  ): Promise<RatingResponse> {
    const region = parseRegion(rawRegion);
    const format = parseFormat(rawFormat);
    const scope = await this.seasons.scope(rawSeason);
    const player = await this.ratings.playerByRiotId(region, gameName, tagLine);
    if (!player) throw new NotFoundException(`No tracked player ${gameName}#${tagLine}`);

    const [run, times] = await Promise.all([this.ratings.latestRun(), this.schedule.times()]);
    const key = ratingScope(scope);
    const [rating, history] = run
      ? await Promise.all([
          this.ratings.of(run.id, player.puuid, format, key),
          this.ratings.history(run.id, player.puuid, format, key),
        ])
      : [null, []];
    const games = rating?.games ?? 0;
    const minGames = this.config.ladderMinGames;
    return {
      player: { puuid: player.puuid, region: player.region, gameName: player.gameName ?? gameName, tagLine: player.tagLine ?? tagLine },
      format,
      scope,
      rating: rating?.ordinal ?? null,
      games,
      ranked: games >= minGames,
      gamesRemaining: Math.max(0, minGames - games),
      history,
      ...times,
    };
  }
}
