-- Seasons: a match's season is looked up from the major and minor of its game
-- version against first_patch. Adding a season is an insert, e.g.
--   insert into seasons (name, first_patch, starts_at)
--   values ('2027 Season 1', '17.1', '2027-01-07T00:00:00Z');
create table seasons (
  id integer generated always as identity primary key,
  name text not null unique,
  -- Major and minor of the season's first patch in game-version form, as
  -- match-v5 reports gameVersion: '16.9' for the patch Riot calls 26.09.
  first_patch text not null check (first_patch ~ '^[0-9]+\.[0-9]+$'),
  starts_at timestamptz not null
);

create unique index seasons_first_patch_key
  on seasons ((split_part(first_patch, '.', 1)::integer), (split_part(first_patch, '.', 2)::integer));

-- The same rows as SEASON_SEED in src/modules/seasons/season-seed.ts.
insert into seasons (name, first_patch, starts_at) values
  ('2026 Season 1', '16.1', '2026-01-08T00:00:00Z'),
  ('2026 Season 2', '16.9', '2026-04-29T00:00:00Z'),
  ('2026 Season 3', '16.17', '2026-08-26T00:00:00Z');
