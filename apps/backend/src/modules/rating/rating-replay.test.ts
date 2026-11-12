import { SEASON_SEED } from '../seasons/season-seed';
import { seasonForGameVersion, type Season } from '../seasons/season-lookup';
import { chronological, RatingReplay, replay, type ReplayMatch, type ReplayRating } from './rating-replay';

// The pure replay over in-memory matches: the one seam below the HTTP API.

const SEASONS: Season[] = SEASON_SEED.map((season, index) => ({ ...season, id: index + 1, startsAt: new Date(season.startsAt) }));
const SEASON_3 = 3;

let clock = Date.parse('2026-09-01T00:00:00Z');

/** A match whose teams are listed best first: `[['a'], ['b']]` is a 2x1 lobby that `a` won. */
function match(id: string, teams: string[][], options: { placements?: number[]; seasonId?: number | null } = {}): ReplayMatch {
  clock += 60_000;
  return {
    id,
    format: `${teams.length}x${teams[0]!.length}`,
    seasonId: options.seasonId === undefined ? SEASON_3 : options.seasonId,
    endedAt: new Date(clock),
    participants: teams.flatMap((team, index) =>
      team.map((puuid) => ({ puuid, subteamId: index + 1, placement: options.placements?.[index] ?? index + 1 })),
    ),
  };
}

function ratingOf(ratings: readonly ReplayRating[], puuid: string, scope = String(SEASON_3)): ReplayRating {
  const found = ratings.find((rating) => rating.puuid === puuid && rating.scope === scope);
  if (!found) throw new Error(`no ${scope} rating for ${puuid}`);
  return found;
}

