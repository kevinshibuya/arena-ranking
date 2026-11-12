import type { RefreshResponse } from '@arena/shared';
import { Controller, Get, HttpStatus, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parseRegion } from '../../core/request-params';
import { ProfileRefresh } from './profile-refresh';
import type { Player } from './sync-runs';

@Controller('profiles')
export class RefreshController {
  constructor(private readonly refreshes: ProfileRefresh) {}

  /** The cooldown left and the last sync, for a tracked player. */
  @Get(':region/:gameName/:tagLine/refresh')
  async state(
    @Param('region') rawRegion: string,
    @Param('gameName') gameName: string,
    @Param('tagLine') tagLine: string,
  ): Promise<RefreshResponse> {
    return this.refreshes.state(await this.player(rawRegion, gameName, tagLine));
  }

  /**
   * Update now: 202 when a sync was queued, 429 with Retry-After when the
   * profile's cooldown or the client's limit refused it. The client is
   * `req.ip`: the X-Forwarded-For address only from a trusted proxy.
   */
  @Post(':region/:gameName/:tagLine/refresh')
  async refresh(
    @Param('region') rawRegion: string,
    @Param('gameName') gameName: string,
    @Param('tagLine') tagLine: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    const player = await this.player(rawRegion, gameName, tagLine);
    const result = await this.refreshes.refresh(player, req.ip ?? req.socket.remoteAddress ?? 'unknown');
    if (result.refused) {
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      res.setHeader('Retry-After', String(result.refused === 'rate-limited' ? result.retryAfterSeconds : result.cooldownSeconds));
    } else {
      res.status(result.queued ? HttpStatus.ACCEPTED : HttpStatus.OK);
    }
    return result;
  }

  private async player(rawRegion: string, gameName: string, tagLine: string): Promise<Player> {
    const player = await this.refreshes.player(parseRegion(rawRegion), gameName, tagLine);
    if (!player) throw new NotFoundException(`No tracked player ${gameName}#${tagLine}`);
    return player;
  }
}
