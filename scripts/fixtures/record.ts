import { existsSync, mkdirSync } from 'node:fs';
import {
  deriveFixtures,
  fixtureFile,
  lobbyShape,
  matchPath,
  readFixture,
  seasonStart,
  sortSeasons,
  writeFixture,
  writeManifest,
  type Host,
  type ManifestFormat,
  type ManifestPlayer,
  type MatchLike,
  type SeasonLike,
} from '../../apps/fake-upstream/src';
import {
  RiotClient,
  type RiotClientConfig,
  type RiotExchange,
  type RiotResult,
} from '../../apps/backend/src/modules/riot-client/riot-client';
import type { Region } from '../../apps/backend/src/modules/riot-client/regions';

// Records the fixture set from the live API through the Riot client: a player's
// account, their current-season Arena listing once per queue id with the newest
// match bodies up to a cap, a sample of earlier 2026 matches, then the teammate
// they shared most recorded current-season games with, recorded the same way, so
// the set holds matches two tracked players share. Then derives the variants.
// Matches already on disk are not fetched again, so a run cut short by an
// expired key resumes.

export interface RecordOptions {
  riot: RiotClientConfig;
  outDir: string;
  /** Name#TAG. */
  riotId: string;
  region?: Region;
  seasons: readonly SeasonLike[];
  /** Every listing runs once per id: config.riot.arenaQueueIds. */
  queueIds: readonly number[];
  now?: Date;
  /** Gap between requests. The default keeps under a development key's 100 per two minutes. */
  intervalMs?: number;
  /** Matches sampled per earlier season and queue. */
  sampleSize?: number;
  /** Current-season match bodies recorded per player, newest first. The listing is always full. */
  maxCurrentMatches?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

const KEPT_HEADERS = new Set([
  'content-type',
  'retry-after',
  'x-rate-limit-type',
  'x-app-rate-limit',
  'x-app-rate-limit-count',
  'x-method-rate-limit',
  'x-method-rate-limit-count',
]);

const HOSTS: Record<RiotExchange['host'], Host> = { americas: 'riot-regional', br1: 'riot-platform' };
const MAX_RATE_LIMITED = 5;

export async function recordFixtures(options: RecordOptions) {
  const region = options.region ?? 'br';
  const now = options.now ?? new Date();
  const intervalMs = options.intervalMs ?? 1300;
  const sampleSize = options.sampleSize ?? 10;
  const maxCurrent = options.maxCurrentMatches ?? 60;
  const queueIds = options.queueIds;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const log = options.log ?? ((line: string) => console.log(line));
  const out = options.outDir;
  mkdirSync(out, { recursive: true });

  const [gameName, tagLine] = options.riotId.split('#');
  if (!gameName || !tagLine) throw new Error(`Riot ID must be Name#TAG, got ${options.riotId}`);

  const seasons = sortSeasons(options.seasons);
  const currentIndex = seasons.findLastIndex((season) => seasonStart(season) <= now.getTime());
  if (currentIndex < 0) throw new Error('no season has started yet');
  const current = seasons[currentIndex]!;

  let last: RiotExchange | undefined;
  const client = new RiotClient(options.riot, { onExchange: (exchange) => (last = exchange) });
  let nextAt = 0;
  let requests = 0;

  // One request, paced, sitting out 429s. Anything else that is not ok stops the run.
  async function call<T>(what: string, request: () => Promise<RiotResult<T>>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const wait = nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      nextAt = Date.now() + intervalMs;
      requests++;
      const result = await request();
      if (result.kind === 'ok') return result.data;
      if (result.kind === 'rate-limited' && attempt < MAX_RATE_LIMITED) {
        const seconds = result.retryAfterSeconds ?? 10;
        log(`429 on ${what}; waiting ${seconds}s`);
        await sleep(seconds * 1000);
        continue;
      }
      if (result.kind === 'key-rejected') {
        throw new Error(`Riot rejected the key (${result.status}) on ${what}: export a fresh RIOT_API_KEY or replace .riot.key`);
      }
      throw new Error(`${what}: ${result.kind} (${result.status})`);
    }
  }

  // Writes what the last request returned, as Riot returned it.
  function save(): void {
    const exchange = last!;
    const headers = Object.fromEntries(Object.entries(exchange.headers).filter(([name]) => KEPT_HEADERS.has(name)));
    writeFixture(out, HOSTS[exchange.host], exchange.path, {
      status: exchange.status,
      headers,
      body: JSON.parse(exchange.body),
    });
  }

  const matches = new Map<string, MatchLike>();
  async function recordMatch(id: string): Promise<MatchLike> {
    const known = matches.get(id);
    if (known) return known;
    const file = fixtureFile(out, 'riot-regional', matchPath(id));
    let match: MatchLike;
    if (existsSync(file)) {
      match = readFixture(file).body as MatchLike;
    } else {
      match = await call(`match ${id}`, () => client.matchById(region, id));
      save();
    }
    matches.set(id, match);
    return match;
  }

  async function listIds(puuid: string, queue: number, startTime: Date, endTime?: Date, limit = Infinity): Promise<string[]> {
    const ids: string[] = [];
    for (let start = 0; ids.length < limit; start += 100) {
      const count = Math.min(100, limit - ids.length);
      const page = await call(`match ids of ${puuid}`, () =>
        client.matchIdsByPuuid(region, puuid, { queue, startTime, endTime, start, count }),
      );
      ids.push(...page);
      if (page.length < count) break;
    }
    return ids;
  }

  const byIdNewestFirst = (a: string, b: string): number => b.localeCompare(a, 'en', { numeric: true });