describe('rating replay', () => {
  it('rates a first four-player lobby as openskill documents it, displaying mu minus three sigma', () => {
    // openskill's README: rate([[a], [b], [c], [d]], { rank: [4, 1, 3, 2] }) from the defaults; the README rounds its figures.
    const { ratings } = replay([match('M1', [['a'], ['b'], ['c'], ['d']], { placements: [4, 1, 3, 2] })]);

    expect(ratingOf(ratings, 'a').mu).toBeCloseTo(20.963, 2);
    expect(ratingOf(ratings, 'b').mu).toBeCloseTo(27.795, 2);
    expect(ratingOf(ratings, 'b').sigma).toBeCloseTo(8.263, 2);
    expect(ratingOf(ratings, 'c').mu).toBeCloseTo(24.689, 2);
    expect(ratingOf(ratings, 'd').mu).toBeCloseTo(26.553, 2);
    const winner = ratingOf(ratings, 'b');
    expect(winner.ordinal).toBeCloseTo(winner.mu - 3 * winner.sigma, 10);
    expect(winner).toMatchObject({ format: '4x1', games: 1, wins: 1, top4s: 1, placementSum: 1 });
    expect(ratingOf(ratings, 'a')).toMatchObject({ games: 1, wins: 0, top4s: 1, placementSum: 4 });
  });

  it('orders players who always finish in the same order by that order', () => {
    const lobby = [['ana'], ['bia'], ['caio'], ['davi']];
    const { ratings } = replay([match('M1', lobby), match('M2', lobby), match('M3', lobby)]);

    const ladder = ratings
      .filter((rating) => rating.scope === String(SEASON_3))
      .sort((a, b) => b.ordinal - a.ordinal)
      .map((rating) => rating.puuid);
    expect(ladder).toEqual(['ana', 'bia', 'caio', 'davi']);
    expect(ratingOf(ratings, 'ana')).toMatchObject({ games: 3, wins: 3, placementSum: 3 });
  });

  it('gives the same ratings and history whatever order the matches arrive in', () => {
    const matches = [
      match('M1', [['ana', 'bia'], ['caio', 'davi'], ['eva', 'fabi']]),
      match('M2', [['ana', 'caio'], ['eva', 'bia'], ['davi', 'fabi']]),
      match('M3', [['fabi', 'eva'], ['ana', 'davi'], ['bia', 'caio']]),
      match('M4', [['davi', 'bia'], ['fabi', 'ana'], ['caio', 'eva']]),
    ];
    // Same end time as M4: the match id breaks the tie.
    matches.push({ ...match('M5', [['caio', 'ana'], ['bia', 'fabi'], ['eva', 'davi']]), endedAt: matches[3]!.endedAt });
    const shuffled = [matches[4]!, matches[2]!, matches[0]!, matches[3]!, matches[1]!].map((m) => ({
      ...m,
      participants: [...m.participants].reverse(),
    }));

    const inOrder = replay(matches);
    const outOfOrder = replay(shuffled);

    const byKey = (result: { ratings: ReplayRating[] }) =>
      Object.fromEntries(result.ratings.map((r) => [`${r.scope}|${r.puuid}`, r]));
    expect(byKey(outOfOrder)).toEqual(byKey(inOrder));
    const sortHistory = (points: typeof inOrder.history) =>
      [...points].sort((a, b) => (a.matchId + a.scope + a.puuid).localeCompare(b.matchId + b.scope + b.puuid));
    expect(sortHistory(outOfOrder.history)).toEqual(sortHistory(inOrder.history));
  });

  it('rates the same in one call or in chronological pages, as the runner streams them', () => {
    const matches = [
      match('P1', [['ana', 'bia'], ['caio', 'davi'], ['eva', 'fabi']]),
      match('P2', [['ana', 'caio'], ['eva', 'bia'], ['davi', 'fabi']]),
      match('P3', [['fabi', 'eva'], ['ana', 'davi'], ['bia', 'caio']]),
      match('P4', [['davi', 'bia'], ['fabi', 'ana'], ['caio', 'eva']]),
      match('P5', [['caio', 'ana'], ['bia', 'fabi'], ['eva', 'davi']]),
    ].sort(chronological);

    const paged = new RatingReplay();
    const history = [...paged.rate(matches.slice(0, 3)), ...paged.rate(matches.slice(3))];

    const whole = replay(matches);
    expect(paged.ratings()).toEqual(whole.ratings);
    expect(history).toEqual(whole.history);
  });

  it('rates equal placements as a tie', () => {
    // openskill's README: scores [37, 19, 37, 42] are placements 2, 4, 2, 1.
    const { ratings } = replay([match('M1', [['a'], ['b'], ['c'], ['d']], { placements: [2, 4, 2, 1] })]);

    expect(ratingOf(ratings, 'a').mu).toBeCloseTo(24.689, 2);
    expect(ratingOf(ratings, 'a').sigma).toBeCloseTo(8.179, 2);
    expect(ratingOf(ratings, 'c')).toMatchObject({ mu: ratingOf(ratings, 'a').mu, sigma: ratingOf(ratings, 'a').sigma });
    expect(ratingOf(ratings, 'b').mu).toBeCloseTo(22.826, 2);
    expect(ratingOf(ratings, 'd').mu).toBeCloseTo(27.795, 2);
  });

  it("rates a game on a season's last patch in that season and all-time, after the next season started", () => {
    // Game version 16.16, two hours after Season 3 started: Season 2 by its patch.
    const season = seasonForGameVersion('16.16.811.2640', SEASONS)!;
    const lastPatch = {
      ...match('BR1_9000000003', [['ana'], ['bia']], { seasonId: season.id }),
      endedAt: new Date('2026-08-26T02:00:00Z'),
    };
    const { ratings } = replay([lastPatch, match('M2', [['ana'], ['bia']])]);

    expect(season.name).toBe('2026 Season 2');
    expect(ratingOf(ratings, 'ana', String(season.id))).toMatchObject({ games: 1 });
    expect(ratingOf(ratings, 'ana', String(SEASON_3))).toMatchObject({ games: 1 });
    expect(ratingOf(ratings, 'ana', 'all')).toMatchObject({ games: 2 });
  });

  it('rates a game before every season all-time only', () => {
    const { ratings } = replay([match('M1', [['ana'], ['bia']], { seasonId: null })]);

    expect(ratings.map((r) => r.scope)).toEqual(['all', 'all']);
  });

  it('keeps each format on its own ladder and skips irregular lobbies', () => {
    const irregular: ReplayMatch = { ...match('M3', [['ana', 'bia'], ['caio']]), format: 'irregular' };
    const { ratings, history } = replay([
      match('M1', [['ana'], ['bia']]),
      match('M2', [['ana', 'bia'], ['caio', 'davi']]),
      irregular,
    ]);

    const anas = ratings.filter((r) => r.puuid === 'ana' && r.scope === 'all');
    expect(anas.map((r) => [r.format, r.games]).sort()).toEqual([
      ['2x1', 1],
      ['2x2', 1],
    ]);
    expect(history.some((point) => point.matchId === 'M3')).toBe(false);
  });

  it('records one history point per rated match and scope, ending at the rating', () => {
    const lobby = [['ana'], ['bia']];
    const { ratings, history } = replay([match('M1', lobby), match('M2', lobby), match('M3', lobby)]);

    const anaSeason = history.filter((point) => point.puuid === 'ana' && point.scope === String(SEASON_3));
    expect(anaSeason.map((point) => point.matchId)).toEqual(['M1', 'M2', 'M3']);
    expect(anaSeason.at(-1)!.ordinal).toBe(ratingOf(ratings, 'ana').ordinal);
    expect(history).toHaveLength(3 * 2 * 2);
  });
});
