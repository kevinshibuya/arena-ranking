-- The rating replay walks matches in end order, 500 at a time.
create index matches_ended_at_id on matches (ended_at, id);
