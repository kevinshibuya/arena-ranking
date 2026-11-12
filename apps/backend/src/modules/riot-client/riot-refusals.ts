// What a Riot-bound job throws when Riot refuses the request itself rather than
// answering it. The `riot` worker reacts to these instead of failing the job:
// the job goes back to wait with its attempts untouched.

/** Used when a 429 carries no Retry-After, which Riot's edge does on some. */
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** A 429: nothing leaves the `riot` queue for `retryAfterMs`. */
export class RiotRateLimitedError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterSeconds: number | undefined, limitType: string | undefined) {
    const seconds = retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
    super(`Riot rate limit (${limitType ?? 'unknown'}): retry after ${seconds}s`);
    this.name = 'RiotRateLimitedError';
    this.retryAfterMs = seconds * 1000;
  }
}

/** A 401 or 403: the key is rejected, and the `riot` queue pauses until a probe succeeds. */
export class RiotKeyRejectedError extends Error {
  constructor(status: number) {
    super(`Riot rejected the API key (${status})`);
    this.name = 'RiotKeyRejectedError';
  }
}
