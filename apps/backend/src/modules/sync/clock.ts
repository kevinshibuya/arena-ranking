import { Injectable } from '@nestjs/common';

/**
 * Where the sync module reads "now": a sync's start, the season it lists, the
 * sweep's look-back. Tests replace it to run the sweep over the dated fixtures.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