  // The player's full current-season listing, once per queue id, and the newest
  // `maxCurrent` of it recorded. Match ids grow with time on a platform, so the
  // highest ids across queues are the newest matches.
  const currentIds = new Set<string>();
  async function recordCurrentSeason(puuid: string): Promise<ManifestPlayer['currentSeasonListed']> {
    const byQueue: Record<string, number> = {};
    const listed: string[] = [];
    for (const queue of queueIds) {
      const ids = await listIds(puuid, queue, new Date(seasonStart(current)));
      byQueue[String(queue)] = ids.length;
      listed.push(...ids);
    }
    for (const id of listed.sort(byIdNewestFirst).slice(0, maxCurrent)) {
      currentIds.add(id);
      await recordMatch(id);
    }
    return { total: listed.length, byQueue };
  }

  // Recorded current-season matches the player is in, newest first: what the
  // fake lists for them.
  function recordedCurrent(puuid: string): string[] {
    return [...currentIds]
      .map((id) => matches.get(id)!)
      .filter((match) => match.metadata.participants.includes(puuid))
      .sort((a, b) => b.info.gameCreation - a.info.gameCreation || byIdNewestFirst(a.metadata.matchId, b.metadata.matchId))
      .map((match) => match.metadata.matchId);
  }

  log(`recording ${options.riotId}; current season ${current.name}`);
  const account = await call(`account ${options.riotId}`, () => client.accountByRiotId(region, gameName, tagLine));
  save();
  await call(`account ${account.puuid}`, () => client.accountByPuuid(region, account.puuid));
  save();

  const primaryListed = await recordCurrentSeason(account.puuid);
  const primaryCurrent = recordedCurrent(account.puuid);
  log(`${primaryListed.total} current-season matches listed (${JSON.stringify(primaryListed.byQueue)}), ${primaryCurrent.length} recorded`);
  if (primaryListed.total === 0) {
    throw new Error(
      `no current-season match for ${options.riotId} under queue ids ${queueIds.join(', ')}: ` +
        `run \`pnpm riot:queues ${options.riotId}\` to find the queue ids behind the newest matches, then set ARENA_QUEUE_IDS`,
    );
  }

  const earlier: string[] = [];
  for (let index = currentIndex - 1; index >= 0; index--) {
    const season = seasons[index]!;
    const end = new Date(seasonStart(seasons[index + 1]!) - 1000);
    for (const queue of queueIds) {
      earlier.push(...(await listIds(account.puuid, queue, new Date(seasonStart(season)), end, sampleSize)));
    }
  }
  log(`${earlier.length} earlier matches sampled`);
  for (const id of earlier) await recordMatch(id);

  // The teammate: who shared the primary player's subteam most often this season.
  const together = new Map<string, number>();
  for (const id of primaryCurrent) {
    const participants = matches.get(id)!.info.participants;
    const team = participants.find((p) => p.puuid === account.puuid)?.playerSubteamId;
    for (const p of participants) {
      if (p.puuid !== account.puuid && p.playerSubteamId === team) together.set(p.puuid, (together.get(p.puuid) ?? 0) + 1);
    }
  }
  const [mate] = [...together].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!mate) throw new Error('no teammate found in the current season');
  log(`teammate ${mate[0]}, ${mate[1]} games together`);

  const mateAccount = await call(`account ${mate[0]}`, () => client.accountByPuuid(region, mate[0]));
  save();
  await call(`account ${mateAccount.gameName}#${mateAccount.tagLine}`, () =>
    client.accountByRiotId(region, mateAccount.gameName, mateAccount.tagLine),
  );
  save();
  const mateListed = await recordCurrentSeason(mateAccount.puuid);
  const mateCurrent = recordedCurrent(mateAccount.puuid);
  const primaryAll = recordedCurrent(account.puuid);
  log(`${mateListed.total} current-season matches listed for the teammate, ${mateCurrent.length} recorded`);

  const formats = new Map<string, ManifestFormat>();
  for (const match of matches.values()) {
    const format = lobbyShape(match);
    const entry = formats.get(format) ?? { format, queueIds: [], matches: 0 };
    if (!entry.queueIds.includes(match.info.queueId)) entry.queueIds.push(match.info.queueId);
    entry.matches++;
    formats.set(format, entry);
  }

  const players: ManifestPlayer[] = [
    {
      role: 'primary',
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      currentSeasonListed: primaryListed,
      currentSeasonMatchIds: primaryAll,
      earlierMatchIds: earlier,
    },
    {
      role: 'teammate',
      puuid: mateAccount.puuid,
      gameName: mateAccount.gameName,
      tagLine: mateAccount.tagLine,
      currentSeasonListed: mateListed,
      currentSeasonMatchIds: mateCurrent,
      earlierMatchIds: [],
    },
  ];
  const byNumber = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });
  writeManifest(out, {
    recordedAt: now.toISOString(),
    region,
    riotId: options.riotId,
    currentSeason: { name: current.name, startsAt: current.startsAt },
    players,
    sharedCurrentSeasonMatchIds: primaryAll.filter((id) => mateCurrent.includes(id)).sort(byNumber),
    formats: [...formats.values()]
      .map((format) => ({ ...format, queueIds: format.queueIds.sort((a, b) => a - b) }))
      .sort((a, b) => a.format.localeCompare(b.format, 'en', { numeric: true })),
    derived: [],
  });

  const derived = deriveFixtures(out, { seasons });
  log(`recorded ${matches.size} matches in ${requests} requests; ${derived.length} derived fixtures`);
}
