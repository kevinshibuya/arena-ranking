import type { Fixture, MatchLike } from './fixtures';

// match-v5 "match ids by PUUID", answered from the matches the fake holds.
// Riot's docs give startTime and endTime as epoch seconds without naming the
// field they compare; this compares gameCreation, inclusive at both ends.

export const LISTING_PATH = /^\/lol\/match\/v5\/matches\/by-puuid\/([^/]+)\/ids$/;

// What a development key's responses carry.
const RATE_LIMIT_HEADERS = {
  'x-app-rate-limit': '20:1,100:120',
  'x-app-rate-limit-count': '1:1,1:120',
  'x-method-rate-limit': '2000:10',
  'x-method-rate-limit-count': '1:10',
};

function integer(query: URLSearchParams, name: string): number | undefined {
  const raw = query.get(name);
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return value;
}

function badRequest(message: string): Fixture {
  return {
    status: 400,
    headers: RATE_LIMIT_HEADERS,
    body: { status: { message: `Bad Request - ${message}`, status_code: 400 } },
  };
}

export function listMatchIds(matches: Iterable<MatchLike>, puuid: string, query: URLSearchParams): Fixture {
  let queue, startTime, endTime, start, count;
  try {
    queue = integer(query, 'queue');
    startTime = integer(query, 'startTime');
    endTime = integer(query, 'endTime');
    start = integer(query, 'start') ?? 0;
    count = integer(query, 'count') ?? 20;
  } catch (error) {
    return badRequest((error as Error).message);
  }
  if (count < 1 || count > 100) return badRequest('count must be between 1 and 100');

  const ids = [...matches]
    .filter((match) => match.metadata.participants.includes(puuid))
    .filter((match) => queue === undefined || match.info.queueId === queue)
    .filter((match) => startTime === undefined || match.info.gameCreation >= startTime * 1000)
    .filter((match) => endTime === undefined || match.info.gameCreation <= endTime * 1000)
    .sort(
      (a, b) =>
        b.info.gameCreation - a.info.gameCreation ||
        b.metadata.matchId.localeCompare(a.metadata.matchId, 'en', { numeric: true }),
    )
    .slice(start, start + count)
    .map((match) => match.metadata.matchId);

  return { status: 200, headers: RATE_LIMIT_HEADERS, body: ids };
}
