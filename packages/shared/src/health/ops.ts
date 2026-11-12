// Health section contributed by the ops module: the Riot key, its rate budget
// and the two queues.

/** `rejected` from a 401 or 403 until a probe with the key file's contents succeeds. */
export type RiotKeyState = 'ok' | 'rejected';

export interface RateBudgetWindow {
  seconds: number;
  limit: number;
  /** The limit minus the count Riot reported, never below 0. */
  remaining: number;
}

export interface AppRateBudget {
  /** ISO timestamp of the Riot response the windows were read from. */
  observedAt: string;
  windows: RateBudgetWindow[];
}

export interface QueueHealth {
  /** Jobs not finished yet: waiting, prioritised, delayed, active or waiting on children. */
  depth: number;
  paused: boolean;
}

export interface OpsHealth {
  riotKey: RiotKeyState;
  /** The app rate-limit windows of the newest Riot response that carried them; null before any. */
  appBudget: AppRateBudget | null;
  queues: { riot: QueueHealth; maintenance: QueueHealth };
}

export interface OpsHealthSection {
  ops: OpsHealth;
}
