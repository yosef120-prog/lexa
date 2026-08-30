-- Run once, by hand, before the GitHub integration deploys anything.
--
-- The first four migrations were applied through the SQL editor, so Supabase's
-- migration history has no record of them. Left as is, the integration would
-- try to run them again and fail on objects that already exist.
--
-- This records them as applied. The integration then sees only what is
-- genuinely new -- 20260830203000 and everything after it -- and runs that.
--
-- Safe to re-run: nothing is inserted twice.

create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  statements text[],
  name       text
);

insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260830180000', 'org_foundation'),
  ('20260830181000', 'lock_down_table_grants'),
  ('20260830190000', 'clients_and_conflict_checks'),
  ('20260830193000', 'matters')
on conflict (version) do nothing;

-- What the history now holds. Expect exactly the four above, and not
-- 20260830203000 -- that one is still to come, from the repository.
select version, name
from supabase_migrations.schema_migrations
order by version;
