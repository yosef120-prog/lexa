-- Deleting a file should stop it asking for things.
--
-- Found by deleting the matters an audit had created. The matter went; its
-- payment date stayed in the diary, lost the label saying which file it came
-- from, and would have gone on sending a reminder email three days before a
-- payment on a deal that no longer exists.
--
-- The same held for every hearing and every open task on the file. Soft delete
-- marked one row and nothing that hung off it, so a firm that closed a case
-- kept being chased about it — and could not tell what was chasing them,
-- because the only thing naming the matter was the matter.
--
-- There is no restore_matter, so this needs no matching undo. If one is ever
-- written, it has to bring these back with it, which is why they are marked
-- rather than removed.

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

  -- The diary first, because that is the one that speaks. A hearing or a
  -- payment date on a deleted file keeps its place in the list and keeps its
  -- reminder, and the reminder arrives with no way to work out what it means.
  update public.events
  set deleted_at = now()
  where matter_id = p_matter_id and deleted_at is null;

  -- Cancelled rather than done: nobody did them. The distinction is the whole
  -- reason the enum has three values.
  update public.tasks
  set status = 'cancelled', updated_at = now()
  where matter_id = p_matter_id and status = 'open';
end;
$$;

revoke all on function public.soft_delete_matter(uuid) from public;
grant execute on function public.soft_delete_matter(uuid) to authenticated;
