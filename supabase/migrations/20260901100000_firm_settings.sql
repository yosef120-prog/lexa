-- A firm's own identity, and a guard on who may run it.

-- The logo appears on the screen a client opens, so it belongs to the firm
-- rather than to whoever uploaded it.
alter table public.organizations
  add column logo_path text;

comment on column public.organizations.logo_path is
  'Object in the firm-logos bucket. Public by design: it is shown to clients '
  'who have no account and no session.';

-- Public, unlike every other bucket here. A logo is shown on the intake form
-- to somebody holding nothing but a link, and signing a URL for it would mean
-- the one image on the page needing a round trip to be seen. There is nothing
-- confidential in a firm's own letterhead.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'firm-logos', 'firm-logos', true, 2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

-- The path is <org_id>/<uuid>, and only that firm's owner may write there.
create policy firm_logo_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'firm-logos'
    and public.has_org_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner']::public.org_role[]
    )
  );

create policy firm_logo_replace on storage.objects
  for update to authenticated
  using (
    bucket_id = 'firm-logos'
    and public.has_org_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner']::public.org_role[]
    )
  );

/**
 * A firm cannot be left without an owner.
 *
 * The owner policy is FOR ALL, so an owner can already change any membership
 * including their own — which means they can demote or remove themselves and
 * lock the firm out of its own settings, invitations and billing. Nobody can
 * undo that from inside the product.
 *
 * Checked on the row being changed rather than in the application, because the
 * application is not the only thing that can write here.
 */
create or replace function public.keep_one_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid;
  owners integer;
begin
  org := coalesce(old.org_id, new.org_id);

  -- Only the cases that can remove an owner are worth counting for.
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role = 'owner' then
    return new;
  end if;
  if old.role is distinct from 'owner' then
    return coalesce(new, old);
  end if;

  select count(*) into owners
  from public.org_members
  where org_id = org and role = 'owner' and status = 'active';

  if owners <= 1 then
    raise exception 'LAST_OWNER';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger keep_one_owner
  before update or delete on public.org_members
  for each row execute function public.keep_one_owner();
