// `pnpm riot:queues <Name#TAG>`: which queue ids a player's newest matches are
// under, to find an Arena queue id Riot has not published. Lists the newest 100
// match ids with no queue filter, fetches the newest 20 and prints one row each:
// id, date, queue id, game mode, lobby shape, game version. Then names the queue
// ids seen that ARENA_QUEUE_IDS does not hold. Uses the live key as
// record-fixtures does: RIOT_API_KEY, else .riot.key at the repo root.

import { lobbyShape } from '../apps/fake-upstream/src';
import { RiotClient, type RiotExchange, type RiotResult } from '../apps/backend/src/modules/riot-client/riot-client';
import type { MatchDto } from '../apps/backend/src/modules/riot-client/riot.types';
import { scriptRiotConfig } from './riot/script-config';

const LISTED = 100;
const FETCHED = 20;
// Twenty-odd requests: well inside a development key's 20 per second and 100 per two minutes.
const INTERVAL_MS = 100;
const MAX_RATE_LIMITED = 3;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function main(): Promise<void> {
  const riotId = process.argv.slice(2).find((arg) => arg !== '--') ?? '';
  const [gameName, tagLine] = riotId.split('#');
  if (!gameName || !tagLine) throw new Error('usage: pnpm riot:queues <Name#TAG>');

  const { config, riot } = scriptRiotConfig(process.env);
  let last: RiotExchange | undefined;
  const client = new RiotClient(riot, { onExchange: (exchange) => (last = exchange) });

  async function call<T>(request: () => Promise<RiotResult<T>>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await sleep(INTERVAL_MS);
      const result = await request();
      if (result.kind === 'ok') return result.data;
      const path = last ? `${last.path}${last.query ? `?${last.query}` : ''}` : 'the first request';
      if (result.kind === 'rate-limited' && attempt < MAX_RATE_LIMITED) {
        const seconds = result.retryAfterSeconds ?? 10;
        console.error(`429 on ${path}; waiting ${seconds}s`);
        await sleep(seconds * 1000);
        continue;
      }
      if (result.kind === 'key-rejected') {
        throw new Error(`Riot rejected the key (${result.status}) on ${path}: export a fresh RIOT_API_KEY or replace .riot.key`);
      }
      throw new Error(`${result.kind} (${result.status}) on ${path}`);
    }
  }

  const account = await call(() => client.accountByRiotId('br', gameName, tagLine));
  const ids = await call(() => client.matchIdsByPuuid('br', account.puuid, { start: 0, count: LISTED }));
  console.log(`${account.gameName}#${account.tagLine}: ${ids.length} newest match ids listed, fetching ${Math.min(FETCHED, ids.length)}`);

  const matches: MatchDto[] = [];
  for (const id of ids.slice(0, FETCHED)) matches.push(await call(() => client.matchById('br', id)));

  const rows = matches.map((match) => [
    match.metadata.matchId,
    new Date(match.info.gameCreation).toISOString().slice(0, 16).replace('T', ' ') + 'Z',
    String(match.info.queueId),
    match.info.gameMode,
    lobbyShape(match),
    match.info.gameVersion,
  ]);
  const header = ['match', 'created (UTC)', 'queue', 'mode', 'shape', 'game version'];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  for (const row of [header, ...rows]) console.log(row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd());

  const configured = config.riot.arenaQueueIds;
  const unknown = [...new Set(matches.map((match) => match.info.queueId))].filter((queue) => !configured.includes(queue));
  if (unknown.length > 0) {
    console.log(`queue ids not in ARENA_QUEUE_IDS (${configured.join(', ')}): ${unknown.sort((a, b) => a - b).join(', ')}`);
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`riot:queues: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
