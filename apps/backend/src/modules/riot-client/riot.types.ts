// The parts of Riot's account-v1 and match-v5 payloads the app reads. Riot sends
// more; the raw match JSON is stored whole, so a field added here later is
// already in every stored match.

export interface AccountDto {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface ParticipantDto {
  puuid: string;
  riotIdGameName: string;
  riotIdTagline: string;
  championId: number;
  championName: string;
  /** Team placement, 1 is first. */
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

export interface MatchDto {
  metadata: { dataVersion: string; matchId: string; participants: string[] };
  info: {
    gameId: number;
    /** Epoch milliseconds. */
    gameCreation: number;
    gameStartTimestamp: number;
    gameEndTimestamp: number;
    /** Seconds. */
    gameDuration: number;
    gameMode: string;
    gameVersion: string;
    mapId: number;
    platformId: string;
    queueId: number;
    participants: ParticipantDto[];
  };
}

export interface PlatformStatusDto {
  id: string;
  name: string;
}

export interface MatchIdsQuery {
  queue?: number;
  /** Rounded down to the second, as Riot takes epoch seconds. */
  startTime?: Date;
  endTime?: Date;
  /** Offset into the list, newest first. Riot's default is 0. */
  start?: number;
  /** 1 to 100. Riot's default is 20. */
  count?: number;
}
