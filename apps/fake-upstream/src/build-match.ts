import type { MatchLike } from './fixtures';

// A synthetic match-v5 match carrying the fields the app reads, for tests that
// need precise control over participants, queue and time. Recorded matches are
// the real thing; this is for exercising filters and edge cases.

export interface BuildMatchOptions {
  id: string;
  /** gameCreation, epoch milliseconds. */
  created: number;
  /** PUUIDs per team, in placement order: the first team placed 1st. */
  teams: string[][];
  queue?: number;
  version?: string;
  durationSeconds?: number;
}

export interface BuiltParticipant {
  puuid: string;
  riotIdGameName: string;
  riotIdTagline: string;
  championId: number;
  championName: string;
  placement: number;
  playerSubteamId: number;
  subteamPlacement: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalDamageDealtToChampions: number;
  goldEarned: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
  playerAugment1: number;
  playerAugment2: number;
  playerAugment3: number;
  playerAugment4: number;
  playerAugment5: number;
  playerAugment6: number;
}

export interface BuiltMatch extends MatchLike {
  metadata: { dataVersion: string; matchId: string; participants: string[] };
  info: MatchLike['info'] & {
    gameId: number;
    gameStartTimestamp: number;
    gameEndTimestamp: number;
    gameDuration: number;
    gameMode: string;
    mapId: number;
    platformId: string;
    participants: BuiltParticipant[];
  };
}

export function buildMatch(options: BuildMatchOptions): BuiltMatch {
  const duration = options.durationSeconds ?? 1500;
  const start = options.created + 30_000;
  const participants = options.teams.flatMap((team, index) =>
    team.map((puuid, slot): BuiltParticipant => ({
      puuid,
      riotIdGameName: `Player ${puuid}`,
      riotIdTagline: 'BR1',
      championId: 1 + index * 10 + slot,
      championName: `Champion${1 + index * 10 + slot}`,
      placement: index + 1,
      playerSubteamId: index + 1,
      subteamPlacement: index + 1,
      win: index < options.teams.length / 2,
      kills: 5,
      deaths: 3,
      assists: 4,
      totalDamageDealtToChampions: 20_000,
      goldEarned: 9_000,
      item0: 0,
      item1: 0,
      item2: 0,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 0,
      playerAugment1: 1,
      playerAugment2: 2,
      playerAugment3: 3,
      playerAugment4: 4,
      playerAugment5: 0,
      playerAugment6: 0,
    })),
  );
  return {
    metadata: { dataVersion: '2', matchId: options.id, participants: participants.map((p) => p.puuid) },
    info: {
      gameId: Number(options.id.replace(/^[^_]*_/, '')),
      gameCreation: options.created,
      gameStartTimestamp: start,
      gameEndTimestamp: start + duration * 1000,
      gameDuration: duration,
      gameMode: 'CHERRY',
      gameVersion: options.version ?? '16.19.712.4521',
      mapId: 30,
      platformId: 'BR1',
      queueId: options.queue ?? 1700,
      participants,
    },
  };
}
