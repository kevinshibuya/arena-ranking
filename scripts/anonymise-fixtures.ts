// `pnpm fixtures:anonymise [-- <in-dir> <out-dir>]`: turns a Riot fixture set
// recorded from the live API into the committed one, with no real player in it.
// `pnpm record-fixtures` records into apps/fake-upstream/fixtures-recorded (git
// ignores it) and runs this afterwards; only the output is committed.
//
// Every player identifier becomes a synthetic value, the same one in every file,
// so a PUUID in a listing, a match and a manifest still joins:
//
//   PUUID               anon-player-0001-000…   (78 characters, as Riot's)
//   summoner id         anon-summoner-0001
//   Riot ID             Player0001#ANON, one per PUUID, whatever names it went by
//   summoner name       empty, as Riot sends it now
//   profile icon, level 29 and 30 for everyone
//   match id            BR1_1000000001 upwards, in the order of the real ids, so
//                       the newest match keeps the highest id; info.gameId and
//                       info.gameName follow
//
// The primary player is Player0001 and the recorded teammate Player0002; the
// rest are numbered in order of first appearance. Hand-authored fixtures (their
// `derived` note has no `from`) and match ids the derive step made up are kept.
// Timestamps, game versions, queue ids, champions, items, augments, placements
// and the stats the app reads are kept as recorded.
//
// The participant blocks the app never reads are dropped: `challenges`, `perks`,
// `missions`, `PlayerBehavior` and `selectedRolePreferences`. They were 12 of
// the recorded set's 29 MB.
//
// Only the Riot hosts (riot-regional, riot-platform), canned/ and manifest.json
// are rewritten. The Data Dragon and Community Dragon fixtures in the output are
// left alone. The run fails, writing nothing, if any real identifier would
// survive. No mapping from real to synthetic values is written anywhere.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const DEFAULT_IN = join('apps', 'fake-upstream', 'fixtures-recorded');
const DEFAULT_OUT = join('apps', 'fake-upstream', 'fixtures-anon');
const REWRITTEN = ['riot-regional', 'riot-platform', 'canned'];
const DROPPED_PARTICIPANT_KEYS = new Set(['challenges', 'perks', 'missions', 'PlayerBehavior', 'selectedRolePreferences']);
const SYNTHETIC_TAG = 'ANON';
const FIRST_MATCH_NUMBER = 1_000_000_001;
const MATCH_FILE = /^riot-regional\/lol\/match\/v5\/matches\/([^/]+)\.json$/;
const BY_PUUID = /^(riot-regional\/riot\/account\/v1\/accounts\/by-puuid\/)([^/]+)(\.json)$/;
const BY_RIOT_ID = /^riot-regional\/riot\/account\/v1\/accounts\/by-riot-id\/([^/]+)\/([^/]+)\.json$/;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface FixtureFile {
  /** Relative to the fixture directory, `/`-separated. */
  path: string;
  data: JsonObject;
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.json')) yield full;
  }
}

