import { relative } from 'node:path';
import {
  fixtureFile,
  matchPath,
  readFixture,
  writeFixture,
  type Fixture,
  type Host,
  type MatchLike,
} from './fixtures';
import { readManifest, writeManifest, type ManifestDerived } from './manifest';
import { lobbyShape, parsePatch, seasonOfVersion, seasonStart, sortSeasons, type SeasonLike } from './shape';

// The fixtures Riot will not hand over on demand, produced from one recorded
// match or written by hand, each marked `derived`. Re-running replaces them.

export const DERIVED_MATCHES = {
  eightByTwo: 'BR1_9000000001',
  irregular: 'BR1_9000000002',
  lastPatchOfSeason: 'BR1_9000000003',
  earlierSeason: 'BR1_9000000004',
} as const;

/** An account with no Arena match: its listings are empty. */
export const ZERO_ARENA_ACCOUNT = {
  puuid: 'derived-zero-arena-0000000000000000000000000000000000000000000000000000000000000',
  gameName: 'Sem Arena',
  tagLine: 'BR1',
};

/** A Riot ID that resolves to nothing. */
export const UNKNOWN_RIOT_ID = { gameName: 'Ninguem', tagLine: '0000' };

/** lol-status-v4 on the platform host: the key probe's request. */
export const PLATFORM_STATUS_PATH = '/lol/status/v4/platform-data';

export interface RequiredFixture {
  host: Host | 'canned';
  path: string;
  status: number;
}

