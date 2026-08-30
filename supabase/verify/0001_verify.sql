-- Structural verification for 0001_org_foundation.sql.
--
-- "Success. No rows returned" only says the statements parsed and ran. This
-- asserts the shape they were supposed to leave behind: RLS actually on, the
-- policies actually present, anon actually holding nothing.
--
-- Safe to re-run at any time; it reads catalogs and writes nothing.

with checks as (
  select 'tables created' as check_name, '4' as expected, count(*)::text as actual
  from pg_tables
  where schemaname = 'public'
    and tablename in ('organizations', 'org_members', 'profiles', 'audit_log')

  union all
  select 'row level security enabled on all four', '4', count(*)::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('organizations', 'org_members', 'profiles', 'audit_log')
    and c.relrowsecurity

  union all
  select 'policies created', '8', count(*)::text
  from pg_policies
  where schemaname = 'public'

  union all
  select 'functions created', '5', count(*)::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('is_org_member', 'has_org_role', 'write_audit',
                      'handle_new_user', 'create_organization')

  union all
  select 'isolation helpers are security definer', '2', count(*)::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('is_org_member', 'has_org_role')
    and p.prosecdef

  union all
  -- Nothing here is reachable without a login. This failed on the first real
  -- run -- the project had granted anon 12 privileges regardless of the
  -- dashboard setting -- which is why 0002 revokes rather than assumes.
  select 'anon holds no privilege on any table', '0', count(*)::text
  from information_schema.role_table_grants
  where grantee = 'anon'
    and table_schema = 'public'

  union all
  -- 2 on organizations + 4 on org_members + 2 on profiles + 1 on audit_log.
  -- Any other number means a grant crept in from somewhere this file cannot see.
  select 'authenticated holds exactly nine privileges', '9', count(*)::text
  from information_schema.role_table_grants
  where grantee = 'authenticated'
    and table_schema = 'public'

  union all
  select 'audit_log is read-only for authenticated', '0', count(*)::text
  from information_schema.role_table_grants
  where grantee = 'authenticated'
    and table_schema = 'public'
    and table_name = 'audit_log'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')

  union all
  select 'audit triggers attached', '2', count(*)::text
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal
    and t.tgname = 'audit'
    and c.relname in ('organizations', 'org_members')

  union all
  select 'signup trigger on auth.users', '1', count(*)::text
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and t.tgname = 'on_auth_user_created'
    and n.nspname = 'auth'
    and c.relname = 'users'

  union all
  select 'no firms exist yet', '0', count(*)::text
  from public.organizations
)
select
  case when expected = actual then 'PASS' else 'FAIL' end as status,
  check_name,
  expected,
  actual
from checks
order by (case when expected = actual then 1 else 0 end), check_name;
