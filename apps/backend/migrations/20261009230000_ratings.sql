-- Rating replay runs and what each wrote. Readers use the latest complete run
-- only; a run in progress has completed_at null and is never read.

create table replay_runs (
  id integer generated always as identity primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- One row per player, format and scope ('all', or a season id as text) after
-- every rated match of it. wins, top4s and placement_sum are over the same
-- matches as games, so a ladder row needs nothing but this table.
create table ratings (
  run_id integer not null references replay_runs (id) on delete cascade,
  puuid text not null,
  format text not null,
  scope text not null,
  mu double precision not null,
  sigma double precision not null,
  -- mu minus three sigma: the displayed rating.
  ordinal double precision not null,
  games integer not null,
  wins integer not null,
  top4s integer not null,
  placement_sum integer not null,
  primary key (run_id, format, scope, puuid)
);

create index ratings_ladder on ratings (run_id, format, scope, ordinal desc, puuid);

-- One row per participant, format and scope of every rated match: the ordinal
-- right after it, for the profile's rating chart.
create table rating_history (
  run_id integer not null references replay_runs (id) on delete cascade,
  puuid text not null,
  format text not null,
  scope text not null,
  match_id text not null,
  ordinal_after double precision not null,
  primary key (run_id, puuid, format, scope, match_id)
);