const riotIdPath = (gameName: string, tagLine: string): string =>
  `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
const puuidPath = (puuid: string): string => `/riot/account/v1/accounts/by-puuid/${puuid}`;

/** Every derived and hand-authored fixture fixtures:check expects. */
export const REQUIRED_DERIVED: readonly RequiredFixture[] = [
  ...Object.values(DERIVED_MATCHES).map((id) => ({ host: 'riot-regional' as const, path: matchPath(id), status: 200 })),
  { host: 'riot-regional', path: riotIdPath(ZERO_ARENA_ACCOUNT.gameName, ZERO_ARENA_ACCOUNT.tagLine), status: 200 },
  { host: 'riot-regional', path: puuidPath(ZERO_ARENA_ACCOUNT.puuid), status: 200 },
  { host: 'riot-regional', path: riotIdPath(UNKNOWN_RIOT_ID.gameName, UNKNOWN_RIOT_ID.tagLine), status: 404 },
  { host: 'riot-platform', path: PLATFORM_STATUS_PATH, status: 200 },
  { host: 'canned', path: '/rate-limited', status: 429 },
  { host: 'canned', path: '/key-rejected', status: 403 },
];

export function requiredFile(dir: string, fixture: RequiredFixture): string {
  return fixtureFile(dir, fixture.host as Host, fixture.path);
}

// What a development key's responses carry, for the hand-authored ones.
const JSON_HEADERS = { 'content-type': 'application/json;charset=utf-8' };
const RATE_HEADERS = {
  ...JSON_HEADERS,
  'x-app-rate-limit': '20:1,100:120',
  'x-app-rate-limit-count': '1:1,1:120',
  'x-method-rate-limit': '1000:60',
  'x-method-rate-limit-count': '1:60',
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Participant = MatchLike['info']['participants'][number] & {
  placement?: number;
  subteamPlacement?: number;
  win?: boolean;
};
type EditableMatch = {
  metadata: MatchLike['metadata'];
  info: Omit<MatchLike['info'], 'participants'> & {
    gameId?: number;
    gameStartTimestamp?: number;
    gameEndTimestamp?: number;
    participants: Participant[];
  };
};

function withId(match: EditableMatch, id: string): EditableMatch {
  const copy = structuredClone(match);
  copy.metadata.matchId = id;
  copy.info.gameId = Number(id.replace(/^[^_]*_/, ''));
  return copy;
}

function withParticipants(match: EditableMatch, participants: Participant[]): EditableMatch {
  match.info.participants = participants;
  match.metadata.participants = participants.map((p) => p.puuid);
  return match;
}

/** Same players, regrouped into `teams` teams of `size`, the primary player's team placing first. */
function reshape(source: EditableMatch, id: string, primary: string, teams: number, size: number): EditableMatch {
  const match = withId(source, id);
  const own = match.info.participants.find((p) => p.puuid === primary)!.playerSubteamId;
  const ordered = [...match.info.participants].sort(
    (a, b) => Number(b.playerSubteamId === own) - Number(a.playerSubteamId === own) || a.playerSubteamId - b.playerSubteamId,
  );
  const kept = ordered.slice(0, teams * size).map((p, index) => {
    const team = Math.floor(index / size) + 1;
    return { ...p, playerSubteamId: team, placement: team, subteamPlacement: team, win: team <= teams / 2 };
  });
  return withParticipants(match, kept);
}

/** One player of the last team moved into the primary player's team: two teams of uneven size. */
function irregular(source: EditableMatch, id: string, primary: string): EditableMatch {
  const match = withId(source, id);
  const own = match.info.participants.find((p) => p.puuid === primary)!;
  const last = Math.max(...match.info.participants.map((p) => p.playerSubteamId));
  const moved = match.info.participants.find((p) => p.playerSubteamId === last && p.playerSubteamId !== own.playerSubteamId)!;
  Object.assign(moved, {
    playerSubteamId: own.playerSubteamId,
    placement: own.placement,
    subteamPlacement: own.subteamPlacement,
    win: own.win,
  });
  return match;
}

/** The same game moved to `created`, on patch `major.minor`. */
function retimed(source: EditableMatch, id: string, created: number, major: number, minor: number): EditableMatch {
  const match = withId(source, id);
  const shift = created - match.info.gameCreation;
  match.info.gameCreation += shift;
  if (match.info.gameStartTimestamp !== undefined) match.info.gameStartTimestamp += shift;
  if (match.info.gameEndTimestamp !== undefined) match.info.gameEndTimestamp += shift;
  const build = match.info.gameVersion.split('.').slice(2);
  match.info.gameVersion = [major, minor, ...build].join('.');
  return match;
}

/** Writes the hand-authored fixtures, which need no recorded match. */
export function writeHandAuthored(dir: string): ManifestDerived[] {
  const handAuthored: Array<{ host: Host | 'canned'; path: string; fixture: Fixture }> = [
    {
      host: 'riot-regional',
      path: riotIdPath(ZERO_ARENA_ACCOUNT.gameName, ZERO_ARENA_ACCOUNT.tagLine),
      fixture: { status: 200, headers: RATE_HEADERS, body: ZERO_ARENA_ACCOUNT, derived: { note: 'hand-authored: an account with no Arena match' } },
    },
    {
      host: 'riot-regional',
      path: puuidPath(ZERO_ARENA_ACCOUNT.puuid),
      fixture: { status: 200, headers: RATE_HEADERS, body: ZERO_ARENA_ACCOUNT, derived: { note: 'hand-authored: an account with no Arena match' } },
    },
    {
      host: 'riot-regional',
      path: riotIdPath(UNKNOWN_RIOT_ID.gameName, UNKNOWN_RIOT_ID.tagLine),
      fixture: {
        status: 404,
        headers: RATE_HEADERS,
        body: {
          status: {
            message: `Data not found - No results found for player with riot id ${UNKNOWN_RIOT_ID.gameName}#${UNKNOWN_RIOT_ID.tagLine}`,
            status_code: 404,
          },
        },
        derived: { note: 'hand-authored: a Riot ID that does not resolve' },
      },
    },
    {
      host: 'riot-platform',
      path: PLATFORM_STATUS_PATH,
      fixture: {
        status: 200,
        headers: RATE_HEADERS,
        body: { id: 'BR1', name: 'Brazil', locales: ['pt_BR'], maintenances: [], incidents: [] },
        derived: { note: 'hand-authored: the platform status the key probe asks for' },
      },
    },
    {
      host: 'canned',
      path: '/rate-limited',
      fixture: {
        status: 429,
        headers: {
          ...JSON_HEADERS,
          'retry-after': '7',
          'x-rate-limit-type': 'application',
          'x-app-rate-limit': '20:1,100:120',
          'x-app-rate-limit-count': '3:1,101:120',
          'x-method-rate-limit': '2000:10',
          'x-method-rate-limit-count': '3:10',
        },
        body: { status: { message: 'Rate limit exceeded', status_code: 429 } },
        derived: { note: 'hand-authored: an application rate limit hit, Retry-After 7 seconds' },
      },
    },
    {
      host: 'canned',
      path: '/key-rejected',
      fixture: {
        status: 403,
        headers: JSON_HEADERS,
        body: { status: { message: 'Forbidden', status_code: 403 } },
        derived: { note: 'hand-authored: the answer to an expired or revoked key' },
      },
    },
  ];
  const written: ManifestDerived[] = [];
  for (const { host, path, fixture } of handAuthored) {
    const file = writeFixture(dir, host as Host, path, fixture);
    written.push({ file: relative(dir, file), note: fixture.derived!.note });
  }

  return written;
}

