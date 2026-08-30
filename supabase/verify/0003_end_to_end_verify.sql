-- Stage 1, end to end: a real signup through the real app.
--
-- The browser showed the right screens. This asks the database whether the rows
-- behind them are the ones the schema promised — including the audit entries,
-- which no screen displays yet and which would otherwise go unchecked.
--
-- Read-only. Cleanup is at the bottom, commented out.

with u as (
  select id from auth.users where email = 'lexa-test-2@gmail.com'
),
checks as (
  select 'the account exists' as check_name, '1' as expected, count(*)::text as actual
  from u

  union all
  select 'its profile carries the name from signup', 'דניאל שמעונוב',
         coalesce(max(p.full_name), '(missing)')
  from public.profiles p join u on u.id = p.id

  union all
  select 'exactly one firm exists', '1', count(*)::text
  from public.organizations where deleted_at is null

  union all
  select 'the firm has the name that was typed', 'דניאל שמעונוב, עורך דין',
         coalesce(max(name), '(missing)')
  from public.organizations

  union all
  -- create_organization() promises both rows or neither. This is the "neither"
  -- half never happening.
  select 'the creator is its active owner', 'owner/active',
         coalesce(max(m.role::text || '/' || m.status::text), '(missing)')
  from public.org_members m join u on u.id = m.user_id

  union all
  select 'the firm defaulted to the EU region', 'eu-central-1',
         coalesce(max(data_region), '(missing)')
  from public.organizations

  union all
  -- One row for the firm, one for the membership, both from inside the function.
  select 'both inserts were audited', '2', count(*)::text
  from public.audit_log

  union all
  select 'the audit names the person who acted', '2', count(*)::text
  from public.audit_log a join u on u.id = a.actor_id

  union all
  -- The bug the tests caught: organizations rows key the tenant by id, not
  -- org_id, so this row used to be written with a null org_id and be invisible.
  select 'the firm row audit carries an org_id', '1', count(*)::text
  from public.audit_log
  where entity = 'organizations' and org_id is not null
)
select
  case when expected = actual then 'PASS' else 'FAIL' end as status,
  check_name,
  expected,
  actual
from checks
order by (case when expected = actual then 1 else 0 end), check_name;

-- Clearing the test accounts cascades to profiles, org_members and their firms:
--
--   delete from auth.users where email in ('lexa-test-1@gmail.com', 'lexa-test-2@gmail.com');
