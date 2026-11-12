// The replay job's name on the maintenance queue, and its schedule: every two
// hours, on the hour (UTC). Kept free of Nest so `pnpm replay` can import it.
export const REPLAY_JOB = 'rating-replay';

export const REPLAY_PATTERN = '0 */2 * * *';

/** What a replay run reports when it completes. */
export interface ReplaySummary {
  runId: number;
  matches: number;
  ratings: number;
  historyPoints: number;
}
