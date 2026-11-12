import { Controller, Get } from '@nestjs/common';
import type { FormatId, FormatsResponse } from '@arena/shared';
import { DEFAULT_FORMAT, formatLabel, IRREGULAR } from './format-detector';

/** The formats Arena runs, the default first. Irregular lobbies are stored but never laddered. */
const KNOWN_FORMATS: readonly FormatId[] = [DEFAULT_FORMAT.id, '8x2', IRREGULAR];

@Controller('formats')
export class FormatsController {
  @Get()
  list(): FormatsResponse {
    return {
      formats: KNOWN_FORMATS.map((id) => ({
        id,
        label: formatLabel(id),
        ladder: id !== IRREGULAR,
        default: id === DEFAULT_FORMAT.id,
      })),
    };
  }
}
