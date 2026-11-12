import { Inject, Injectable } from '@nestjs/common';
import type { AppRateBudget } from '@arena/shared';
import { Redis } from 'ioredis';
import { REDIS } from '../../core/redis';
import type { RateLimits } from './riot-client';

const KEY = 'riot:app-budget';

/**
 * The key's app-level budget as Riot last reported it, kept in Redis so every
 * process reads the same. The client records every response that carries the
 * app headers; health reports it.
 */
@Injectable()
export class RiotBudget {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async record(limits: RateLimits, at = new Date()): Promise<void> {
    if (limits.app.length === 0) return;
    const budget: AppRateBudget = {
      observedAt: at.toISOString(),
      windows: limits.app
        .map(({ seconds, limit, used }) => ({ seconds, limit, remaining: Math.max(0, limit - used) }))
        .sort((a, b) => a.seconds - b.seconds),
    };
    await this.redis.set(KEY, JSON.stringify(budget));
  }

  async read(): Promise<AppRateBudget | null> {
    const raw = await this.redis.get(KEY);
    return raw === null ? null : (JSON.parse(raw) as AppRateBudget);
  }
}
