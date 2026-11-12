/**
 * `GET` and `POST /api/profiles/:region/:gameName/:tagLine/refresh`. A POST that
 * queues a sync answers 202; one refused answers 429 with the same body and a
 * Retry-After header.
 */
export interface RefreshResponse {
  /** True when this request queued a sync; always false on GET. */
  queued: boolean;
  /**
   * Why a POST did not queue: the profile was refreshed in the last two
   * minutes, or this client has refreshed too often in the last minute.
   */
  refused?: 'cooldown' | 'rate-limited';
  /** Seconds until the profile can be refreshed again; 0 when it can be now. */
  cooldownSeconds: number;
  /** Seconds until this client may refresh again, when `refused` is `rate-limited`. */
  retryAfterSeconds?: number;
  /** When the player's latest finished sync started; null before the first. */
  lastSyncedAt: string | null;
}
