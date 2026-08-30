-- Make deletion hide things, and make it a named operation.
--
-- Two faults, found by deleting a client in the running app and watching it
-- stay on screen.
--
-- First: clients_write and matters_write were declared FOR ALL, which includes
-- SELECT. Permissive policies combine with OR, so for anyone holding a write
-- role the read policy's `deleted_at is null` never applied at all.
--
-- Second, and only visible once the first was fixed: Postgres checks the SELECT
-- policy against the *new* row of an UPDATE. Setting deleted_at makes the row
-- fail that policy, so the update is refused outright. Hiding deleted rows in a
-- read policy and deleting them with a plain UPDATE cannot both work.
--
-- So deletion moves into named functions that check the caller's role and then
-- write as owner. That is better than a column poke regardless: the audit trail
-- now records an intention rather than an edit that happens to touch a field.
--
-- The rule from here: one FOR SELECT policy per table, and nothing else that
-- can answer a read. FOR ALL is not used again.

drop policy clients_write on public.clients;
drop policy matters_write on public.matters;

create policy clients_insert on public.clients
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy clients_update on public.clients
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy matters_insert on public.matters
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy matters_update on public.matters
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

-- ---------------------------------------------------------------- deletion

/**
 * Marks a client deleted.
 *
 * Definer, because the row must end up in a state the caller's read policy
 * hides. The role check that the policy would have made is made here instead,
 * explicitly, before anything is written.
 */
create or replace function public.soft_delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_org uuid;
begin
  select org_id into row_org from public.clients where id = p_client_id and deleted_at is null;
  if row_org is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.has_org_role(row_org, array['owner', 'lawyer', 'secretary']::public.org_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  -- An open matter is a reason not to lose the client behind it.
  if exists (
    select 1 from public.matters
    where client_id = p_client_id and deleted_at is null and status <> 'closed'
  ) then
    raise exception 'HAS_OPEN_MATTERS';
  end if;

  update public.clients set deleted_at = now(), updated_at = now() where id = p_client_id;
end;
$$;

create or replace function public.restore_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_org uuid;
begin
  select org_id into row_org from public.clients where id = p_client_id and deleted_at is not null;
  if row_org is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.has_org_role(row_org, array['owner', 'lawyer']::public.org_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  update public.clients set deleted_at = null, updated_at = now() where id = p_client_id;
end;
$$;

create or replace function public.soft_delete_matter(p_matter_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_org uuid;
begin
  select org_id into row_org from public.matters where id = p_matter_id and deleted_at is null;
  if row_org is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.has_org_role(row_org, array['owner', 'lawyer']::public.org_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  update public.matters set deleted_at = now(), updated_at = now() where id = p_matter_id;
end;
$$;

revoke all on function public.soft_delete_client(uuid) from public;
revoke all on function public.restore_client(uuid)     from public;
revoke all on function public.soft_delete_matter(uuid) from public;

grant execute on function public.soft_delete_client(uuid) to authenticated;
grant execute on function public.restore_client(uuid)     to authenticated;
grant execute on function public.soft_delete_matter(uuid) to authenticated;
