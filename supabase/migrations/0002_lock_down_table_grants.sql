-- Take table privileges back to zero and re-grant only what is used.
--
-- 0001 assumed the project's "automatically expose new tables" setting would
-- leave anon with nothing. Verification against the real database found anon
-- holding 12 privileges anyway. RLS still stood between it and any row, but a
-- setting in a dashboard is not something a schema should depend on: it is
-- invisible in review, and one click away from changing.
--
-- So this file stops asking and starts asserting. Revoke everything, grant back
-- the exact list, and turn off the default that keeps re-granting.

-- ---------------------------------------------------------------- reset

revoke all on public.organizations from anon, authenticated;
revoke all on public.org_members   from anon, authenticated;
revoke all on public.profiles      from anon, authenticated;
revoke all on public.audit_log     from anon, authenticated;

-- Future tables in this schema start with nothing too, so the next migration
-- inherits the rule instead of having to remember it.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on sequences from authenticated;

-- ---------------------------------------------------------------- grant back

-- anon is deliberately absent from every line below: nothing here is reachable
-- without a login.

grant usage on schema public to authenticated;

-- Renaming a firm is an owner action; organizations_owner_update enforces that.
-- No insert: firms are created only through create_organization().
grant select, update                 on public.organizations to authenticated;

grant select, insert, update, delete on public.org_members   to authenticated;

-- No insert: rows appear via the handle_new_user trigger. No delete: profiles
-- go when the auth user does, by cascade.
grant select, update                 on public.profiles      to authenticated;

-- Read only, and only owners get past the policy. Inserts arrive through
-- write_audit(), which is security definer and needs no grant of its own.
grant select                         on public.audit_log     to authenticated;
