import { Controller, Get } from '@nestjs/common';
import type { SeasonsResponse } from '@arena/shared';
import { currentSeason } from './season-lookup';
import { SeasonsService } from './seasons.service';

@Controller('seasons')
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get()
  async list(): Promise<SeasonsResponse> {
    const seasons = await this.seasons.list();
    const current = currentSeason(seasons, new Date());
    return {
      seasons: seasons.map((season) => ({
        id: season.id,
        name: season.name,
        firstPatch: season.firstPatch,
        startsAt: season.startsAt.toISOString(),
        current: season.id === current?.id,
      })),
    };
  }
}
