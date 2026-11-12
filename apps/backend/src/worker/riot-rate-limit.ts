import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export interface RateWindow {
  max: number;
  durationMs: number;
}

// One sorted set per window holds the times of the requests inside it. A slot
// is taken in every window at once, or in none: the script answers how long
// until the fullest window frees one.
const ACQUIRE = `
local now = tonumber(ARGV[1])
local wait = 0
for i, key in ipairs(KEYS) do
  local max = tonumber(ARGV[1 + i * 2])
  local duration = tonumber(ARGV[2 + i * 2])
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - duration)
  if redis.call('ZCARD', key) >= max then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    wait = math.max(wait, tonumber(oldest[2]) + duration - now)
  end
end
if wait > 0 then return wait end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, ARGV[2])
  redis.call('PEXPIRE', key, tonumber(ARGV[2 + i * 2]))
end
return 0
`;

/**
 * `full` is the whole window: the Riot ID lookup a search waits on. `capped` is
 * the window less its reserve: every prioritised sync job.
 */
export type RateShare = 'full' | 'capped';

/**
 * The slots of a window kept for the lookup: a tenth, rounded up so a small
 * window still keeps one (2 of 20 per second, 10 of 100 per two minutes on the
 * development key), and never the whole window, so a window of 1 still admits syncs.
 */
export function lookupReserve(max: number): number {
  return Math.min(Math.ceil(max / 10), max - 1);
}

/**
 * Every window of the Riot key at once, shared by every worker process through
 * Redis. Riot counts requests, and each `riot` job makes exactly one, so a job
 * takes a slot before it runs. Both shares take slots in the same windows, so
 * the key never goes past Riot's limits.
 */
export class RiotRateLimit {
  constructor(
    private readonly redis: Redis,
    private readonly windows: readonly RateWindow[],
  ) {}

  /** 0 when a slot was taken, otherwise the milliseconds until one frees up. */
  async acquire(share: RateShare, now = Date.now()): Promise<number> {
    const keys = this.windows.map((window) => `riot-rate:${window.durationMs}`);
    const args = this.windows.flatMap((window) => [
      share === 'full' ? window.max : window.max - lookupReserve(window.max),
      window.durationMs,
    ]);
    const wait = await this.redis.eval(ACQUIRE, keys.length, ...keys, now, randomUUID(), ...args);
    return Number(wait);
  }
}
