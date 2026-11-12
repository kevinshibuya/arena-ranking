import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../core/database';
import { matches, participants, ratingHistory, ratings, replayRuns } from '../../db/schema';
import { IRREGULAR } from '../formats/format-detector';
import { RatingReplay, type ReplayMatch } from './rating-replay';
import type { ReplaySummary } from './replay-job';

const RATING_BATCH = 2000;
const HISTORY_BATCH = 5000;
/** Matches read, rated and written per page; only the per-player state outlives a page. */
const MATCH_PAGE = 500;

function* batches<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let start = 0; start < items.length; start += size) yield items.slice(start, start + size);
}

/**
 * One replay run: every rating recomputed from the match table and written
 * under a new run id, which is marked complete last. Then every run older than
 * the previous complete one is deleted, finished or not. Matches are walked in
 * pages in end order, each page's history written before the next is read, so
 * memory holds one page plus the per-player state, and the event loop turns
 * between pages.
 */
@Injectable()
export class ReplayRunner {
  private readonly logger = new Logger(ReplayRunner.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async run(): Promise<ReplaySummary> {
    const [run] = await this.db.insert(replayRuns).values({}).returning({ id: replayRuns.id });
    const runId = run!.id;

    const state = new RatingReplay();
    let matchCount = 0;
    let historyPoints = 0;
    let after: ReplayMatch | undefined;
    for (;;) {
      const page = await this.matchPage(after);
      if (page.length === 0) break;
      const history = state.rate(page);
      for (const batch of batches(history, HISTORY_BATCH)) {
        await this.db.insert(ratingHistory).values(
          batch.map((point) => ({
            runId,
            puuid: point.puuid,
            format: point.format,
            scope: point.scope,
            matchId: point.matchId,
            ordinalAfter: point.ordinal,
          })),
        );
      }
      matchCount += page.length;
      historyPoints += history.length;
      after = page[page.length - 1];
    }

    const rated = state.ratings();
    for (const batch of batches(rated, RATING_BATCH)) {
      await this.db.insert(ratings).values(batch.map((rating) => ({ runId, ...rating })));
    }

    await this.db.update(replayRuns).set({ completedAt: new Date() }).where(eq(replayRuns.id, runId));
    await this.db.execute(sql`
      delete from replay_runs
      where id < (select id from replay_runs where completed_at is not null order by id desc offset 1 limit 1)
    `);

    const summary = { runId, matches: matchCount, ratings: rated.length, historyPoints };
    this.logger.log(summary, 'replay run complete');
    return summary;
  }

  /** The next page of matches with a ladder after `after`, in end order then id, with their participants. */
  private async matchPage(after: ReplayMatch | undefined): Promise<ReplayMatch[]> {
    const page = await this.db
      .select({ id: matches.id, format: matches.format, seasonId: matches.seasonId, endedAt: matches.endedAt })
      .from(matches)
      .where(
        and(
          ne(matches.format, IRREGULAR),
          after ? sql`(${matches.endedAt}, ${matches.id}) > (${after.endedAt.toISOString()}::timestamptz, ${after.id})` : undefined,
        ),
      )
      .orderBy(asc(matches.endedAt), asc(matches.id))
      .limit(MATCH_PAGE);
    if (page.length === 0) return [];

    const rows = await this.db
      .select({ matchId: participants.matchId, puuid: participants.puuid, subteamId: participants.subteamId, placement: participants.placement })
      .from(participants)
      .where(
        inArray(
          participants.matchId,
          page.map((match) => match.id),
        ),
      );
    const byId = new Map<string, ReplayMatch['participants'][number][]>(page.map((match) => [match.id, []]));
    for (const row of rows) byId.get(row.matchId)!.push({ puuid: row.puuid, subteamId: row.subteamId, placement: row.placement });
    return page.map((match) => ({ ...match, participants: byId.get(match.id)! }));
  }
}
