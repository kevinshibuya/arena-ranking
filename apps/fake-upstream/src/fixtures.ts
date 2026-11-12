import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

// The fixture layout, shared by the fake (which serves it), the recorder and the
// derive step (which write it) and fixtures:check (which verifies it).
//
//   fixtures-anon/                  the committed set, anonymised (scripts/anonymise-fixtures.ts)
//     manifest.json                 what was recorded, formats seen, derived files
//     riot-regional/<path>.json     americas.api.riotgames.com
//     riot-platform/<path>.json     br1.api.riotgames.com
//     ddragon/<path>.json           ddragon.leagueoflegends.com
//     cdragon/<path>.json           raw.communitydragon.org
//     canned/<name>.json            responses a test hands to the fake's admin endpoint
//
// A fixture file holds one response. `<path>` is the request path with each
// segment percent-encoded, so `/lol/match/v5/matches/BR1_1` is
// `riot-regional/lol/match/v5/matches/BR1_1.json`.

export const DEFAULT_FIXTURES_DIR = join(__dirname, '..', 'fixtures-anon');

/** Where `pnpm record-fixtures` writes a live recording. Git ignores it: it holds real players. */
export const RECORDED_FIXTURES_DIR = join(__dirname, '..', 'fixtures-recorded');

export const HOSTS = ['riot-regional', 'riot-platform', 'ddragon', 'cdragon'] as const;
export type Host = (typeof HOSTS)[number];

export interface Derivation {
  /** Match id of the recorded match this was derived from; absent when hand-authored. */
  from?: string;
  note: string;
}

export interface Fixture {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  /** Present on every fixture not recorded from the live API as is. */
  derived?: Derivation;
}

/** The fields of a match-v5 match the fake and the fixture scripts read. */
export interface MatchLike {
  metadata: { matchId: string; participants: string[] };
  info: {
    gameCreation: number;
    gameVersion: string;
    queueId: number;
    participants: Array<{ puuid: string; playerSubteamId: number }>;
  };
}

const MATCH_PATH = /^\/lol\/match\/v5\/matches\/([^/]+)$/;
const RIOT_ID_PATH = /^\/riot\/account\/v1\/accounts\/by-riot-id\//;

export function matchPath(matchId: string): string {
  return `/lol/match/v5/matches/${matchId}`;
}

export function matchIdOfPath(path: string): string | undefined {
  return MATCH_PATH.exec(path)?.[1];
}

/**
 * The key a request path is served under: segments decoded then re-encoded the
 * one canonical way, and a Riot ID lowercased, since Riot matches those
 * case-insensitively.
 */
export function routeKey(path: string): string {
  const segments = path.split('/').map((segment) => encodeURIComponent(safeDecode(segment)));
  const key = segments.join('/');
  return RIOT_ID_PATH.test(key) ? key.toLowerCase() : key;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function fixtureFile(dir: string, host: Host, path: string): string {
  const segments = path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(safeDecode(segment)));
  return join(dir, host, ...segments) + '.json';
}

export function writeFixture(dir: string, host: Host, path: string, fixture: Fixture): string {
  const file = fixtureFile(dir, host, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n');
  return file;
}

export function readFixture(file: string): Fixture {
  return JSON.parse(readFileSync(file, 'utf8')) as Fixture;
}

export function hasFixture(dir: string, host: Host, path: string): boolean {
  return existsSync(fixtureFile(dir, host, path));
}

export interface LoadedFixture extends Fixture {
  host: Host;
  /** Request path, percent-encoded. */
  path: string;
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.json')) yield full;
  }
}

/** Every fixture served by path, across all hosts. Two hosts answering one path is an error. */
export function loadFixtures(dir: string): LoadedFixture[] {
  const seen = new Map<string, Host>();
  const fixtures: LoadedFixture[] = [];
  for (const host of HOSTS) {
    for (const file of walk(join(dir, host))) {
      const path = '/' + relative(join(dir, host), file).slice(0, -'.json'.length).split(sep).join('/');
      const key = routeKey(path);
      const other = seen.get(key);
      if (other) throw new Error(`fixture path ${path} is recorded under both ${other} and ${host}`);
      seen.set(key, host);
      fixtures.push({ ...readFixture(file), host, path });
    }
  }
  return fixtures;
}

export const CANNED = ['rate-limited', 'key-rejected'] as const;
export type CannedName = (typeof CANNED)[number];

/** A hand-authored response a test hands to the fake's admin endpoint. */
export function loadCanned(name: CannedName, dir = DEFAULT_FIXTURES_DIR): Fixture {
  return readFixture(join(dir, 'canned', `${name}.json`));
}
