-- Structural verification for 0004_matters.sql. Read-only, safe to re-run.

with checks as (
  select 'matters tables created' as check_name, '2' as expected, count(*)::text as actual
  from pg_tables
  where schemaname = 'public' and tablename in ('matters', 'matter_numbers')

  union all
  select 'row level security enabled on both', '2', count(*)::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('matters', 'matter_numbers')
    and c.relrowsecurity

  union all
  -- matters_read, matters_write, matter_numbers_read.
  select 'matter policies created', '3', count(*)::text
  from pg_policies
  where schemaname = 'public' and tablename in ('matters', 'matter_numbers')

  union all
  -- One assigns the per-firm reference, one writes the audit trail.
  select 'both matter triggers attached', '2', count(*)::text
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relname = 'matters'
    and t.tgname in ('assign_ref', 'audit')

  union all
  select 'the closed-needs-a-date rule exists', '1', count(*)::text
  from pg_constraint
  where conname = 'matters_closed_has_date'

  union all
  select 'references are unique per firm', '1', count(*)::text
  from pg_indexes
  where schemaname = 'public' and indexname = 'matters_org_ref_idx'

  union all
  select 'anon still holds no privilege anywhere', '0', count(*)::text
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'

  union all
  -- 9 from stage 1, +3 clients, +2 conflict_checks, +3 matters, +1 matter_numbers.
  select 'authenticated holds exactly eighteen privileges', '18', count(*)::text
  from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'
)
select
  case when expected = actual then 'PASS' else 'FAIL' end as status,
  check_name,
  expected,
  actual
from checks
order by (case when expected = actual then 1 else 0 end), check_name;
