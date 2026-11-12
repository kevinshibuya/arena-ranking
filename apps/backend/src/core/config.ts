// Every environment variable the backend reads, in one place. Defaults point at
// the local compose stack and the real upstreams, so a fresh clone runs with no
// .env file. The README lists the variables; tests override them per run.

import { DEFAULT_ARENA_QUEUE_IDS } from '../modules/riot-client/arena-queues';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  databaseUrl: string;
  redisUrl: string;
  /** Prefix for every Redis key, BullMQ's included. Unique per test or smoke run. */
  redisPrefix: string;
  logLevel: LogLevel;
  /** HTTP port of the API process. */
  port: number;
  riot: {
    keyFile: string | undefined;
    /** Used while the key file is unset, missing or empty. */
    apiKey: string | undefined;
    baseAmericas: string;
    baseBr1: string;
    ratePerSecond: number;
    ratePerTwoMinutes: number;
    /** How often a rejected key is probed with the key file's current contents. */
    keyProbeIntervalMs: number;
    /** Queue ids every Arena listing runs once per; see arena-queues.ts. */
    arenaQueueIds: number[];
  };
  ddragonBase: string;
  cdragonBase: string;
  ladderMinGames: number;
  /** How far back the sweep looks for a player's newest match. */
  sweepLookbackHours: number;
  /**
   * Addresses whose X-Forwarded-For the API believes, in Express's `trust proxy`
   * form (an address, a subnet, or `loopback`, `linklocal`, `uniquelocal`).
   * Empty trusts none: the client is the peer of the connection.
   */
  trustedProxies: string[];
  dashboard: { user: string | undefined; pass: string | undefined };
}

export const CONFIG = Symbol('CONFIG');

type Env = Record<string, string | undefined>;

function text(env: Env, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value === '' ? fallback : value;
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function positiveIntList(env: Env, name: string, fallback: readonly number[]): number[] {
  const raw = env[name];
  if (raw === undefined || raw === '') return [...fallback];
  const values = raw.split(',').map((part) => part.trim());
  if (values.some((value) => !/^[1-9][0-9]*$/.test(value))) {
    throw new Error(`${name} must be a comma-separated list of positive integers, got ${JSON.stringify(raw)}`);
  }
  return values.map(Number);
}

function textList(env: Env, name: string, fallback: readonly string[]): string[] {
  const raw = env[name];
  if (raw === undefined) return [...fallback];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function logLevel(env: Env): LogLevel {
  const raw = text(env, 'LOG_LEVEL', 'info');
  if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got ${JSON.stringify(raw)}`);
  }
  return raw as LogLevel;
}

export function loadConfig(env: Env): Config {
  return {
    databaseUrl: text(env, 'DATABASE_URL', 'postgres://arena:arena@localhost:54329/arena'),
    redisUrl: text(env, 'REDIS_URL', 'redis://localhost:63799'),
    redisPrefix: text(env, 'REDIS_PREFIX', 'arena'),
    logLevel: logLevel(env),
    port: positiveInt(env, 'PORT', 3001),
    riot: {
      keyFile: optional(env, 'RIOT_KEY_FILE'),
      apiKey: optional(env, 'RIOT_API_KEY'),
      baseAmericas: text(env, 'RIOT_API_BASE_AMERICAS', 'https://americas.api.riotgames.com'),
      baseBr1: text(env, 'RIOT_API_BASE_BR1', 'https://br1.api.riotgames.com'),
      ratePerSecond: positiveInt(env, 'RIOT_RATE_PER_SECOND', 20),
      ratePerTwoMinutes: positiveInt(env, 'RIOT_RATE_PER_TWO_MINUTES', 100),
      keyProbeIntervalMs: positiveInt(env, 'RIOT_KEY_PROBE_INTERVAL_MS', 60_000),
      arenaQueueIds: positiveIntList(env, 'ARENA_QUEUE_IDS', DEFAULT_ARENA_QUEUE_IDS),
    },
    ddragonBase: text(env, 'DDRAGON_BASE', 'https://ddragon.leagueoflegends.com'),
    cdragonBase: text(env, 'CDRAGON_BASE', 'https://raw.communitydragon.org'),
    ladderMinGames: positiveInt(env, 'LADDER_MIN_GAMES', 10),
    sweepLookbackHours: positiveInt(env, 'SWEEP_LOOKBACK_HOURS', 7 * 24),
    trustedProxies: textList(env, 'TRUSTED_PROXIES', ['loopback']),
    dashboard: { user: optional(env, 'DASHBOARD_USER'), pass: optional(env, 'DASHBOARD_PASS') },
  };
}
