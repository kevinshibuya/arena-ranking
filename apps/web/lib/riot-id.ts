export interface RiotId {
  gameName: string;
  tagLine: string;
}

export type ParsedRiotId = { ok: true; riotId: RiotId } | { ok: false; problem: string };

/**
 * A Riot ID typed as `Name#TAG`. Riot allows 3 to 16 characters before the #
 * and 3 to 5 letters or digits after it.
 */
export function parseRiotId(input: string): ParsedRiotId {
  const text = input.trim();
  const hash = text.lastIndexOf('#');
  if (hash < 0) return { ok: false, problem: 'Add the tag after a #, as in Name#BR1.' };
  const gameName = text.slice(0, hash).trim();
  const tagLine = text.slice(hash + 1).trim();
  if ([...gameName].length < 3 || [...gameName].length > 16) {
    return { ok: false, problem: 'The name before the # is 3 to 16 characters long.' };
  }
  if (!/^[\p{L}\p{N}]{3,5}$/u.test(tagLine)) {
    return { ok: false, problem: 'The tag after the # is 3 to 5 letters or digits.' };
  }
  return { ok: true, riotId: { gameName, tagLine } };
}

/** The profile path: region, then the Riot ID with the tag after a dash. */
export function profilePath(region: string, riotId: RiotId, query = ''): string {
  return `/${region}/${encodeURIComponent(riotId.gameName)}-${encodeURIComponent(riotId.tagLine)}${query}`;
}

/** The Riot ID in a profile path segment, split at its last dash, since a tag never holds one. */
export function riotIdFromSegment(segment: string): RiotId | null {
  let text: string;
  try {
    text = decodeURIComponent(segment);
  } catch {
    return null;
  }
  const dash = text.lastIndexOf('-');
  if (dash <= 0 || dash === text.length - 1) return null;
  return { gameName: text.slice(0, dash), tagLine: text.slice(dash + 1) };
}

export function riotIdText(riotId: RiotId): string {
  return `${riotId.gameName}#${riotId.tagLine}`;
}
