-- Give the trusted backend role what it needs to work.
--
-- 0002 revoked everything and granted back only to authenticated, which was
-- right for the browser and left service_role -- the role the filing renderer
-- connects as -- with whatever the platform happened to have granted. That is
-- the same "depends on a default we did not set" that 0002 existed to remove.
--
-- service_role is only ever used by a server holding the secret key. It bypasses
-- row level security by design, which is why the renderer checks membership
-- itself before it reads anything.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    grant execute on all functions in schema public to service_role;

    -- And for whatever later migrations add, so this is not a recurring fix.
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
  end if;
end;
$$;
