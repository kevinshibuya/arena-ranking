// Health section contributed by the static data module.

export interface StaticDataHealth {
  /** ISO timestamp of the newest completed refresh; null before the first. */
  lastRefreshAt: string | null;
  /** The Data Dragon version that refresh cached, e.g. `16.20.1`. */
  patch: string | null;
}

export interface StaticDataHealthSection {
  staticData: StaticDataHealth;
}
