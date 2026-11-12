import type { FormatId } from '@arena/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DEFAULT_FORMAT, IRREGULAR } from '../modules/formats/format-detector';
import { REGIONS, type Region } from '../modules/riot-client/regions';

// The path and query values every region-, format- and scope-keyed endpoint
// reads, parsed one way. The season scope is SeasonsService.scope.

/** A region from the path; 404 for one the site does not cover. */
export function parseRegion(raw: string): Region {
  if (!Object.hasOwn(REGIONS, raw)) throw new NotFoundException(`Unknown region: ${raw}`);
  return raw as Region;
}

/** A format from the query, `6x3` when absent. */
export function parseFormat(raw: string | undefined): FormatId {
  if (raw === undefined || raw === '') return DEFAULT_FORMAT.id;
  if (raw === IRREGULAR || /^[1-9]\d*x[1-9]\d*$/.test(raw)) return raw as FormatId;
  throw new BadRequestException(`Unknown format: ${raw}`);
}

/** A format that has a ladder: any but irregular. */
export function parseLadderFormat(raw: string | undefined): FormatId {
  const format = parseFormat(raw);
  if (format === IRREGULAR) throw new BadRequestException('Irregular lobbies have no ladder');
  return format;
}
