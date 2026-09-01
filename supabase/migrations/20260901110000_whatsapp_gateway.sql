-- Sending WhatsApp from the firm's own number, through a gateway.
--
-- The wa.me button opens the app with the message written. This is the other
-- thing: the firm connects its own WhatsApp to a gateway — Green API is the
-- one Israeli firms use — and messages go out from the server without anybody
-- switching apps.
--
-- The whole design turns on one fact: the gateway's api token is full control
-- of that WhatsApp account. Somebody holding it can read the firm's
-- conversations and write as the firm. It is not a key that may sit in a
-- browser bundle, be logged, or come back in a query.
--
-- So the token is write-only from the application's side. Column privileges,
-- not a policy: policies decide which rows you may see, and this is about a
-- column. The app can insert it and update it and can never select it. Only
-- the sending service, which holds the service role, ever reads it.

create table public.whatsapp_connections (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,

  -- One provider today. Named rather than assumed, so a second one does not
  -- need a migration to tell the two apart.
  provider    text not null default 'green_api' check (provider in ('green_api')),
  instance_id text not null,
  api_token   text not null,

  -- The number the firm connected, for the screen to show which account this
  -- is. Written by the firm, not verified here.
  phone       text,

  -- Set when a send last succeeded or failed, so the screen can say whether
  -- the connection still works rather than only that it exists.
  last_ok_at    timestamptz,
  last_error    text,
  last_error_at timestamptz,

  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One connection per firm. Two would mean messages leaving from whichever
  -- the code happened to pick.
  unique (org_id)
);

alter table public.whatsapp_connections enable row level security;

-- Owners only, both ways. Connecting the firm's WhatsApp is not a thing a
-- secretary does on their own, and reading which account is connected is
-- close enough to the same decision.
create policy whatsapp_owner_read on public.whatsapp_connections
  for select to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]));

create policy whatsapp_owner_write on public.whatsapp_connections
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner']::public.org_role[]));

create policy whatsapp_owner_update on public.whatsapp_connections
  for update to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner']::public.org_role[]));

create policy whatsapp_owner_delete on public.whatsapp_connections
  for delete to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]));

-- The point of the whole file. Every column except the token is readable;
-- the token can be written and never read back.
--
-- `select *` on this table fails for the application by design. A query that
-- wants the token has to name it, and naming it is refused — which turns
-- "we accidentally sent the token to the browser" from a code review into an
-- error.
grant select (
  id, org_id, provider, instance_id, phone,
  last_ok_at, last_error, last_error_at, created_by, created_at, updated_at
) on public.whatsapp_connections to authenticated;

grant insert (org_id, provider, instance_id, api_token, phone) on public.whatsapp_connections to authenticated;
grant update (instance_id, api_token, phone, updated_at) on public.whatsapp_connections to authenticated;
grant delete on public.whatsapp_connections to authenticated;

/**
 * Auditing this table without writing the token into the audit trail.
 *
 * write_audit stores the whole row as jsonb, and audit_log is readable by
 * every member of the firm. Using it here would carry the token straight past
 * the column privileges above and hand it to exactly the people they were
 * written to keep it from — the protection would look intact and be worthless.
 *
 * Connecting and disconnecting the firm's WhatsApp is worth recording. The
 * secret is not part of that record.
 */
create or replace function public.write_audit_redacted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_j jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) - 'api_token' end;
  new_j jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) - 'api_token' end;
begin
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, before, after)
  values (
    coalesce((new_j ->> 'org_id')::uuid, (old_j ->> 'org_id')::uuid),
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(new_j ->> 'id', old_j ->> 'id'),
    old_j,
    new_j
  );
  return coalesce(new, old);
end;
$$;

create trigger audit after insert or update or delete on public.whatsapp_connections
  for each row execute function public.write_audit_redacted();
