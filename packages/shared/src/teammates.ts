import type { FormatId } from './formats';
import type { ProfileScope } from './profile';

/** Someone who shared the player's subteam, and how those games went. */
export interface TeammateStats {
  puuid: string;
  /** The Riot ID last seen; null when no match or lookup carried one. */
  gameName: string | null;
  tagLine: string | null;
  /** Games on the same subteam. */
  games: number;
  /** Those games placed first. */
  wins: number;
  /** Share of those games placed 1st to 4th, 0 to 1. */
  top4Rate: number;
}

/** `GET /api/profiles/:region/:gameName/:tagLine/teammates?format=&season=`, most games together first. */
export interface TeammatesResponse {
  format: FormatId;
  scope: ProfileScope;
  teammates: TeammateStats[];
}
