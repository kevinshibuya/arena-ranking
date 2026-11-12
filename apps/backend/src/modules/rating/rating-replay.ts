import type { FormatId } from '@arena/shared';
import { ordinal, rate, rating, type Rating } from 'openskill';
import { IRREGULAR } from '../formats/format-detector';

/** All-time, or a season id as text: the `season` query value of every scoped endpoint. */
export type RatingScope = 'all' | `${number}`;

export const ALL_TIME: RatingScope = 'all';

export function seasonScope(seasonId: number): RatingScope {
  return `${seasonId}`;
}

/** A stored match as the replay reads it. */
export interface ReplayMatch {
  id: string;
  format: FormatId;
  /** Null when the patch precedes every season: rated all-time only. */
  seasonId: number | null;
  endedAt: Date;
  participants: readonly { puuid: string; subteamId: number | null; placement: number }[];
}

/** A player's rating in one format and scope after every match of it. */
export interface ReplayRating {
  puuid: string;
  format: FormatId;
  scope: RatingScope;
  mu: number;
  sigma: number;
  /** mu minus three sigma: the displayed rating. */
  ordinal: number;
  games: number;
  wins: number;
  top4s: number;
  placementSum: number;
}

/** A player's ordinal right after one rated match. */
export interface ReplayHistoryPoint {
  puuid: string;
  format: FormatId;
  scope: RatingScope;
  matchId: string;
  ordinal: number;
}

export interface ReplayResult {
  ratings: ReplayRating[];
  history: ReplayHistoryPoint[];
}

/** Riot's own order: end time, then match id. */
export function chronological(a: ReplayMatch, b: ReplayMatch): number {
  const byEnd = a.endedAt.getTime() - b.endedAt.getTime();
  if (byEnd !== 0) return byEnd;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface Team {
  placement: number;
  puuids: string[];
}

/** Subteams in id order, members by PUUID, so the input's listing order never matters. */
function teamsOf(match: ReplayMatch): Team[] {
  const bySubteam = new Map<number, Team>();
  for (const { puuid, subteamId, placement } of match.participants) {
    if (subteamId === null) continue;
    const team = bySubteam.get(subteamId) ?? { placement, puuids: [] };
    team.placement = Math.min(team.placement, placement);
    team.puuids.push(puuid);
    bySubteam.set(subteamId, team);
  }
  return [...bySubteam.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, team]) => ({ placement: team.placement, puuids: team.puuids.sort() }));
}

/**
 * The rating state of a replay in progress: feed it matches oldest first, in
 * slices of any size, and it rates each one with openskill's Plackett-Luce model
 * in each of its scopes (its season, if any, and all-time), one ladder per
 * format. Teams are subteams, ranked by placement; equal placements are ties.
 * Irregular lobbies are not rated. Only the per-player state is held, so a
 * caller streaming pages of matches holds one page at a time.
 */
export class RatingReplay {
  private readonly states = new Map<string, ReplayRating>();

  /** Rates matches given in chronological order; returns the history points they add. */
  rate(matches: readonly ReplayMatch[]): ReplayHistoryPoint[] {
    const history: ReplayHistoryPoint[] = [];
    for (const match of matches) {
      if (match.format === IRREGULAR) continue;
      const teams = teamsOf(match);
      if (teams.length < 2) continue;
      const scopes: RatingScope[] = match.seasonId === null ? [ALL_TIME] : [seasonScope(match.seasonId), ALL_TIME];

      for (const scope of scopes) {
        const before: Rating[][] = teams.map((team) =>
          team.puuids.map((puuid) => {
            const state = this.stateOf(puuid, match.format, scope);
            return { mu: state.mu, sigma: state.sigma };
          }),
        );
        const after = rate(before, { rank: teams.map((team) => team.placement) });

        teams.forEach((team, t) => {
          team.puuids.forEach((puuid, p) => {
            const state = this.stateOf(puuid, match.format, scope);
            const next = after[t]![p]!;
            state.mu = next.mu;
            state.sigma = next.sigma;
            state.ordinal = ordinal(next);
            state.games += 1;
            if (team.placement === 1) state.wins += 1;
            if (team.placement <= 4) state.top4s += 1;
            state.placementSum += team.placement;
            history.push({ puuid, format: match.format, scope, matchId: match.id, ordinal: state.ordinal });
          });
        });
      }
    }
    return history;
  }

  /** Every player's rating so far, one per format and scope they played in. */
  ratings(): ReplayRating[] {
    return [...this.states.values()];
  }

  private stateOf(puuid: string, format: FormatId, scope: RatingScope): ReplayRating {
    const key = `${format}|${scope}|${puuid}`;
    let state = this.states.get(key);
    if (!state) {
      const initial = rating();
      state = {
        puuid,
        format,
        scope,
        mu: initial.mu,
        sigma: initial.sigma,
        ordinal: ordinal(initial),
        games: 0,
        wins: 0,
        top4s: 0,
        placementSum: 0,
      };
      this.states.set(key, state);
    }
    return state;
  }
}

/**
 * Every rating from zero over an in-memory set of matches. The result depends
 * only on the set of matches, never on the order they are given in.
 */
export function replay(matches: readonly ReplayMatch[]): ReplayResult {
  const state = new RatingReplay();
  const history = state.rate([...matches].sort(chronological));
  return { ratings: state.ratings(), history };
}