function readSet(dir: string): { files: FixtureFile[]; manifest: JsonObject | undefined } {
  const files: FixtureFile[] = [];
  for (const host of REWRITTEN) {
    for (const file of walk(join(dir, host))) {
      files.push({ path: relative(dir, file).split(sep).join('/'), data: JSON.parse(readFileSync(file, 'utf8')) as JsonObject });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifestFile = join(dir, 'manifest.json');
  const manifest = existsSync(manifestFile) ? (JSON.parse(readFileSync(manifestFile, 'utf8')) as JsonObject) : undefined;
  return { files, manifest };
}

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isHandAuthored = (file: FixtureFile): boolean => isObject(file.data.derived) && file.data.derived.from === undefined;
const isDerived = (file: FixtureFile): boolean => isObject(file.data.derived);
const pad = (n: number): string => String(n).padStart(4, '0');
const matchNumber = (id: string): number => Number(id.slice(id.indexOf('_') + 1));

interface Mapping {
  puuid: Map<string, number>;
  summonerId: Map<string, string>;
  matchId: Map<string, string>;
  /** Real game names and tag lines, for the survivor check only. */
  names: Set<string>;
  /** Champion names: a player called Ahri leaves Ahri behind as a champion. */
  champions: Set<string>;
}

function syntheticPuuid(n: number): string {
  const head = `anon-player-${pad(n)}-`;
  return head + '0'.repeat(78 - head.length);
}

function buildMapping(files: FixtureFile[], manifest: JsonObject | undefined): Mapping {
  const mapping: Mapping = { puuid: new Map(), summonerId: new Map(), matchId: new Map(), names: new Set(), champions: new Set() };
  const addPuuid = (puuid: Json | undefined): void => {
    if (typeof puuid === 'string' && puuid !== '' && !mapping.puuid.has(puuid)) mapping.puuid.set(puuid, mapping.puuid.size + 1);
  };

  // The primary player first, then the teammate, so the two keep stable names.
  const players = manifest && Array.isArray(manifest.players) ? manifest.players.filter(isObject) : [];
  for (const role of ['primary', 'teammate']) for (const player of players) if (player.role === role) addPuuid(player.puuid);
  for (const player of players) addPuuid(player.puuid);

  const recordedMatches = files.filter((file) => MATCH_FILE.test(file.path) && !isDerived(file));
  const realIds = recordedMatches.map((file) => MATCH_FILE.exec(file.path)![1]!);
  [...realIds].sort((a, b) => matchNumber(a) - matchNumber(b)).forEach((id, index) => {
    mapping.matchId.set(id, `${id.slice(0, id.indexOf('_'))}_${FIRST_MATCH_NUMBER + index}`);
  });

  const inMatchOrder = [...recordedMatches].sort(
    (a, b) => matchNumber(MATCH_FILE.exec(a.path)![1]!) - matchNumber(MATCH_FILE.exec(b.path)![1]!),
  );
  for (const file of inMatchOrder) {
    const body = file.data.body;
    if (!isObject(body) || !isObject(body.info) || !Array.isArray(body.info.participants)) continue;
    for (const participant of body.info.participants.filter(isObject)) {
      addPuuid(participant.puuid);
      const summonerId = participant.summonerId;
      if (typeof summonerId === 'string' && summonerId !== '' && !mapping.summonerId.has(summonerId)) {
        mapping.summonerId.set(summonerId, `anon-summoner-${pad(mapping.summonerId.size + 1)}`);
      }
      if (typeof participant.championName === 'string') mapping.champions.add(participant.championName);
      for (const key of ['riotIdGameName', 'riotIdTagline', 'summonerName']) {
        const value = participant[key];
        if (typeof value === 'string' && value !== '') mapping.names.add(value);
      }
    }
  }

  // Accounts recorded by PUUID or Riot ID, and anyone only the manifest names.
  for (const file of files) {
    if (isHandAuthored(file)) continue;
    const body = file.data.body;
    if (isObject(body) && typeof body.puuid === 'string') {
      addPuuid(body.puuid);
      addNames(mapping, body);
    }
  }
  for (const player of players) addNames(mapping, player);
  return mapping;
}

function addNames(mapping: Mapping, account: JsonObject): void {
  for (const key of ['gameName', 'tagLine']) {
    const value = account[key];
    if (typeof value === 'string' && value !== '') mapping.names.add(value);
  }
}

function rewriteValue(value: Json, mapping: Mapping, key?: string): Json {
  if (typeof value === 'string') {
    const puuid = mapping.puuid.get(value);
    if (puuid !== undefined) return syntheticPuuid(puuid);
    return mapping.matchId.get(value) ?? mapping.summonerId.get(value) ?? value;
  }
  if (typeof value === 'number' && key === 'gameId') {
    for (const [real, synthetic] of mapping.matchId) if (matchNumber(real) === value) return matchNumber(synthetic);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, mapping));
  if (!isObject(value)) return value;

  const out: JsonObject = {};
  const n = typeof value.puuid === 'string' ? mapping.puuid.get(value.puuid) : undefined;
  const isParticipant = 'riotIdGameName' in value || 'summonerId' in value;
  for (const [field, inner] of Object.entries(value)) {
    if (isParticipant && DROPPED_PARTICIPANT_KEYS.has(field)) continue;
    if (n !== undefined && (field === 'gameName' || field === 'riotIdGameName')) {
      out[field] = inner === '' ? '' : `Player${pad(n)}`;
    } else if (n !== undefined && (field === 'tagLine' || field === 'riotIdTagline')) {
      out[field] = inner === '' ? '' : SYNTHETIC_TAG;
    } else if (isParticipant && field === 'summonerName') {
      out[field] = '';
    } else if (isParticipant && field === 'profileIcon') {
      out[field] = 29;
    } else if (isParticipant && field === 'summonerLevel') {
      out[field] = 30;
    } else if (field === 'gameName' && typeof inner === 'string' && /^teambuilder-match-\d+$/.test(inner)) {
      const real = [...mapping.matchId.keys()].find((id) => inner.endsWith(`-${matchNumber(id)}`));
      out[field] = real ? `teambuilder-match-${matchNumber(mapping.matchId.get(real)!)}` : inner;
    } else {
      out[field] = rewriteValue(inner, mapping, field);
    }
  }
  return out;
}

function rewritePath(path: string, data: JsonObject, mapping: Mapping): string {
  const match = MATCH_FILE.exec(path);
  if (match) {
    const id = mapping.matchId.get(match[1]!);
    return id ? path.replace(`/${match[1]}.json`, `/${id}.json`) : path;
  }
  const byPuuid = BY_PUUID.exec(path);
  if (byPuuid) {
    const n = mapping.puuid.get(decodeURIComponent(byPuuid[2]!));
    return n === undefined ? path : `${byPuuid[1]}${syntheticPuuid(n)}${byPuuid[3]}`;
  }
  if (BY_RIOT_ID.test(path) && isObject(data.body) && typeof data.body.puuid === 'string') {
    const n = mapping.puuid.get(data.body.puuid);
    if (n !== undefined) return `riot-regional/riot/account/v1/accounts/by-riot-id/Player${pad(n)}/${SYNTHETIC_TAG}.json`;
  }
  return path;
}

function rewriteManifest(manifest: JsonObject, mapping: Mapping, paths: Map<string, string>): JsonObject {
  const out = rewriteValue(manifest, mapping) as JsonObject;
  const primary = Array.isArray(out.players) ? out.players.filter(isObject).find((p) => p.role === 'primary') : undefined;
  if (primary && typeof out.riotId === 'string') out.riotId = `${String(primary.gameName)}#${String(primary.tagLine)}`;
  if (Array.isArray(out.derived)) {
    for (const entry of out.derived.filter(isObject)) {
      if (typeof entry.file === 'string') entry.file = paths.get(entry.file) ?? entry.file;
    }
  }
  return out;
}

/** Every real identifier still present in the rewritten text, by kind. */
function survivors(texts: string[], values: Json[], mapping: Mapping): string[] {
  const found: string[] = [];
  const all = texts.join('\n');
  for (const puuid of mapping.puuid.keys()) if (all.includes(puuid)) found.push(`puuid ${puuid.slice(0, 8)}…`);
  for (const id of mapping.summonerId.keys()) if (all.includes(id)) found.push(`summoner id ${id.slice(0, 8)}…`);
  for (const id of mapping.matchId.keys()) if (all.includes(String(matchNumber(id)))) found.push(`match id ${id}`);
  const strings = new Set<string>();
  const collect = (value: Json): void => {
    if (typeof value === 'string') strings.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (isObject(value)) Object.values(value).forEach(collect);
  };
  values.forEach(collect);
  for (const name of mapping.names) {
    // A tag line like BR1 is shared by too many players to identify anyone.
    if (name === SYNTHETIC_TAG || /^BR\d?$/i.test(name) || mapping.champions.has(name)) continue;
    if (strings.has(name)) found.push(`name of ${name.length} characters`);
  }
  return found;
}

function main(): void {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const inDir = args[0] ?? DEFAULT_IN;
  const outDir = args[1] ?? DEFAULT_OUT;
  const { files, manifest } = readSet(inDir);
  if (files.length === 0) throw new Error(`no Riot fixtures under ${inDir}; run pnpm record-fixtures first`);

  const mapping = buildMapping(files, manifest);
  const paths = new Map<string, string>();
  const written: Array<{ path: string; data: Json }> = files.map((file) => {
    const path = rewritePath(file.path, file.data, mapping);
    paths.set(file.path, path);
    return { path, data: rewriteValue(file.data, mapping) };
  });
  if (manifest) written.push({ path: 'manifest.json', data: rewriteManifest(manifest, mapping, paths) });

  const texts = written.map((file) => file.path + '\n' + JSON.stringify(file.data));
  const left = survivors(texts, written.map((file) => file.data), mapping);
  if (left.length > 0) throw new Error(`real identifiers would survive, nothing written:\n  ${left.join('\n  ')}`);

  for (const host of REWRITTEN) rmSync(join(outDir, host), { recursive: true, force: true });
  rmSync(join(outDir, 'manifest.json'), { force: true });
  for (const file of written) {
    const target = join(outDir, ...file.path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(file.data, null, 2) + '\n');
  }
  console.log(
    `fixtures:anonymise: wrote ${written.length} files to ${outDir}; ` +
      `${mapping.puuid.size} players, ${mapping.summonerId.size} summoner ids, ${mapping.matchId.size} match ids replaced`,
  );
}

try {
  main();
} catch (error) {
  console.error(`fixtures:anonymise: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
