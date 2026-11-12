import { join } from 'node:path';
import { loadConfig, type Config } from '../../apps/backend/src/core/config';
import type { RiotClientConfig } from '../../apps/backend/src/modules/riot-client/riot-client';

// The Riot settings of the scripts a developer runs against the live API by
// hand: the backend's config, with the key taken from RIOT_API_KEY or, when that
// is unset, from the gitignored .riot.key at the repo root.

export const RIOT_KEY_FILE_AT_ROOT = join(__dirname, '..', '..', '.riot.key');

export function scriptRiotConfig(env: Record<string, string | undefined>): { config: Config; riot: RiotClientConfig } {
  const config = loadConfig(env);
  const apiKey = config.riot.apiKey;
  return { config, riot: { ...config.riot, apiKey, keyFile: apiKey === undefined ? RIOT_KEY_FILE_AT_ROOT : undefined } };
}