export interface DeriveOptions {
  seasons: readonly SeasonLike[];
}

/**
 * Writes every derived and hand-authored fixture into `dir` from a recorded
 * current-season match of the primary player, and lists them in the manifest.
 */
export function deriveFixtures(dir: string, options: DeriveOptions): ManifestDerived[] {
  const manifest = readManifest(dir);
  const primary = manifest.players.find((player) => player.role === 'primary');
  if (!primary) throw new Error('manifest has no primary player');

  const seasons = sortSeasons(options.seasons);
  const current = seasons.findLast((season) => seasonStart(season) <= Date.parse(manifest.recordedAt));
  const previousIndex = current ? seasons.indexOf(current) - 1 : -1;
  if (!current || previousIndex < 0) throw new Error('need a current season with an earlier one before it');

  // The newest regular lobby among the largest, at least 16 players, so an 8x2
  // can be cut from it.
  let sourceFixture: Fixture | undefined;
  let source: EditableMatch | undefined;
  for (const id of primary.currentSeasonMatchIds) {
    const fixture = readFixture(fixtureFile(dir, 'riot-regional', matchPath(id)));
    const match = fixture.body as EditableMatch;
    const size = match.info.participants.length;
    if (lobbyShape(match) !== 'irregular' && size >= 16 && size > (source?.info.participants.length ?? 0)) {
      sourceFixture = fixture;
      source = match;
    }
  }
  if (!source || !sourceFixture) throw new Error('no recorded current-season lobby of 16 or more players to derive from');
  const from = source.metadata.matchId;

  const firstPatch = parsePatch(current.firstPatch);
  const earliest = seasons[0]!;
  const earliestPatch = parsePatch(earliest.firstPatch);
  const variants: Array<{ match: EditableMatch; note: string }> = [
    { match: reshape(source, DERIVED_MATCHES.eightByTwo, primary.puuid, 8, 2), note: '8x2 variant: subteams regrouped into eight pairs' },
    { match: irregular(source, DERIVED_MATCHES.irregular, primary.puuid), note: 'irregular teams: one player moved from the last team into the primary player\'s team' },
    {
      match: retimed(source, DERIVED_MATCHES.lastPatchOfSeason, seasonStart(current) + 2 * HOUR, firstPatch.major, firstPatch.minor - 1),
      note: `last patch of the season before ${current.name}, played two hours after ${current.name}'s start timestamp`,
    },
    {
      match: retimed(source, DERIVED_MATCHES.earlierSeason, seasonStart(earliest) + 14 * DAY, earliestPatch.major, earliestPatch.minor + 1),
      note: `earlier season: two weeks into ${earliest.name}`,
    },
  ];

  const derived: ManifestDerived[] = [];
  for (const { match, note } of variants) {
    const file = writeFixture(dir, 'riot-regional', matchPath(match.metadata.matchId), {
      status: 200,
      headers: sourceFixture.headers,
      body: match,
      derived: { from, note },
    });
    derived.push({
      file: relative(dir, file),
      note,
      from,
      matchId: match.metadata.matchId,
      format: lobbyShape(match),
      season: seasonOfVersion(match.info.gameVersion, seasons)?.name ?? null,
    });
  }

  derived.push(...writeHandAuthored(dir));
  writeManifest(dir, { ...manifest, derived });
  return derived;
}
