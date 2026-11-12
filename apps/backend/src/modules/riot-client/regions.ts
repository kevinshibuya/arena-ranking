// Where each region's traffic goes. account-v1 and match-v5 live on the
// regional host, per-server endpoints on the platform host. Another region is
// another row; its hosts need no configuration unless tests point them elsewhere.

export const REGIONS = {
  br: { platform: 'br1', regional: 'americas' },
} as const;

export type Region = keyof typeof REGIONS;
export type RiotHost = (typeof REGIONS)[Region]['platform' | 'regional'];
