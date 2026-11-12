-- Tracked players, stored matches and their participants.

create table players (
  puuid text primary key,
  region text not null,
  -- The Riot ID last seen, and when: an account lookup counts as now, a match
  -- as its start. An older sighting never overwrites a newer one.
  game_name text,
  tag_line text,
  riot_id_seen_at timestamptz,
  sync_state text not null default 'unknown' check (
    sync_state in ('unknown', 'primary-syncing', 'primary-synced', 'backfilling', 'complete', 'no-arena-games')
  ),
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create table matches (
  id text primary key,
  region text not null,
  -- Stored, never trusted for the lobby shape: format comes from the participants.
  queue_id integer not null,
  game_version text not null,
  -- Null when the patch precedes every season.
  season_id integer references seasons (id),
  format text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null,
  raw jsonb not null
);

alter table matches alter column raw set compression lz4;

create index matches_season_format on matches (season_id, format);

create table participants (
  match_id text not null references matches (id) on delete cascade,
  puuid text not null,
  subteam_id integer,
  placement integer not null,
  champion_id integer not null,
  kills integer not null,
  deaths integer not null,
  assists integer not null,
  damage integer not null,
  gold integer not null,
  -- item0 to item6, 0 for an empty slot.
  items integer[] not null,
  -- playerAugment1 to playerAugment6, 0 for none.
  augment_ids integer[] not null check (cardinality(augment_ids) = 6),
  primary key (match_id, puuid)
);

create index participants_puuid on participants (puuid);
