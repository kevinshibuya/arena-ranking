import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// manifest.json, beside the fixtures: what the recorder recorded and for whom,
// the lobby formats seen under each queue id, and every derived or hand-authored
// fixture with what it stands for.

export interface ManifestPlayer {
  role: 'primary' | 'teammate';
  puuid: string;
  gameName: string;
  tagLine: string;
  /**
   * Riot's full current-season listing for the player, once per Arena queue id:
   * the count to check against the client's match history.
   */
  currentSeasonListed: { total: number; byQueue: Record<string, number> };
  /**
   * Recorded current-season matches the player is in, newest first: what the
   * fake lists for them. The recorder records the newest bodies only, so this can
   * be shorter than the listing.
   */
  currentSeasonMatchIds: string[];
  /** The sample recorded from earlier 2026 seasons. */
  earlierMatchIds: string[];
}

export interface ManifestFormat {
  /** Teams x team size, e.g. 6x3, or `irregular` for uneven teams. */
  format: string;
  queueIds: number[];
  matches: number;
}

export interface ManifestDerived {
  /** Relative to the fixtures directory. */
  file: string;
  note: string;
  /** The recorded match it was derived from; absent when hand-authored. */
  from?: string;
  matchId?: string;
  format?: string;
  /** The season the match belongs to by its patch, or null before the first season. */
  season?: string | null;
}

export interface Manifest {
  recordedAt: string;
  region: string;
  riotId: string;
  currentSeason: { name: string; startsAt: string };
  players: ManifestPlayer[];
  /** Current-season matches both recorded players played, ascending. */
  sharedCurrentSeasonMatchIds: string[];
  /** Over recorded matches only. */
  formats: ManifestFormat[];
  derived: ManifestDerived[];
}

export const MANIFEST_FILE = 'manifest.json';

export function hasManifest(dir: string): boolean {
  return existsSync(join(dir, MANIFEST_FILE));
}

export function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')) as Manifest;
}

export function writeManifest(dir: string, manifest: Manifest): void {
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n');
}
