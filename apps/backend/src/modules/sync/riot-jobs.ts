import type { JobsOptions } from 'bullmq';
import type { RiotResult } from '../riot-client/riot-client';
import { RiotKeyRejectedError, RiotRateLimitedError } from '../riot-client/riot-refusals';
import type { AccountDto } from '../riot-client/riot.types';
import type { Region } from '../riot-client/regions';

// The jobs on the `riot` queue. Each one performs exactly one Riot request, so
// the queue's limiter limits requests.

export const RIOT_JOBS = {
  accountByRiotId: 'account-by-riot-id',
  matchIdsPage: 'match-ids-page',
  match: 'match',
} as const;

/** 1 is a human waiting on a page, 2 the sweep, 3 backfill. */
export type RiotPriority = 1 | 2 | 3;

export interface AccountByRiotIdJob {
  region: Region;
  gameName: string;
  tagLine: string;
}

export type AccountByRiotIdResult = { found: true; account: AccountDto } | { found: false };

/** One page of a sync's match-id listing under one queue id. */
export interface MatchIdsPageJob {
  syncId: string;
  region: Region;
  puuid: string;
  queueId: number;
  /** Epoch milliseconds. */
  startTime: number;
  /** Epoch milliseconds; absent for "up to now". */
  endTime?: number;
  /** Offset into the listing, newest first. */
  start: number;
  priority: RiotPriority;
}

export interface MatchJob {
  syncId: string;
  region: Region;
  matchId: string;
  priority: RiotPriority;
}

/** Riot answers at most this many ids per listing request. */
export const MATCH_IDS_PAGE_SIZE = 100;

/**
 * Every Riot job gets five attempts, 1, 2, 4 and 8 seconds apart: a 5xx, a timeout
 * or a network blip recovers inside a run. A refusal (429, a rejected or missing
 * key) never spends an attempt; the job waits with the queue. Without a priority
 * the job joins the plain wait list, which BullMQ runs before every prioritised
 * job: that is for the one request a human is blocked on. The `riot` worker also
 * keeps a tenth of each rate window for it, so it runs while syncs saturate the key.
 */
export function riotJobOptions(priority?: RiotPriority): JobsOptions {
  return {
    ...(priority === undefined ? {} : { priority }),
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    // Kept a while for the dashboard and for counting in tests, then trimmed.
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
}

/** Thrown by a handler when Riot answered with anything it cannot use; fails the attempt. */
export class RiotRequestFailed extends Error {
  constructor(what: string, kind: string, status: number) {
    super(`Riot ${what}: ${kind} (${status})`);
    this.name = 'RiotRequestFailed';
  }
}

/**
 * What a handler throws for an answer it cannot use: a refusal the `riot` worker
 * waits out for a 429, 401 or 403, otherwise a failure of the job.
 */
export function riotFailure(what: string, result: Exclude<RiotResult<unknown>, { kind: 'ok' }>): Error {
  if (result.kind === 'rate-limited') return new RiotRateLimitedError(result.retryAfterSeconds, result.limitType);
  if (result.kind === 'key-rejected') return new RiotKeyRejectedError(result.status);
  return new RiotRequestFailed(what, result.kind, result.status);
}
