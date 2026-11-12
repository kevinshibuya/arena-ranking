-- Static data: champions from Data Dragon, one row per patch cached, and the
-- Arena augments from Community Dragon. The daily refresh upserts both.

create table champions (
  -- The Data Dragon version, e.g. '16.20.1'; its major and minor match a
  -- match's game version.
  patch text not null check (patch ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  -- Data Dragon's `key`, the id match-v5 reports as championId.
  champion_id integer not null,
  name text not null,
  -- File name under /cdn/<patch>/img/champion/.
  image text not null,
  primary key (patch, champion_id)
);

create index champions_champion_id on champions (champion_id);

-- Stored only: v1 surfaces no augment.
create table augments (
  id integer primary key,
  api_name text not null,
  name text not null,
  rarity integer not null,
  -- Paths under Community Dragon's /latest/game/.
  icon_small text not null,
  icon_large text not null
);

-- One row per completed refresh; health reads the newest.
create table static_data_refreshes (
  id integer generated always as identity primary key,
  patch text not null,
  champions integer not null,
  augments integer not null,
  refreshed_at timestamptz not null default now()
);
