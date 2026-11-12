import type { ProfileResponse } from '@arena/shared';
import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { parseFormat, parseRegion } from '../../core/request-params';
import { SeasonsService } from '../seasons/seasons.service';
import { PlayerSearch } from '../sync/player-search';
import { ProfileQuery } from './profile-query';

@Controller('profiles')
export class ProfileController {
  constructor(
    private readonly search: PlayerSearch,
    private readonly seasons: SeasonsService,
    private readonly query: ProfileQuery,
  ) {}

  /**
   * A profile by Riot ID, for one format (default 6x3) and one scope: `season`
   * is a season id or `all`, the current season by default.
   */
  @Get(':region/:gameName/:tagLine')
  async profile(
    @Param('region') rawRegion: string,
    @Param('gameName') gameName: string,
    @Param('tagLine') tagLine: string,
    @Query('format') rawFormat?: string,
    @Query('season') rawSeason?: string,
  ): Promise<ProfileResponse> {
    const region = parseRegion(rawRegion);
    const format = parseFormat(rawFormat);
    const scope = await this.seasons.scope(rawSeason);

    const player = await this.search.search(region, gameName, tagLine);
    if (!player) throw new NotFoundException(`No such Riot ID: ${gameName}#${tagLine}`);

    const riotId = { gameName: player.gameName ?? gameName, tagLine: player.tagLine ?? tagLine };
    return {
      player: { puuid: player.puuid, region: player.region, ...riotId },
      syncState: player.syncState,
      ...(player.syncState === 'no-arena-games'
        ? { message: `${riotId.gameName}#${riotId.tagLine} has no Arena games in any season` }
        : {}),
      format,
      scope,
      totals: await this.query.totals(player.puuid, format, scope.kind === 'season' ? scope.seasonId : null),
    };
  }
}
