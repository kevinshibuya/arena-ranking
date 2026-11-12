import { BadRequestException } from '@nestjs/common';
import type { LadderMark } from './ladder-query';

/** A page's continuation: the run it was read from and its last row. Opaque to clients. */
export interface LadderCursor extends LadderMark {
  runId: number;
}

export function encodeCursor(cursor: LadderCursor): string {
  return Buffer.from(JSON.stringify([cursor.runId, cursor.ordinal, cursor.puuid, cursor.rank])).toString('base64url');
}

export function decodeCursor(raw: string): LadderCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    parsed = null;
  }
  if (
    Array.isArray(parsed) &&
    parsed.length === 4 &&
    Number.isInteger(parsed[0]) &&
    typeof parsed[1] === 'number' &&
    typeof parsed[2] === 'string' &&
    Number.isInteger(parsed[3])
  ) {
    const [runId, ordinal, puuid, rank] = parsed as [number, number, string, number];
    return { runId, ordinal, puuid, rank };
  }
  throw new BadRequestException('Malformed cursor');
}
