import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { REQUIRED_DERIVED, requiredFile } from './derived';
import { fixtureFile, matchPath, readFixture, type MatchLike } from './fixtures';
import { hasManifest, readManifest, MANIFEST_FILE, type ManifestPlayer } from './manifest';
import { seasonOfVersion, seasonStart, type SeasonLike } from './shape';

// fixtures:check. Every problem with a fixture set, one line each; an empty
// list means the set is complete.

export interface CheckOptions {
  /** The seed the seasons table is seeded from: SEASON_SEED. */
  seasons: readonly SeasonLike[];
}

function seasonOf(version: string, seasons: readonly SeasonLike[]): SeasonLike | null {
  try {
    return seasonOfVersion(version, seasons);
  } catch {
    return null;
  }
}

function accountPaths(player: ManifestPlayer): string[] {
  return [
    `/riot/account/v1/accounts/by-puuid/${player.puuid}`,
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(player.gameName)}/${encodeURIComponent(player.tagLine)}`,
  ];
}

export function checkFixtures(dir: string, options: CheckOptions): string[] {
  if (!hasManifest(dir)) return [`${MANIFEST_FILE} is missing`];
  const problems: string[] = [];
  const manifest = readManifest(dir);
  const file = (path: string): string => fixtureFile(dir, 'riot-regional', path);

  const players = (['primary', 'teammate'] as const).map((role) => {
    const player = manifest.players.find((candidate) => candidate.role === role);
    if (!player) problems.push(`no ${role} player recorded`);
    return player;
  });

  for (const player of players) {
    if (!player) continue;
    for (const path of accountPaths(player)) {
      if (!existsSync(file(path))) problems.push(`${player.role} account missing: ${path}`);
    }
    if (player.currentSeasonMatchIds.length === 0) problems.push(`${player.role} has no current-season match`);
    if (!player.currentSeasonListed) problems.push(`${player.role} has no current-season listed count`);
    else if (player.currentSeasonListed.total < player.currentSeasonMatchIds.length) {
      problems.push(`${player.role} lists ${player.currentSeasonListed.total} current-season matches but has ${player.currentSeasonMatchIds.length} recorded`);
    }
    for (const id of [...player.currentSeasonMatchIds, ...player.earlierMatchIds]) {
      if (!existsSync(file(matchPath(id)))) problems.push(`${player.role} match missing: ${id}`);
    }
  }

  const [primary, teammate] = players;
  if (primary && teammate) {
    const shared = manifest.sharedCurrentSeasonMatchIds.filter((id) => {
      if (!existsSync(file(matchPath(id)))) return false;
      const match = readFixture(file(matchPath(id))).body as MatchLike;
      return match.metadata.participants.includes(primary.puuid) && match.metadata.participants.includes(teammate.puuid);
    });
    if (shared.length === 0) problems.push('no recorded current-season match shared by both players');
  }

  // Against the seed: what the recorder took as current season by date must be
  // the current season by patch, and the earlier sample an earlier season.
  const current = options.seasons.find((season) => season.name === manifest.currentSeason.name);
  if (!current) problems.push(`manifest's current season ${manifest.currentSeason.name} is not in the seed`);
  const versionOf = (id: string): string | undefined => {
    if (!existsSync(file(matchPath(id)))) return undefined;
    return (readFixture(file(matchPath(id))).body as MatchLike).info.gameVersion;
  };
  const recordedPlayers = players.filter((player) => player !== undefined);
  for (const id of new Set(recordedPlayers.flatMap((player) => player.currentSeasonMatchIds))) {
    const version = versionOf(id);
    if (!current || version === undefined) continue;
    const season = seasonOf(version, options.seasons);
    if (season?.name !== current.name) {
      problems.push(`current-season match ${id} is on ${version}, which maps to ${season?.name ?? 'no season'}, not ${current.name}`);
    }
  }
  for (const id of new Set(recordedPlayers.flatMap((player) => player.earlierMatchIds))) {
    const version = versionOf(id);
    if (!current || version === undefined) continue;
    const season = seasonOf(version, options.seasons);
    if (!season || seasonStart(season) >= seasonStart(current)) {
      problems.push(`earlier match ${id} is on ${version}, which maps to ${season?.name ?? 'no season'}, not an earlier season`);
    }
  }

  for (const required of REQUIRED_DERIVED) {
    const path = requiredFile(dir, required);
    if (!existsSync(path)) {
      problems.push(`derived fixture missing: ${relative(dir, path)}`);
      continue;
    }
    const fixture = readFixture(path);
    if (fixture.status !== required.status) problems.push(`${relative(dir, path)}: status ${fixture.status}, expected ${required.status}`);
    if (!fixture.derived) problems.push(`${relative(dir, path)}: not marked derived`);
  }

  if (manifest.formats.length === 0) problems.push('manifest lists no format');
  for (const format of manifest.formats) {
    if (format.queueIds.length === 0) problems.push(`manifest format ${format.format} lists no queue id`);
  }
  return problems;
}
