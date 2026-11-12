import { readFile } from 'node:fs/promises';
import type { Config } from '../../core/config';
import { REGIONS, type Region, type RiotHost } from './regions';
import type { AccountDto, MatchDto, MatchIdsQuery, PlatformStatusDto } from './riot.types';

// The one module that performs HTTP to Riot. Every call reports what Riot said,
// typed: the result, the rate-limit headers and, on 429, Retry-After. It never
// retries and never sleeps; pacing, back-off and pausing on a rejected key belong
// to the queue layer.
//
// The key is read from RIOT_KEY_FILE for every request, so a batch always uses
// the file's current contents and the request after a 401 or 403 picks up a
// replaced key. RIOT_API_KEY is the fallback while no file is configured, or the
// file is missing or empty.

export type RiotClientConfig = Pick<Config['riot'], 'keyFile' | 'apiKey' | 'baseAmericas' | 'baseBr1'>;

export interface RateLimitWindow {
  seconds: number;
  limit: number;
  /** Requests counted in this window, from the matching -Count header; 0 when absent. */
  used: number;
}

export interface RateLimits {
  /** X-App-Rate-Limit and X-App-Rate-Limit-Count. */
  app: RateLimitWindow[];
  /** X-Method-Rate-Limit and X-Method-Rate-Limit-Count. */
  method: RateLimitWindow[];
}

export type RiotResult<T> =
  | { kind: 'ok'; status: number; data: T; rateLimits: RateLimits }
  | { kind: 'not-found'; status: 404; rateLimits: RateLimits }
  | {
      kind: 'rate-limited';
      status: 429;
      /** Absent when Riot sent no Retry-After, which its edge does on some 429s. */
      retryAfterSeconds: number | undefined;
      /** X-Rate-Limit-Type: application, method or service. */
      limitType: string | undefined;
      rateLimits: RateLimits;
    }
  | { kind: 'key-rejected'; status: 401 | 403; rateLimits: RateLimits }
  | { kind: 'error'; status: number; body: string; rateLimits: RateLimits };

/** One request and its raw response, for observers such as the fixture recorder. */
export interface RiotExchange {
  host: RiotHost;
  /** Path without the query, as sent. */
  path: string;
  query: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface RiotClientOptions {
  /** Called after every response, before it is interpreted. */
  onExchange?: (exchange: RiotExchange) => void;
  /** Awaited with every response's rate-limit windows before the result returns. */
  onRateLimits?: (limits: RateLimits) => Promise<void>;
  /** Per-request timeout. Defaults to 10 seconds. */
  timeoutMs?: number;
}

export class RiotKeyMissingError extends Error {
  constructor() {
    super('No Riot API key: RIOT_KEY_FILE is unset, missing or empty, and RIOT_API_KEY is unset');
    this.name = 'RiotKeyMissingError';
  }
}

function windows(limitHeader: string | null, countHeader: string | null): RateLimitWindow[] {
  if (!limitHeader) return [];
  const used = new Map<number, number>();
  for (const pair of (countHeader ?? '').split(',')) {
    const [count, seconds] = pair.split(':').map(Number);
    if (Number.isFinite(count) && Number.isFinite(seconds)) used.set(seconds!, count!);
  }
  return limitHeader.split(',').flatMap((pair) => {
    const [limit, seconds] = pair.split(':').map(Number);
    if (!Number.isFinite(limit) || !Number.isFinite(seconds)) return [];
    return [{ seconds: seconds!, limit: limit!, used: used.get(seconds!) ?? 0 }];
  });
}

function rateLimits(headers: Headers): RateLimits {
  return {
    app: windows(headers.get('x-app-rate-limit'), headers.get('x-app-rate-limit-count')),
    method: windows(headers.get('x-method-rate-limit'), headers.get('x-method-rate-limit-count')),
  };
}

function retryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export class RiotClient {
  private readonly bases: Record<RiotHost, string>;

  constructor(
    private readonly config: RiotClientConfig,
    private readonly options: RiotClientOptions = {},
  ) {
    this.bases = { americas: config.baseAmericas, br1: config.baseBr1 };
  }

  accountByRiotId(region: Region, gameName: string, tagLine: string): Promise<RiotResult<AccountDto>> {
    const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    return this.get(REGIONS[region].regional, path);
  }

  accountByPuuid(region: Region, puuid: string): Promise<RiotResult<AccountDto>> {
    return this.get(REGIONS[region].regional, `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`);
  }

  matchIdsByPuuid(region: Region, puuid: string, query: MatchIdsQuery = {}): Promise<RiotResult<string[]>> {
    const params = new URLSearchParams();
    if (query.queue !== undefined) params.set('queue', String(query.queue));
    if (query.startTime !== undefined) params.set('startTime', String(Math.floor(query.startTime.getTime() / 1000)));
    if (query.endTime !== undefined) params.set('endTime', String(Math.floor(query.endTime.getTime() / 1000)));
    if (query.start !== undefined) params.set('start', String(query.start));
    if (query.count !== undefined) params.set('count', String(query.count));
    return this.get(REGIONS[region].regional, `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`, params);
  }

  matchById(region: Region, matchId: string): Promise<RiotResult<MatchDto>> {
    return this.get(REGIONS[region].regional, `/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
  }

  /** lol-status-v4: the cheapest request there is, for checking that the key is accepted. */
  platformStatus(region: Region): Promise<RiotResult<PlatformStatusDto>> {
    return this.get(REGIONS[region].platform, '/lol/status/v4/platform-data');
  }

  private async key(): Promise<string> {
    if (this.config.keyFile !== undefined) {
      const fromFile = await readFile(this.config.keyFile, 'utf8').then(
        (text) => text.trim(),
        () => '',
      );
      if (fromFile !== '') return fromFile;
    }
    if (this.config.apiKey !== undefined && this.config.apiKey !== '') return this.config.apiKey;
    throw new RiotKeyMissingError();
  }

  private async get<T>(host: RiotHost, path: string, params = new URLSearchParams()): Promise<RiotResult<T>> {
    const key = await this.key();
    const query = params.toString();
    const response = await fetch(`${this.bases[host]}${path}${query ? `?${query}` : ''}`, {
      headers: { 'X-Riot-Token': key, accept: 'application/json' },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
    });
    const body = await response.text();
    this.options.onExchange?.({
      host,
      path,
      query,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body,
    });

    const limits = rateLimits(response.headers);
    await this.options.onRateLimits?.(limits);
    const status = response.status;
    if (status >= 200 && status < 300) return { kind: 'ok', status, data: JSON.parse(body) as T, rateLimits: limits };
    if (status === 404) return { kind: 'not-found', status, rateLimits: limits };
    if (status === 401 || status === 403) return { kind: 'key-rejected', status, rateLimits: limits };
    if (status === 429) {
      return {
        kind: 'rate-limited',
        status,
        retryAfterSeconds: retryAfter(response.headers),
        limitType: response.headers.get('x-rate-limit-type') ?? undefined,
        rateLimits: limits,
      };
    }
    return { kind: 'error', status, body, rateLimits: limits };
  }
}
