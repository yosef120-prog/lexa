-- Did a real signup do what the schema promised?
--
-- PGlite could only simulate auth.users, so handle_new_user() firing on an
-- actual Supabase signup is the part that was never truly proven. This checks
-- it against the row the app just created.
--
-- Read-only. The cleanup statement at the bottom is commented out on purpose.

with checks as (
  select 'the signup reached auth.users' as check_name, '1' as expected, count(*)::text as actual
  from auth.users
  where email = 'lexa-test-1@gmail.com'

  union all
  -- The trigger, not the app, creates this row. If it is missing, every later
  -- screen that shows a person's name is reading from nothing.
  select 'handle_new_user created a profile', '1', count(*)::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email = 'lexa-test-1@gmail.com'

  union all
  select 'the profile carries the name from signup', 'דניאל שמעונוב', coalesce(max(p.full_name), '(null)')
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email = 'lexa-test-1@gmail.com'

  union all
  -- Signing up must not create a firm; that is a separate, deliberate step.
  select 'signing up created no firm', '0', count(*)::text
  from public.organizations

  union all
  select 'and no membership', '0', count(*)::text
  from public.org_members
)
select
  case when expected = actual then 'PASS' else 'FAIL' end as status,
  check_name,
  expected,
  actual
from checks
order by (case when expected = actual then 1 else 0 end), check_name;

-- Cleanup, once the end-to-end run is done. Deleting the auth user cascades to
-- profiles, org_members and organizations created by that account.
--
--   delete from auth.users where email = 'lexa-test-1@gmail.com';
