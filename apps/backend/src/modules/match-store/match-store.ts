import { Inject, Injectable } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../core/database';
import { matches, participants, players } from '../../db/schema';
import { detectFormat } from '../formats/format-detector';
import type { Region } from '../riot-client/regions';
import type { MatchDto, ParticipantDto } from '../riot-client/riot.types';
import { SeasonsService } from '../seasons/seasons.service';

const ITEM_SLOTS = ['item0', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6'] as const;
const AUGMENT_SLOTS = [
  'playerAugment1',
  'playerAugment2',
  'playerAugment3',
  'playerAugment4',
  'playerAugment5',
  'playerAugment6',
] as const;

function slots(participant: ParticipantDto, names: readonly (keyof ParticipantDto)[]): number[] {
  return names.map((name) => Number(participant[name] ?? 0));
}

/**
 * One row per match and one per participant, keyed by Riot's ids, so a match
 * seen from several players is stored once. Storing a match also makes every
 * participant a tracked player, under the Riot ID the match carries unless a
 * newer sighting is already stored.
 */
@Injectable()
export class MatchStore {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly seasons: SeasonsService,
  ) {}

  /** The ids among `ids` already stored. */
  async storedIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db.select({ id: matches.id }).from(matches).where(inArray(matches.id, [...ids]));
    return new Set(rows.map((row) => row.id));
  }

  async store(region: Region, match: MatchDto): Promise<void> {
    const { info } = match;
    const season = await this.seasons.forGameVersion(info.gameVersion);
    const startedAt = new Date(info.gameStartTimestamp || info.gameCreation);
    const endedAt = new Date(info.gameEndTimestamp || startedAt.getTime() + info.gameDuration * 1000);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(matches)
        .values({
          id: match.metadata.matchId,
          region,
          queueId: info.queueId,
          gameVersion: info.gameVersion,
          seasonId: season?.id ?? null,
          format: detectFormat(info.participants),
          startedAt,
          endedAt,
          durationSeconds: info.gameDuration,
          raw: match,
        })
        .onConflictDoNothing();

      await tx
        .insert(participants)
        .values(
          info.participants.map((p) => ({
            matchId: match.metadata.matchId,
            puuid: p.puuid,
            subteamId: p.playerSubteamId || null,
            placement: p.placement,
            championId: p.championId,
            kills: p.kills,
            deaths: p.deaths,
            assists: p.assists,
            damage: p.totalDamageDealtToChampions,
            gold: p.goldEarned,
            items: slots(p, ITEM_SLOTS),
            augmentIds: slots(p, AUGMENT_SLOTS),
          })),
        )
        .onConflictDoNothing();

      // Sorted, so concurrent matches sharing players lock their rows in one order.
      const seen = [...info.participants].sort((a, b) => (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0));
      await tx
        .insert(players)
        .values(
          seen.map((p) => {
            const named = Boolean(p.riotIdGameName) && Boolean(p.riotIdTagline);
            return {
              puuid: p.puuid,
              region,
              gameName: named ? p.riotIdGameName : null,
              tagLine: named ? p.riotIdTagline : null,
              riotIdSeenAt: named ? startedAt : null,
            };
          }),
        )
        .onConflictDoUpdate({
          target: players.puuid,
          set: {
            gameName: sql`excluded.game_name`,
            tagLine: sql`excluded.tag_line`,
            riotIdSeenAt: sql`excluded.riot_id_seen_at`,
          },
          setWhere: sql`excluded.riot_id_seen_at is not null
            and (${players.riotIdSeenAt} is null or ${players.riotIdSeenAt} < excluded.riot_id_seen_at)`,
        });
    });
  }
}
